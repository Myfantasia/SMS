"""Fee-domain business logic. Every function here that touches the ledger runs
inside transaction.atomic() and locks the affected student's StudentExtra row
with select_for_update() first, per the Finance Subsystem Design spec section 11."""
from django.core.exceptions import PermissionDenied, ValidationError
from django.contrib.contenttypes.models import ContentType
from django.db import models, transaction
from django.db.models import ProtectedError, Sum
from django.utils import timezone

from apps.finance.models_fees import (
    StudentFeeLedgerEntry, StudentFeeAdjustment, Invoice, InvoiceLineItem, StudentFeeItemEnrollment,
    Payment, Receipt, InvoiceCreditApplication, FeeCategory, FeeClearancePolicy, FeeClearanceOverride,
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


def create_adjustment(*, student, adjustment_type, amount, reason, requested_by, category_id=None):
    """Create a StudentFeeAdjustment. Spec section 4.10 (Task 30): a negative
    amount (a discount/scholarship/bursary that waives fees) is created
    `pending` and posts NOTHING to the ledger -- it waits for a separate
    decide_adjustment() approval. A positive amount (penalty/correction) needs
    no approval, so it is created `approved` and posted immediately, exactly
    as before this feature existed; `decided_by` is set to `requested_by`
    since the "decision" was simply that none was required (see the model
    docstring for why `approved_by` is deliberately left None in this case).
    `category_id` (optional) is resolved to the FeeCategory here. The caller's
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
