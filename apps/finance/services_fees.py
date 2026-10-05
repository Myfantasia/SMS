"""Fee-domain business logic. Every function here that touches the ledger runs
inside transaction.atomic() and locks the affected student's StudentExtra row
with select_for_update() first, per the Finance Subsystem Design spec section 11."""
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import PermissionDenied, ValidationError
from django.contrib.contenttypes.models import ContentType
from django.db import IntegrityError, models, transaction
from django.db.models import ProtectedError, Sum
from django.utils import timezone

from apps.finance.models_fees import (
    StudentFeeLedgerEntry, StudentFeeAdjustment, Invoice, InvoiceLineItem, StudentFeeItemEnrollment,
    Payment, Receipt, InvoiceCreditApplication, FeeCategory, FeeClearancePolicy, FeeClearanceOverride,
    DiscountType, DiscountRule,
)
from apps.finance.services_shared import next_document_number
from apps.identity.models import StudentExtra
from apps.identity.services import user_has_permission
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


def get_credit_balance(student):
    """The student's unapplied overpayment credit: `max(0, -running_balance)` of
    their latest ledger entry, 0 when they have no entries (spec section 4.8)."""
    latest_balance = (
        StudentFeeLedgerEntry.objects.filter(student=student).order_by('-id')
        .values_list('running_balance', flat=True).first()
    )
    return max(0, -latest_balance) if latest_balance is not None else 0


def create_adjustment(*, student, adjustment_type, amount, reason, requested_by, category_id=None,
                       discount_type=None, discount_rule=None):
    """Create a StudentFeeAdjustment. Spec section 4.10 (Task 30): a negative
    amount (a discount/scholarship/bursary that waives fees) is created
    `pending` and posts NOTHING to the ledger -- it waits for a separate
    decide_adjustment() approval. A positive amount (penalty/correction) needs
    no approval, so it is created `approved` and posted immediately, exactly
    as before this feature existed; `decided_by` is set to `requested_by`
    since the "decision" was simply that none was required (see the model
    docstring for why `approved_by` is deliberately left None in this case).
    `category_id` (optional) is resolved to the FeeCategory here. `discount_type` and
    `discount_rule` (optional, Task 36) are stored on the row as-is; both default to None,
    which leaves every existing caller's behaviour unchanged. The caller's
    serializer already rejects amount == 0."""
    category = FeeCategory.objects.filter(id=category_id).first() if category_id else None
    with transaction.atomic():
        # Lock the student row first: the create() below takes FOR KEY SHARE on it
        # via the FK, and post_ledger_entry then wants FOR UPDATE -- taking the
        # stronger lock up front avoids a lock-upgrade deadlock between two
        # concurrent writers for one student.
        student = StudentExtra.objects.select_for_update().get(pk=student.pk)
        if amount < 0:
            adjustment = StudentFeeAdjustment.objects.create(
                student=student, category=category, adjustment_type=adjustment_type,
                amount=amount, reason=reason, requested_by=requested_by, status='pending',
                discount_type=discount_type, discount_rule=discount_rule,
            )
            write_audit_log(
                operator_id=requested_by.id, action_type='CREATE', module='finance',
                description=(
                    f"Requested {adjustment.get_adjustment_type_display()} of {amount} for student "
                    f"{student.id} (awaiting approval): {reason}"
                ),
            )
            return adjustment
        adjustment = StudentFeeAdjustment.objects.create(
            student=student, category=category, adjustment_type=adjustment_type,
            amount=amount, reason=reason, requested_by=requested_by,
            status='approved', decided_by=requested_by, decided_at=timezone.now(),
            discount_type=discount_type, discount_rule=discount_rule,
        )
        post_ledger_entry(
            student=student, entry_type='adjustment', amount=amount,
            reference=adjustment,
            description=f"{adjustment.get_adjustment_type_display()}: {reason}"[:_LEDGER_DESCRIPTION_MAX],
        )
        write_audit_log(
            operator_id=requested_by.id, action_type='CREATE', module='finance',
            description=f"{adjustment.get_adjustment_type_display()} of {amount} for student {student.id}: {reason}",
        )
        return adjustment


def decide_adjustment(*, adjustment, decided_by, approve, note=''):
    """Approve or reject a PENDING StudentFeeAdjustment -- the second step of
    the two-step waiver-approval workflow create_adjustment() starts for
    negative/waiving amounts (spec section 4.10, Task 30).

    `decided_by` can never be the user who requested the adjustment -- a
    requester can never decide their own request. This is checked FIRST and
    unconditionally, before the permission check, so it is always a
    ValidationError (never a PermissionDenied) even if the requester happens
    to also hold finance.approve_adjustment via some other role. `decided_by`
    must otherwise hold finance.approve_adjustment, checked with
    apps.identity.services.user_has_permission -- the same plain, non-request-
    scoped check grant_clearance_override/revoke_clearance_override already
    use in this file.

    Locks the student row first, then re-reads the adjustment under its own
    lock (the caller's `adjustment` object may be stale) -- same ordering as
    create_adjustment/void_payment/void_invoice. A non-pending adjustment
    (already decided) is refused with a ValidationError: a decision is final.

    Approving posts the ledger entry create_adjustment() withheld and sets
    `approved_by = decided_by` (see the model docstring for why this is kept
    separate from `decided_by`). Rejecting posts nothing. Both set
    decided_by/decided_at/decision_note and are audit-logged, reusing the
    existing 'APPROVE'/'REJECT' ACTION_CHOICES values (originally written for
    a different, unrelated pending-account workflow) -- no adjustment-specific
    choices exist yet and these are conceptually the approve/reject cases
    those two already describe, the same reasoning void_invoice's docstring
    gives for reusing 'DELETE'."""
    if decided_by == adjustment.requested_by:
        raise ValidationError("The requester of an adjustment cannot decide their own request.")
    if not user_has_permission(decided_by.id, 'finance.approve_adjustment'):
        raise PermissionDenied("You do not hold the finance.approve_adjustment permission.")
    with transaction.atomic():
        # Lock-first: see create_adjustment.
        student = StudentExtra.objects.select_for_update().get(pk=adjustment.student_id)
        # Re-read under the lock: the caller's object may be stale.
        adjustment = StudentFeeAdjustment.objects.select_for_update().get(pk=adjustment.pk)
        if adjustment.status != 'pending':
            raise ValidationError(f"Adjustment {adjustment.pk} has already been decided.")
        adjustment.decided_by = decided_by
        adjustment.decided_at = timezone.now()
        adjustment.decision_note = note
        if approve:
            adjustment.status = 'approved'
            adjustment.approved_by = decided_by
            adjustment.save(update_fields=['status', 'approved_by', 'decided_by', 'decided_at', 'decision_note'])
            post_ledger_entry(
                student=student, entry_type='adjustment', amount=adjustment.amount,
                reference=adjustment,
                description=f"{adjustment.get_adjustment_type_display()}: {adjustment.reason}"[:_LEDGER_DESCRIPTION_MAX],
            )
            write_audit_log(
                operator_id=decided_by.id, action_type='APPROVE', module='finance',
                description=(
                    f"Approved {adjustment.get_adjustment_type_display()} of {adjustment.amount} for student "
                    f"{student.id}: {adjustment.reason}" + (f" ({note})" if note else '')
                ),
            )
        else:
            adjustment.status = 'rejected'
            adjustment.save(update_fields=['status', 'decided_by', 'decided_at', 'decision_note'])
            write_audit_log(
                operator_id=decided_by.id, action_type='REJECT', module='finance',
                description=(
                    f"Rejected {adjustment.get_adjustment_type_display()} of {adjustment.amount} for student "
                    f"{student.id}: {adjustment.reason}" + (f" ({note})" if note else '')
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
        # Read the credit before the new charge lands: the ledger nets it against
        # that charge, so afterwards it would already look consumed.
        credit_before = get_credit_balance(student)
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
        # Spec section 4.8: apply carried-forward credit. No ledger entry -- the
        # charge above already netted it against the balance.
        applied = min(credit_before, total)
        if applied > 0:
            InvoiceCreditApplication.objects.create(student=student, invoice=invoice, amount=applied)
            _recalculate_invoice_status(invoice)
        write_audit_log(
            operator_id=operator.id if operator else None, action_type='CREATE', module='finance',
            description=f"Generated invoice {invoice.invoice_number} for student {student.id} "
                         f"({fee_structure.name}), total {total}"
                         + (f", credit applied {applied}." if applied > 0 else '.'),
        )
        return Invoice.objects.get(pk=invoice.pk)


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
    """An invoice's status is derived from its non-voided payments plus any
    credit applied to it (spec section 4.8), not stored independently —
    recomputed here after every payment or credit application against it. A voided
    invoice is terminal: its status is re-read from the DB (the caller's
    in-memory copy may be stale) and left untouched."""
    if Invoice.objects.filter(pk=invoice.pk).values_list('status', flat=True).first() == 'voided':
        return
    paid_amount = (
        Payment.objects.filter(invoice=invoice, voided_at__isnull=True, status='confirmed')
        .aggregate(total=Sum('amount'))['total'] or 0
    ) + (
        InvoiceCreditApplication.objects.filter(invoice=invoice)
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


_LEDGER_DESCRIPTION_MAX = 255  # StudentFeeLedgerEntry.description max_length


def void_invoice(*, invoice, voided_by, reason):
    """Void an invoice: never edit or delete it. Sets the void_* fields,
    posts a correcting negative charge to the student's ledger reversing the
    original amount, and audit-logs the action. Reusing the existing 'DELETE'
    ACTION_CHOICES value ('Soft Deleted Resource') for this -- no VOID choice
    exists yet and this is conceptually the soft-delete case that choice
    already describes.

    Payments already made against the invoice are deliberately left in place:
    the ledger simply goes to a credit equal to what was paid (the seed of the
    overpayment carry-forward feature)."""
    if not reason or not reason.strip():
        raise ValidationError("A void reason is required.")
    with transaction.atomic():
        # Lock-first: see create_adjustment.
        student = StudentExtra.objects.select_for_update().get(pk=invoice.student_id)
        # Re-read under the lock: the caller's object may be stale.
        invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
        if invoice.status == 'voided':
            raise ValidationError(f"Invoice {invoice.invoice_number} is already voided.")
        invoice.status = 'voided'
        invoice.voided_at = timezone.now()
        invoice.voided_by = voided_by
        invoice.void_reason = reason
        invoice.save(update_fields=['status', 'voided_at', 'voided_by', 'void_reason'])
        post_ledger_entry(
            student=student, entry_type='charge', amount=-invoice.total,
            reference=invoice,
            description=f"Void of invoice {invoice.invoice_number}: {reason}"[:_LEDGER_DESCRIPTION_MAX],
        )
        write_audit_log(
            operator_id=voided_by.id, action_type='DELETE', module='finance',
            description=f"Voided invoice {invoice.invoice_number} ({invoice.total}): {reason}",
        )
        return invoice


def void_payment(*, payment, voided_by, reason):
    """Void a payment: reverses its ledger effect with a positive correcting
    entry, recalculates its invoice's status if it had one (a voided invoice
    stays voided), and audit-logs the action. The payment row itself is kept,
    marked voided -- never deleted."""
    if not reason or not reason.strip():
        raise ValidationError("A void reason is required.")
    with transaction.atomic():
        # Lock-first: see create_adjustment.
        student = StudentExtra.objects.select_for_update().get(pk=payment.student_id)
        # Re-read under the lock: the caller's object may be stale.
        payment = Payment.objects.select_for_update().get(pk=payment.pk)
        if payment.voided_at is not None:
            raise ValidationError(f"Payment {payment.pk} is already voided.")
        # Payment has no created_at; its ledger entry (posted in the same
        # transaction as the payment) carries the real timestamp.
        payment_posted_at = (
            StudentFeeLedgerEntry.objects.filter(
                content_type=ContentType.objects.get_for_model(Payment), object_id=payment.pk,
                entry_type='payment', amount__lt=0,
            ).values_list('created_at', flat=True).first()
        )
        if payment_posted_at is not None and InvoiceCreditApplication.objects.filter(
            student=student, created_at__gt=payment_posted_at,
        ).exclude(invoice__status='voided').exists():
            raise ValidationError(
                f"Payment {payment.pk} cannot be voided: its overpayment credit has been applied to a "
                f"later invoice. Void that invoice first, then void this payment."
            )
        payment.voided_at = timezone.now()
        payment.voided_by = voided_by
        payment.void_reason = reason
        payment.save(update_fields=['voided_at', 'voided_by', 'void_reason'])
        post_ledger_entry(
            student=student, entry_type='payment', amount=payment.amount,
            reference=payment,
            description=f"Void of payment {payment.pk}: {reason}"[:_LEDGER_DESCRIPTION_MAX],
        )
        if payment.invoice_id is not None:
            _recalculate_invoice_status(Invoice.objects.select_for_update().get(pk=payment.invoice_id))
        write_audit_log(
            operator_id=voided_by.id, action_type='DELETE', module='finance',
            description=f"Voided payment {payment.pk} ({payment.amount}, {payment.method}): {reason}",
        )
        return payment


def hard_delete_financial_record(*, model_class, pk, operator):
    """Permanently remove a financial record. Deliberately narrow: only a real
    Django superuser (there is no separate 'SUPER_ADMIN' RBAC tier in this
    codebase -- is_superuser is the correct, already-existing mechanism) may
    call this, and only on a record that has already been voided (defense in
    depth: you can't hard-delete something that was never flagged as wrong).
    Not reachable from any API endpoint -- Django admin action only, per spec
    section 7.5.

    Dependent rows: InvoiceLineItem cascades with its Invoice. A Payment's Receipt
    (PROTECT) is deleted explicitly first, in the same transaction, and its number
    is recorded in the audit description. Payment.invoice and
    InvoiceCreditApplication.invoice are PROTECT, so an Invoice that still has
    either is refused with a ValidationError naming them (nothing is deleted or
    logged). Ledger entries are the immutable audit trail
    and are never deleted: they reference their record through a
    GenericForeignKey with no DB constraint, so after a hard delete they remain
    with a dangling reference (`entry.reference` resolves to None)."""
    if not operator.is_superuser:
        raise PermissionDenied("Only a superuser may hard-delete a financial record.")
    with transaction.atomic():
        obj = model_class.objects.select_for_update().get(pk=pk)
        if getattr(obj, 'voided_at', None) is None:
            raise ValidationError(
                f"{model_class.__name__} {pk} must be voided before it can be hard-deleted."
            )
        description = f"Hard-deleted {model_class.__name__} {pk} (was voided: {obj.void_reason})"
        receipt = None
        if model_class is Payment:
            # Receipt.payment is PROTECT and record_payment() always issues a receipt, so it is
            # removed explicitly first (same transaction). Receipt numbers are never reused, and
            # the number is preserved in the audit description built here, before deletion.
            receipt = Receipt.objects.filter(payment_id=obj.pk).first()
            if receipt is not None:
                description += f"; deleted receipt {receipt.receipt_number}"
        try:
            if receipt is not None:
                receipt.delete()
            obj.delete()
        except ProtectedError as exc:
            blockers = sorted({type(blocker).__name__ for blocker in exc.protected_objects})
            raise ValidationError(
                f"{model_class.__name__} {pk} cannot be hard-deleted while it still has "
                f"dependent records ({', '.join(blockers)}); remove those first."
            ) from exc
        write_audit_log(
            operator_id=operator.id, action_type='HARD_DELETE', module='finance',
            description=description,
        )


def is_fees_clear(*, student_id, term_id=None, grace_threshold=0):
    """Real implementation, replacing the previous always-None stub in
    services.py. Checks the student's OVERALL account balance, not scoped to
    a single term — a student carrying an unpaid balance from an earlier term
    should not read as 'clear' just because the current term's charges happen
    to be settled, so this deliberately does not filter ledger entries by
    term_id. term_id is still accepted (both gate call sites pass one, per
    spec section 4.7) so a future per-term clearance policy has a seam to add
    without changing every call site. Returns True if balance <= grace_threshold,
    False otherwise, or None if student_id doesn't correspond to a real student."""
    if not StudentExtra.objects.filter(pk=student_id).exists():
        return None
    latest_entry = StudentFeeLedgerEntry.objects.filter(student_id=student_id).order_by('-id').first()
    balance = latest_entry.running_balance if latest_entry else 0
    return balance <= grace_threshold


_OVERRIDE_PERMISSION = 'finance.override_clearance'


def get_fee_clearance_policy():
    """Read-only accessor for the singleton FeeClearancePolicy row, creating it
    with its defaults on first read (see FeeClearancePolicy.get_solo)."""
    return FeeClearancePolicy.get_solo()


def update_fee_clearance_policy(*, updated_by, block_report_cards=None, block_promotion=None, grace_threshold=None):
    """Update the fee-clearance policy singleton. Only fields explicitly passed
    (not None) are changed -- a PATCH-style partial update. Audit-logs the
    old -> new value of each field that actually changed, inside the same
    atomic block as the write (spec section 4.9: "Changing the policy is
    audit-logged")."""
    if grace_threshold is not None and (isinstance(grace_threshold, bool) or not isinstance(grace_threshold, int) or grace_threshold < 0):
        raise ValidationError("grace_threshold must be a non-negative integer.")
    with transaction.atomic():
        FeeClearancePolicy.get_solo()  # ensure row 1 exists before locking it below.
        policy = FeeClearancePolicy.objects.select_for_update().get(pk=1)
        changes = []
        for field_name, new_value in (
            ('block_report_cards', block_report_cards),
            ('block_promotion', block_promotion),
            ('grace_threshold', grace_threshold),
        ):
            if new_value is None:
                continue
            old_value = getattr(policy, field_name)
            if old_value != new_value:
                changes.append(f"{field_name}: {old_value} -> {new_value}")
                setattr(policy, field_name, new_value)
        policy.updated_by = updated_by
        policy.save()
        write_audit_log(
            operator_id=updated_by.id if updated_by else None, action_type='UPDATE', module='finance',
            description=(
                "Updated fee-clearance policy (" + '; '.join(changes) + ")." if changes
                else "Fee-clearance policy update requested no field changes."
            ),
        )
        return policy


def grant_clearance_override(*, student, gate, granted_by, reason, term=None, academic_year=None):
    """Record a FeeClearanceOverride letting one student through one gate
    despite an unpaid balance (spec section 4.9). `granted_by` must hold
    finance.override_clearance -- checked with apps.identity.services'
    user_has_permission (the same underlying check HasModulePermission and
    school.rbac.user_has_permission both delegate to), not the request-scoped
    school.rbac wrapper, since this is plain service-layer code with no
    request object. Duplicate active override for the same (student, gate,
    term/year) is rejected -- the DB partial constraints are the ultimate
    backstop, but this pre-check gives a clean ValidationError instead of an
    IntegrityError bubbling up as a 500."""
    if not reason or not reason.strip():
        raise ValidationError("A reason is required to grant a fee-clearance override.")
    if gate not in dict(FeeClearanceOverride.GATE_CHOICES):
        raise ValidationError(f"Unknown gate '{gate}'.")
    if gate == 'report_card' and term is None:
        raise ValidationError("A term is required for a report_card override.")
    if gate == 'promotion' and academic_year is None:
        raise ValidationError("An academic year is required for a promotion override.")
    if gate == 'report_card' and academic_year is not None:
        raise ValidationError("A report_card override must not set an academic year.")
    if gate == 'promotion' and term is not None:
        raise ValidationError("A promotion override must not set a term.")
    if not user_has_permission(granted_by.id, _OVERRIDE_PERMISSION):
        raise PermissionDenied("You do not hold the finance.override_clearance permission.")
    with transaction.atomic():
        # Lock the student row first, consistent with every other finance write
        # (see create_adjustment) -- keeps lock-acquisition order consistent
        # across the module even though this function never touches the ledger.
        locked_student = StudentExtra.objects.select_for_update().get(pk=student.pk)
        duplicate = FeeClearanceOverride.objects.select_for_update().filter(
            student=locked_student, gate=gate, revoked_at__isnull=True,
            term=term, academic_year=academic_year,
        ).exists()
        if duplicate:
            raise ValidationError(
                f"An active override already exists for this student's {gate} gate in this term/year."
            )
        override = FeeClearanceOverride.objects.create(
            student=locked_student, gate=gate, term=term, academic_year=academic_year,
            reason=reason, granted_by=granted_by,
        )
        write_audit_log(
            operator_id=granted_by.id, action_type='CREATE', module='finance',
            description=f"Granted fee-clearance override for student {locked_student.id} ({gate}): {reason}",
        )
        return override


def revoke_clearance_override(*, override, revoked_by, reason):
    """Revoke a FeeClearanceOverride: never edited or deleted, only marked
    revoked (revoked_at/revoked_by/revoke_reason) -- same void-and-reissue
    convention as every other financial record here. Re-reads the row under
    lock before checking "already revoked" so a stale in-memory copy (same
    class of bug void_invoice/void_payment fix for) can never double-revoke."""
    if not reason or not reason.strip():
        raise ValidationError("A reason is required to revoke a fee-clearance override.")
    if not user_has_permission(revoked_by.id, _OVERRIDE_PERMISSION):
        raise PermissionDenied("You do not hold the finance.override_clearance permission.")
    with transaction.atomic():
        fresh = FeeClearanceOverride.objects.select_for_update().get(pk=override.pk)
        if fresh.revoked_at is not None:
            raise ValidationError(f"Override {fresh.pk} is already revoked.")
        fresh.revoked_at = timezone.now()
        fresh.revoked_by = revoked_by
        fresh.revoke_reason = reason
        fresh.save(update_fields=['revoked_at', 'revoked_by', 'revoke_reason'])
        write_audit_log(
            operator_id=revoked_by.id, action_type='DELETE', module='finance',
            description=f"Revoked fee-clearance override {fresh.pk} for student {fresh.student_id} ({fresh.gate}): {reason}",
        )
        return fresh


def is_gate_blocked(*, student_id, gate, term_id=None, academic_year_id=None):
    """The single gating helper Tasks 19/20 call instead of is_fees_clear
    directly (spec section 4.9). Cheap early return when the gate's flag is
    off -- deliberately never calls is_fees_clear in that branch. Only
    report_card passes term_id through to is_fees_clear (the gate that
    conceptually happens per-term); promotion never does. An unknown student
    (is_fees_clear returns None) is never blocked. A False (not clear) result
    is only a block if no ACTIVE override matches this SAME gate AND SAME
    term/year -- an override scoped to a different term/year must never leak
    protection to this one."""
    if gate not in ('report_card', 'promotion'):
        raise ValueError(f"Unknown gate '{gate}'.")
    policy = FeeClearancePolicy.get_solo()
    flag = policy.block_report_cards if gate == 'report_card' else policy.block_promotion
    if not flag:
        return False
    is_clear = is_fees_clear(
        student_id=student_id,
        term_id=term_id if gate == 'report_card' else None,
        grace_threshold=policy.grace_threshold,
    )
    if is_clear is None or is_clear:
        return False
    has_active_override = FeeClearanceOverride.objects.filter(
        student_id=student_id, gate=gate, revoked_at__isnull=True,
        term_id=term_id if gate == 'report_card' else None,
        academic_year_id=academic_year_id if gate == 'promotion' else None,
    ).exists()
    return not has_active_override



def _save_discount_type(discount_type, *, operator, action_type, changed_fields=()):
    """Shared write path for create/update. full_clean() runs DiscountType.clean()
    (the percentage/fixed value rule) and the unique-name check; the IntegrityError
    catch covers the race where two writers both pass validate_unique()."""
    try:
        with transaction.atomic():
            discount_type.full_clean()
            discount_type.save()
            if action_type == 'CREATE':
                description = (
                    f"Created discount type '{discount_type.name}' (id {discount_type.id}): "
                    f"{discount_type.get_kind_display()} {discount_type.value}."
                )
            else:
                description = (
                    f"Updated discount type '{discount_type.name}' (id {discount_type.id}): "
                    f"{', '.join(sorted(changed_fields))}."
                )
            write_audit_log(operator_id=operator.id, action_type=action_type, module='finance', description=description)
    except IntegrityError:
        raise ValidationError({'name': ['A discount type with this name already exists.']})
    return discount_type


def create_discount_type(*, operator, name, kind, value, category=None, active=True):
    """Spec section 4.12: create a DiscountType. Audited as CREATE in module 'finance'."""
    discount_type = DiscountType(name=name, kind=kind, value=value, category=category, active=active)
    return _save_discount_type(discount_type, operator=operator, action_type='CREATE')


def update_discount_type(*, operator, discount_type, changes):
    """Spec section 4.12: update name/kind/value/category/active on an existing
    DiscountType. Deactivation is just changes={'active': False}; there is no
    delete. Audited as UPDATE in module 'finance' with the changed field names.
    A PATCH that changes nothing writes no audit row."""
    before = {field: getattr(discount_type, field) for field in changes}
    for field, new_value in changes.items():
        setattr(discount_type, field, new_value)
    changed = [field for field in changes if before[field] != getattr(discount_type, field)]
    if not changed:
        return discount_type
    return _save_discount_type(discount_type, operator=operator, action_type='UPDATE', changed_fields=changed)


def _check_discount_type_usable(discount_type):
    if not discount_type.active:
        raise ValidationError('This discount type is inactive.')


def _student_display_name(student):
    return student.user.get_full_name() or student.user.username


def _eligible_students(*, grade_level=None, class_stream=None, student_ids=None):
    """Students a discount target covers. Same eligibility as invoice generation:
    active (status=True, not soft-deleted), and for a grade or stream target, placed
    in a live class stream. Callers pass exactly one of the three targets."""
    active = StudentExtra.objects.filter(status=True, deleted_at__isnull=True)
    if grade_level is not None:
        return active.filter(cl__grade=grade_level, cl__is_deleted=False)
    if class_stream is not None:
        return active.filter(cl=class_stream, cl__is_deleted=False)
    return active.filter(id__in=student_ids)


def _resolve_discount_target(*, grade_level=None, class_stream=None, student_ids=None):
    """Spec section 4.12: a discount rule names EXACTLY one target. Returns the
    eligible-student queryset, or raises ValidationError for zero/several targets,
    a deleted class stream, or explicit students that are not eligible."""
    if sum([grade_level is not None, class_stream is not None, bool(student_ids)]) != 1:
        raise ValidationError('Choose exactly one target: a grade level, a class stream, or a list of students.')
    if class_stream is not None and class_stream.is_deleted:
        raise ValidationError('That class stream has been deleted.')
    if student_ids:
        wanted = set(student_ids)
        found = set(_eligible_students(student_ids=wanted).values_list('id', flat=True))
        missing = sorted(wanted - found)
        if missing:
            raise ValidationError(f"These students are not active and cannot be targeted: {missing}.")
    return _eligible_students(grade_level=grade_level, class_stream=class_stream, student_ids=student_ids)


def _rule_students(rule):
    """The students a stored rule currently covers, resolved at apply time."""
    if rule.grade_level_id is not None:
        return _eligible_students(grade_level=rule.grade_level_id)
    if rule.class_stream_id is not None:
        return _eligible_students(class_stream=rule.class_stream_id)
    return _eligible_students(student_ids=list(rule.students.values_list('id', flat=True)))


def _percentage_amounts(*, student_ids, term, percent, category_id):
    """Spec section 4.12: a percentage discount is resolved to a FIXED signed amount
    per student: -(percent / 100) x the student's charged total, rounded half-up to
    whole KES. The charged total is the sum of InvoiceLineItem.amount over the
    student's NON-VOIDED invoices (invoice.voided_at IS NULL) whose fee structure is
    for `term`, limited to `category_id` when the discount type is category-scoped.
    The stored adjustment never changes when later fee edits happen."""
    line_items = InvoiceLineItem.objects.filter(
        invoice__student_id__in=student_ids, invoice__voided_at__isnull=True,
        invoice__fee_structure__term=term,
    )
    if category_id is not None:
        line_items = line_items.filter(category_id=category_id)
    charged = {
        row['invoice__student_id']: row['total']
        for row in line_items.values('invoice__student_id').annotate(total=Sum('amount'))
    }
    # Defense in depth: full_clean enforces 0-100 on DiscountType, but objects.create()
    # bypasses it. A negative or >100 percent would produce a POSITIVE amount, which
    # create_adjustment would post as approved with no approval step. Refuse outright.
    if not 0 <= percent <= 100:
        raise ValidationError(f"A percentage discount must be between 0 and 100 (got {percent}).")
    amounts = {}
    for student_id in student_ids:
        base = charged.get(student_id) or 0
        waived = (Decimal(base) * Decimal(percent) / Decimal(100)).quantize(Decimal('1'), rounding=ROUND_HALF_UP)
        amounts[student_id] = -int(waived)
    return amounts


def _discount_amounts(*, discount_type, term, student_ids, amount_override=None):
    """Signed (negative) amount per student for one discount type. A fixed type uses
    its value, or `amount_override` when given. A fixed type with value 0 (the seeded
    waiver types) has no amount of its own, so the admin must supply one. A
    percentage type cannot take an override."""
    if discount_type.kind == 'percentage':
        if amount_override is not None:
            raise ValidationError('An amount can only be given for a fixed-amount discount type.')
        return _percentage_amounts(
            student_ids=student_ids, term=term, percent=discount_type.value,
            category_id=discount_type.category_id,
        )
    fixed = amount_override if amount_override is not None else discount_type.value
    if fixed <= 0:
        raise ValidationError('This discount type has no fixed value; specify a positive amount.')
    return {student_id: -fixed for student_id in student_ids}


def preview_discount_rule(*, discount_type, term, grade_level=None, class_stream=None, student_ids=None, amount=None):
    """Spec section 4.12 (read-only): the students a rule would cover, each with the
    amount apply would create (negative = waiver; 0 means apply will skip them), and
    the total of those amounts. Writes nothing."""
    _check_discount_type_usable(discount_type)
    students = list(
        _resolve_discount_target(
            grade_level=grade_level, class_stream=class_stream, student_ids=student_ids,
        ).select_related('user').order_by('id')
    )
    amounts = _discount_amounts(
        discount_type=discount_type, term=term, student_ids=[s.id for s in students], amount_override=amount,
    )
    rows = [{'id': s.id, 'name': _student_display_name(s), 'amount': amounts[s.id]} for s in students]
    return {'students': rows, 'count': len(rows), 'total_amount': sum(amounts.values())}


def create_discount_rule(*, operator, discount_type, academic_year, term, grade_level=None, class_stream=None, student_ids=None):
    """Spec section 4.12: store a discount rule. Nothing is discounted until
    apply_discount_rule() runs. Audited as CREATE in module 'finance'."""
    if term.academic_year_id != academic_year.id:
        raise ValidationError('The term does not belong to the chosen academic year.')
    _check_discount_type_usable(discount_type)
    _resolve_discount_target(grade_level=grade_level, class_stream=class_stream, student_ids=student_ids)
    with transaction.atomic():
        rule = DiscountRule.objects.create(
            discount_type=discount_type, academic_year=academic_year, term=term,
            grade_level=grade_level, class_stream=class_stream, active=True, created_by=operator,
        )
        if student_ids:
            rule.students.set(student_ids)
        if grade_level is not None:
            target = f"grade {grade_level.name}"
        elif class_stream is not None:
            target = f"class {class_stream.name}"
        else:
            target = f"{len(set(student_ids))} selected student(s)"
        write_audit_log(
            operator_id=operator.id, action_type='CREATE', module='finance',
            description=f"Created discount rule {rule.id} ('{discount_type.name}', {term.name}) targeting {target}.",
        )
    return rule


def update_discount_rule(*, operator, rule, changes):
    """Only `active` can change: deactivate (or reactivate) a rule. Rules are never
    hard-deleted, and their targets and term stay fixed. Audited as UPDATE."""
    with transaction.atomic():
        rule = DiscountRule.objects.select_for_update().get(pk=rule.pk)
        if 'active' not in changes or changes['active'] == rule.active:
            return rule
        rule.active = changes['active']
        rule.save(update_fields=['active'])
        write_audit_log(
            operator_id=operator.id, action_type='UPDATE', module='finance',
            description=f"{'Activated' if rule.active else 'Deactivated'} discount rule {rule.id}.",
        )
    return rule


def apply_discount_rule(*, rule, operator, amount=None):
    """Spec section 4.12: create ONE pending adjustment per targeted student through
    create_adjustment(). Waivers stay pending until a separate approval, so no ledger
    row is written here. Idempotent: a student this rule already discounted is
    skipped, and the partial unique constraint on StudentFeeAdjustment backs that up.
    Students whose amount resolves to 0 are skipped with a reason. Returns the counts
    and the skipped students. Lock-first: the rule row is locked, then each student
    inside create_adjustment, so two applies of one rule run one after the other."""
    with transaction.atomic():
        rule = DiscountRule.objects.select_for_update().select_related('discount_type', 'term').get(pk=rule.pk)
        if not rule.active:
            raise ValidationError('This discount rule is deactivated.')
        discount_type = rule.discount_type
        _check_discount_type_usable(discount_type)
        students = list(_rule_students(rule).order_by('id'))
        # Lock every targeted student in id order BEFORE reading their charged totals,
        # so an invoice void or new invoice for one of them cannot land between the
        # base read and create_adjustment and leave the waiver sized on a stale base.
        # Ascending id order means two applies cannot deadlock on these locks.
        list(StudentExtra.objects.select_for_update().filter(
            pk__in=[s.id for s in students]).order_by('id').values_list('id', flat=True))
        already_applied = set(
            StudentFeeAdjustment.objects.filter(discount_rule=rule).values_list('student_id', flat=True)
        )
        amounts = _discount_amounts(
            discount_type=discount_type, term=rule.term, student_ids=[s.id for s in students], amount_override=amount,
        )
        created = 0
        skipped = []
        for student in students:
            if student.id in already_applied:
                skipped.append({'student_id': student.id, 'reason': 'already_applied'})
                continue
            value = amounts[student.id]
            if value == 0:
                skipped.append({'student_id': student.id, 'reason': 'zero_amount'})
                continue
            create_adjustment(
                student=student, adjustment_type='discount', amount=value,
                reason=f"{discount_type.name} ({rule.term.name}), discount rule {rule.id}",
                requested_by=operator, category_id=discount_type.category_id,
                discount_type=discount_type, discount_rule=rule,
            )
            created += 1
        write_audit_log(
            operator_id=operator.id, action_type='CREATE', module='finance',
            description=(
                f"Applied discount rule {rule.id} ('{discount_type.name}', {rule.term.name}): "
                f"{created} created, {len(skipped)} skipped."
            ),
        )
    return {'created_count': created, 'skipped_count': len(skipped), 'skipped': skipped}
