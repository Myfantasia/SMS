"""Fee-domain business logic. Every function here that touches the ledger runs
inside transaction.atomic() and locks the affected student's StudentExtra row
with select_for_update() first, per the Finance Subsystem Design spec section 11."""
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.finance.models_fees import (
    StudentFeeLedgerEntry, StudentFeeAdjustment, Invoice, InvoiceLineItem, StudentFeeItemEnrollment,
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
