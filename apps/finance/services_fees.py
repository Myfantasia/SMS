"""Fee-domain business logic. Every function here that touches the ledger runs
inside transaction.atomic() and locks the affected student's StudentExtra row
with select_for_update() first, per the Finance Subsystem Design spec section 11."""
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.finance.models_fees import (
    StudentFeeLedgerEntry, StudentFeeAdjustment, Invoice, InvoiceLineItem, StudentFeeItemEnrollment,
    Payment, Receipt,
)
from apps.finance.services_shared import next_document_number
from apps.identity.models import StudentExtra
from apps.core.services import write_audit_log


def post_ledger_entry(*, student, entry_type, amount, reference, description, date=None):
    """Write one row to a student's fee ledger and return it. `amount` must
    already be signed correctly by the caller (charges positive, payments and
    reductions negative) — this function does not infer sign from entry_type.
    Locks the student's StudentExtra row for the duration of the transaction so
    two concurrent postings for the same student can never read the same
    "previous balance" and silently lose one of the updates."""
    with transaction.atomic():
        locked_student = StudentExtra.objects.select_for_update().get(pk=student.pk)
        last_entry = (
            StudentFeeLedgerEntry.objects.filter(student=locked_student).order_by('-id').first()
        )
        previous_balance = last_entry.running_balance if last_entry else 0
        return StudentFeeLedgerEntry.objects.create(
            student=locked_student,
            entry_type=entry_type,
            amount=amount,
            running_balance=previous_balance + amount,
            reference=reference,
            description=description,
            date=date or timezone.now().date(),
        )


def create_adjustment(*, student, adjustment_type, amount, reason, requested_by, category=None, approved_by=None):
    """Create a StudentFeeAdjustment and post it to the student's ledger.
    Any negative amount (a discount/scholarship/bursary that waives fees) must
    carry an approver — this is an audit requirement, not optional, per spec
    section 4.4."""
    if amount < 0 and approved_by is None:
        raise ValidationError(
            f"A negative adjustment ({adjustment_type}) of {amount} requires an approver."
        )
    if approved_by is not None and approved_by == requested_by:
        raise ValidationError(
            "The approver of a negative adjustment cannot be the same user who requested it."
        )
    with transaction.atomic():
        # Lock the student row first: the create() below takes FOR KEY SHARE on it
        # via the FK, and post_ledger_entry then wants FOR UPDATE -- taking the
        # stronger lock up front avoids a lock-upgrade deadlock between two
        # concurrent writers for one student.
        student = StudentExtra.objects.select_for_update().get(pk=student.pk)
        adjustment = StudentFeeAdjustment.objects.create(
            student=student, category=category, adjustment_type=adjustment_type,
            amount=amount, reason=reason, requested_by=requested_by, approved_by=approved_by,
        )
        post_ledger_entry(
            student=student, entry_type='adjustment', amount=amount,
            reference=adjustment, description=f"{adjustment.get_adjustment_type_display()}: {reason}",
        )
        write_audit_log(
            operator_id=requested_by.id, action_type='APPROVE' if approved_by else 'CREATE',
            module='finance',
            description=(
                f"{adjustment.get_adjustment_type_display()} of {amount} for student "
                f"{student.id}: {reason}" + (f" (approved by {approved_by.username})" if approved_by else '')
            ),
        )
        return adjustment


def generate_invoice_for_student(*, student, fee_structure, operator):
    """Create one Invoice for `student` against `fee_structure`: every mandatory
    FeeStructureItem, plus any optional item the student has a
    StudentFeeItemEnrollment row for. Snapshots line items into
    InvoiceLineItem so a later edit to the FeeStructure never changes this
    invoice retroactively (spec section 4.5)."""
    enrolled_item_ids = set(
        StudentFeeItemEnrollment.objects.filter(student=student, fee_structure_item__fee_structure=fee_structure)
        .values_list('fee_structure_item_id', flat=True)
    )
    applicable_items = [
        item for item in fee_structure.items.select_related('category')
        if not item.is_optional or item.pk in enrolled_item_ids
    ]
    total = sum(item.amount for item in applicable_items)

    with transaction.atomic():
        # Lock-first: see create_adjustment.
        student = StudentExtra.objects.select_for_update().get(pk=student.pk)
        invoice = Invoice.objects.create(
            student=student, fee_structure=fee_structure, total=total,
            invoice_number=next_document_number('INV'),
        )
        InvoiceLineItem.objects.bulk_create([
            InvoiceLineItem(
                invoice=invoice, category=item.category,
                description=item.category.name, amount=item.amount,
            )
            for item in applicable_items
        ])
        post_ledger_entry(
            student=student, entry_type='charge', amount=total,
            reference=invoice, description=f"Invoice {invoice.invoice_number} ({fee_structure.name})",
        )
        write_audit_log(
            operator_id=operator.id if operator else None, action_type='CREATE', module='finance',
            description=f"Generated invoice {invoice.invoice_number} for student {student.id} "
                         f"({fee_structure.name}), total {total}.",
        )
        return invoice


def generate_invoices_for_structure(*, fee_structure, operator):
    """Bulk-generate invoices for every eligible student in fee_structure's
    grade. Idempotent by construction: students who already have a
    non-voided invoice for this structure are skipped, so re-running this
    (e.g. a double-submit) never creates duplicates — the caller doesn't need
    to catch IntegrityError from the UniqueConstraint on Invoice."""
    already_invoiced_student_ids = set(
        Invoice.objects.filter(fee_structure=fee_structure)
        .exclude(status='voided')
        .values_list('student_id', flat=True)
    )
    students = StudentExtra.objects.filter(
        cl__grade=fee_structure.grade_level, cl__is_deleted=False,
        status=True, deleted_at__isnull=True,
    ).exclude(id__in=already_invoiced_student_ids)
    return [
        generate_invoice_for_student(student=student, fee_structure=fee_structure, operator=operator)
        for student in students
    ]


def _recalculate_invoice_status(invoice):
    """An invoice's status is derived from its non-voided payments, not stored
    independently — recomputed here after every payment against it. A voided
    invoice is terminal: its status is re-read from the DB (the caller's
    in-memory copy may be stale) and left untouched."""
    if Invoice.objects.filter(pk=invoice.pk).values_list('status', flat=True).first() == 'voided':
        return
    paid_amount = (
        Payment.objects.filter(invoice=invoice, voided_at__isnull=True, status='confirmed')
        .aggregate(total=Sum('amount'))['total'] or 0
    )
    if paid_amount >= invoice.total:
        invoice.status = 'paid'
    elif paid_amount > 0:
        invoice.status = 'partially_paid'
    else:
        invoice.status = 'unpaid'
    invoice.save(update_fields=['status'])


def record_payment(*, student, amount, method, recorded_by, invoice=None, reference='', cash_account=None, date=None):
    """Record a manual payment: create the Payment (always 'confirmed' for
    manual entries, per spec section 9), post a negative ledger entry, update
    the invoice's status if one was supplied, generate the Receipt
    synchronously, and audit-log the action — all inside one transaction."""
    if amount <= 0:
        raise ValidationError("Payment amount must be greater than zero.")
    if invoice is not None and invoice.student_id != student.id:
        raise ValidationError("The invoice does not belong to this student.")
    # Accepts a date, an ISO string or None; the ledger and the payment must
    # share one real datetime.date so a backdated payment posts on its own date.
    payment_date = models.DateField().to_python(date) if date else timezone.now().date()

    with transaction.atomic():
        # Lock-first: see create_adjustment.
        student = StudentExtra.objects.select_for_update().get(pk=student.pk)
        if invoice is not None:
            if Invoice.objects.filter(pk=invoice.pk).values_list('status', flat=True).first() == 'voided':
                raise ValidationError("Cannot record a payment against a voided invoice.")
        payment = Payment.objects.create(
            student=student, invoice=invoice, amount=amount, method=method,
            reference=reference, status='confirmed', recorded_by=recorded_by,
            cash_account=cash_account, date=payment_date,
        )
        post_ledger_entry(
            student=student, entry_type='payment', amount=-amount, date=payment_date,
            reference=payment, description=f"Payment received ({method})" + (f" for {invoice.invoice_number}" if invoice else ''),
        )
        if invoice is not None:
            _recalculate_invoice_status(invoice)
        receipt = Receipt.objects.create(payment=payment, receipt_number=next_document_number('RCPT'))
        write_audit_log(
            operator_id=recorded_by.id, action_type='CREATE', module='finance',
            description=f"Recorded payment of {amount} ({method}) for student {student.id}"
                         + (f" against invoice {invoice.invoice_number}" if invoice else '') + f"; receipt {receipt.receipt_number}.",
        )
        return payment, receipt
