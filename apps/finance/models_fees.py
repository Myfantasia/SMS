"""Fee-domain models: categories, structures, invoicing, payments, and the
per-student ledger. See docs/superpowers/specs/2026-09-09-finance-subsystem-design.md
section 4 for the full design this file implements."""
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import models

from apps.finance.models_shared import CashAccount, FinancialRecordImmutableError, ImmutableFinancialRecordMixin


class FeeCategory(models.Model):
    """Admin-editable fee category (Tuition, Transport, Boarding, Exam, Activity,
    etc.) — a real DB table, not an enum, following this repo's DB-first config
    convention (see SubjectQuota/GradingRule). Used both as fee-structure line
    items and as a reporting dimension."""
    name = models.CharField(max_length=100, unique=True)
    description = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = 'finance_feecategory'
        verbose_name_plural = 'Fee categories'

    def __str__(self):
        return self.name


class FeeStructure(models.Model):
    """One per (grade, term) — a named template ('Grade 7 - Term 2 2026'). The
    unique_together below is the DB-enforced version of the spec's business rule
    'only one structure per grade/term'."""
    STATUS_CHOICES = [('draft', 'Draft'), ('active', 'Active')]

    grade_level = models.ForeignKey('academics.GradeLevel', on_delete=models.PROTECT, related_name='fee_structures')
    term = models.ForeignKey('academics.ExamTerm', on_delete=models.PROTECT, related_name='fee_structures')
    name = models.CharField(max_length=150)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'finance_feestructure'
        unique_together = [('grade_level', 'term')]

    def __str__(self):
        return self.name


class FeeStructureItem(models.Model):
    """One line item on a FeeStructure. Mandatory items (is_optional=False) apply
    to every student in the grade automatically when invoices are generated;
    optional items only apply to students with a StudentFeeItemEnrollment row."""
    fee_structure = models.ForeignKey(FeeStructure, on_delete=models.CASCADE, related_name='items')
    category = models.ForeignKey(FeeCategory, on_delete=models.PROTECT, related_name='structure_items')
    amount = models.PositiveIntegerField()
    is_optional = models.BooleanField(default=False)

    class Meta:
        db_table = 'finance_feestructureitem'
        unique_together = [('fee_structure', 'category')]

    def __str__(self):
        return f"{self.fee_structure.name} - {self.category.name}: {self.amount}"


class StudentFeeItemEnrollment(models.Model):
    """The opt-in roster for optional FeeStructureItems — e.g. which students are
    enrolled in 'Transport' this term. Admin manages this as a checklist per
    optional item. A duplicate enrollment for the same (student, item) is a
    data-entry mistake, blocked at the DB level."""
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.CASCADE, related_name='fee_item_enrollments')
    fee_structure_item = models.ForeignKey(FeeStructureItem, on_delete=models.CASCADE, related_name='enrollments')
    enrolled_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'finance_studentfeeitemenrollment'
        unique_together = [('student', 'fee_structure_item')]


class StudentFeeLedgerEntry(models.Model):
    """The authoritative record of what a student currently owes — a real
    subsidiary accounts-receivable ledger, one per student (spec section 4.6).
    Never write to this table directly; always go through
    services_fees.post_ledger_entry(), which is the only thing that computes
    running_balance correctly under concurrent writes."""
    ENTRY_TYPE_CHOICES = [
        ('charge', 'Charge'),
        ('payment', 'Payment'),
        ('adjustment', 'Adjustment'),
    ]
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.PROTECT, related_name='fee_ledger_entries')
    entry_type = models.CharField(max_length=10, choices=ENTRY_TYPE_CHOICES)
    amount = models.IntegerField(help_text='Signed: positive increases the balance owed, negative decreases it.')
    running_balance = models.IntegerField()
    content_type = models.ForeignKey(ContentType, on_delete=models.PROTECT)
    object_id = models.PositiveIntegerField()
    reference = GenericForeignKey('content_type', 'object_id')
    description = models.CharField(max_length=255)
    date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'finance_studentfeeledgerentry'
        indexes = [models.Index(fields=['student', 'date'])]
        ordering = ['id']

    def __str__(self):
        return f"{self.student} {self.entry_type} {self.amount} (bal {self.running_balance})"


class DiscountType(models.Model):
    """Admin-editable discount catalogue (spec section 4.12). A row says HOW a
    waiver is calculated -- a fixed KES amount or a whole-number percentage --
    and optionally which FeeCategory it applies to (null = all fees). The
    concrete amount for a given adjustment is supplied per adjustment, so the
    seeded waiver rows carry value 0 for 'fixed'.

    Never hard-deleted once used: there is no DELETE endpoint and the admin
    disables delete. Deactivate with active=False instead. The FK from
    StudentFeeAdjustment is PROTECT as a second line of defence."""
    KIND_CHOICES = [
        ('fixed', 'Fixed amount'),
        ('percentage', 'Percentage'),
    ]
    name = models.CharField(max_length=100, unique=True)
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    value = models.IntegerField(
        help_text='KES amount for kind=fixed (>= 0); whole-number percent 0-100 for kind=percentage.',
    )
    category = models.ForeignKey(
        FeeCategory, on_delete=models.PROTECT, null=True, blank=True, related_name='discount_types',
        help_text='Leave empty to apply to all fees.',
    )
    active = models.BooleanField(default=True)

    class Meta:
        db_table = 'finance_discounttype'

    def __str__(self):
        return self.name

    def clean(self):
        validate_discount_kind_value(self.kind, self.value)


def validate_discount_kind_value(kind, value):
    """Shared rule for DiscountType.value: percentage must be 0-100, fixed must be >= 0."""
    if kind == 'percentage' and not (0 <= value <= 100):
        raise ValidationError('A percentage discount must be a whole number from 0 to 100.')
    if kind == 'fixed' and value < 0:
        raise ValidationError('A fixed discount must be zero or more (KES).')


class DiscountRule(models.Model):
    """A term-start discount rule (spec section 4.12): "give everyone in Grade 7
    Term 2 a 10% sibling discount". It names exactly one target -- a grade level,
    a class stream, or an explicit list of students (`students`) -- and is applied
    explicitly by an admin via services_fees.apply_discount_rule(), which creates
    one pending StudentFeeAdjustment per targeted student.

    Exactly-one-target is enforced in the service layer (the M2M cannot be checked
    by a model constraint). Never hard-deleted once created: deactivate with
    active=False instead, so the adjustments it produced keep a valid parent."""
    discount_type = models.ForeignKey(
        'finance.DiscountType', on_delete=models.PROTECT, related_name='rules',
    )
    academic_year = models.ForeignKey('academics.AcademicYear', on_delete=models.PROTECT, related_name='discount_rules')
    term = models.ForeignKey('academics.ExamTerm', on_delete=models.PROTECT, related_name='discount_rules')
    grade_level = models.ForeignKey(
        'academics.GradeLevel', on_delete=models.PROTECT, null=True, blank=True, related_name='discount_rules',
    )
    class_stream = models.ForeignKey(
        'academics.ClassStream', on_delete=models.PROTECT, null=True, blank=True, related_name='discount_rules',
    )
    students = models.ManyToManyField('identity.StudentExtra', blank=True, related_name='discount_rules')
    active = models.BooleanField(default=True, db_index=True)
    created_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'finance_discountrule'

    def __str__(self):
        return f"{self.discount_type.name} rule for {self.term}"


class StudentFeeAdjustment(models.Model):
    """A discount, scholarship, bursary, penalty, or correction applied to a
    student's fee account — spec section 4.4.

    Two-step approval workflow (spec section 4.10, Task 30): a negative/
    waiving amount (discount, scholarship, bursary) is created `pending` by
    create_adjustment() and posts NO ledger entry until a SEPARATE user
    holding finance.approve_adjustment -- never the requester -- calls
    decide_adjustment() to approve or reject it. A positive amount skips the
    workflow entirely: there is nothing to approve, so create_adjustment()
    self-approves it immediately (status='approved', decided_by=requested_by)
    exactly as before this feature existed.

    `status` defaults to 'approved' specifically so that the pending
    migration (run by the user, never by this code -- see
    docs/superpowers/specs/2026-09-09-finance-subsystem-design.md section 11
    and this repo's migrations rule) lands every EXISTING row as 'approved':
    those rows were all created under the old one-step flow and already
    posted to the ledger immediately, i.e. already effectively approved. New
    code never relies on this default -- create_adjustment() and
    decide_adjustment() always pass status explicitly.

    `approved_by` predates this workflow. Rather than rename it or have it
    mean two different things, it is repurposed narrowly: it is set if and
    only if a row was approved through an actual decide_adjustment() decision
    (i.e. a genuine two-person approval of a formerly-pending row), mirroring
    `decided_by` in that one case. It stays None for 'pending' rows,
    'rejected' rows, AND for a positive amount's immediate self-approval --
    because in that last case there was no approval event to record, only a
    requester who never needed one; `decided_by` already covers "who decided"
    (including the self-approve case) without overloading `approved_by`'s
    original, narrower meaning ("the user who approved this waiver"). Any
    code that reads `approved_by` to mean "this was approved" should check
    `status == 'approved'` instead; `approved_by` is now a secondary,
    sometimes-None detail about HOW it got approved, not the source of truth
    for whether it is approved.

    `decided_by` / `decided_at` / `decision_note` are the authoritative record
    of ANY decision -- self-approval, formal approval, or rejection."""
    ADJUSTMENT_TYPE_CHOICES = [
        ('discount', 'Discount'),
        ('scholarship', 'Scholarship'),
        ('bursary', 'Bursary'),
        ('penalty', 'Penalty'),
        ('correction', 'Correction'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.PROTECT, related_name='fee_adjustments')
    category = models.ForeignKey(FeeCategory, on_delete=models.PROTECT, null=True, blank=True, related_name='adjustments')
    adjustment_type = models.CharField(max_length=15, choices=ADJUSTMENT_TYPE_CHOICES)
    amount = models.IntegerField(help_text='Signed: negative waives/reduces the balance, positive adds to it.')
    reason = models.TextField()
    requested_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, related_name='+')
    approved_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='approved', db_index=True)
    decided_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True, default='')
    # Set when the adjustment came from a DiscountType (Task 35/36). Nullable so existing rows stay valid.
    discount_type = models.ForeignKey(
        'finance.DiscountType', on_delete=models.PROTECT, null=True, blank=True, related_name='adjustments',
    )
    # Set only when created by apply_discount_rule(). The partial unique constraint below
    # is the DB-level guarantee that one rule never discounts the same student twice.
    discount_rule = models.ForeignKey(
        DiscountRule, on_delete=models.PROTECT, null=True, blank=True, related_name='adjustments',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'finance_studentfeeadjustment'
        constraints = [
            models.UniqueConstraint(
                fields=['discount_rule', 'student'],
                condition=models.Q(discount_rule__isnull=False),
                name='uniq_discount_rule_per_student',
            ),
        ]


class Invoice(ImmutableFinancialRecordMixin, models.Model):
    """A formal, sequentially-numbered bill to a student for one FeeStructure,
    snapshotting its line items at generation time (see InvoiceLineItem below)
    so a later FeeStructure edit never retroactively changes an issued invoice.
    Financial fields are immutable after creation (spec section 4.5) — the only
    permitted changes are `status` transitions and the void_* fields."""
    STATUS_CHOICES = [
        ('unpaid', 'Unpaid'),
        ('partially_paid', 'Partially Paid'),
        ('paid', 'Paid'),
        ('overdue', 'Overdue'),
        ('voided', 'Voided'),
    ]
    PROTECTED_FIELDS = ('student_id', 'fee_structure_id', 'total', 'invoice_number')

    student = models.ForeignKey('identity.StudentExtra', on_delete=models.PROTECT, related_name='invoices')
    fee_structure = models.ForeignKey(FeeStructure, on_delete=models.PROTECT, related_name='invoices')
    total = models.PositiveIntegerField()
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='unpaid')
    invoice_number = models.CharField(max_length=30, unique=True)
    issued_at = models.DateTimeField(auto_now_add=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    void_reason = models.TextField(blank=True)

    class Meta:
        db_table = 'finance_invoice'
        constraints = [
            models.UniqueConstraint(
                fields=['student', 'fee_structure'],
                condition=~models.Q(status='voided'),
                name='uniq_active_invoice_per_student_structure',
            ),
        ]

    def __str__(self):
        return self.invoice_number


class InvoiceLineItem(models.Model):
    """A snapshot of one charge on an Invoice at the moment it was generated —
    category, description, and amount are copied in, not referenced live, so
    editing a FeeStructureItem later never changes history."""
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='line_items')
    category = models.ForeignKey(FeeCategory, on_delete=models.PROTECT, related_name='+')
    description = models.CharField(max_length=255)
    amount = models.PositiveIntegerField()

    class Meta:
        db_table = 'finance_invoicelineitem'


class Payment(ImmutableFinancialRecordMixin, models.Model):
    """A recorded payment against a student's fee account. `invoice` is nullable
    because a payment can be applied against a student's overall balance rather
    than one specific invoice. `method` stays a fixed choice list, not a
    DB-configurable table — there is no real payment-gateway integration to
    model against yet (spec section 9); `status` is reserved for that future
    gateway path (pending/failed), manual entries are always 'confirmed'
    immediately."""
    METHOD_CHOICES = [
        ('cash', 'Cash'),
        ('bank_transfer', 'Bank Transfer'),
        ('mpesa', 'M-Pesa'),
        ('cheque', 'Cheque'),
        ('other', 'Other'),
    ]
    STATUS_CHOICES = [
        ('confirmed', 'Confirmed'),
        ('pending', 'Pending'),
        ('failed', 'Failed'),
    ]
    PROTECTED_FIELDS = ('student_id', 'invoice_id', 'amount', 'method', 'reference', 'date')

    student = models.ForeignKey('identity.StudentExtra', on_delete=models.PROTECT, related_name='payments')
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, null=True, blank=True, related_name='payments')
    amount = models.PositiveIntegerField()
    method = models.CharField(max_length=15, choices=METHOD_CHOICES)
    reference = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='confirmed')
    recorded_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, related_name='+')
    cash_account = models.ForeignKey(CashAccount, on_delete=models.PROTECT, null=True, blank=True, related_name='payments')
    date = models.DateField()
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    void_reason = models.TextField(blank=True)

    class Meta:
        db_table = 'finance_payment'
        indexes = [models.Index(fields=['student', 'date'])]

    def __str__(self):
        return f"{self.student} - {self.amount} ({self.method})"


class InvoiceCreditApplication(ImmutableFinancialRecordMixin, models.Model):
    """Overpayment credit auto-applied to a new invoice at generation time (spec
    section 4.8). Deliberately posts NO ledger entry: the ledger's running
    balance already nets the credit against the new charge, so a second entry
    would double-count it. The invoice's status counts these rows alongside
    confirmed payments. Immutable; if the invoice is voided the row is kept but
    stops counting."""
    PROTECTED_FIELDS = ('student_id', 'invoice_id', 'amount')

    student = models.ForeignKey('identity.StudentExtra', on_delete=models.PROTECT, related_name='credit_applications')
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name='credit_applications')
    amount = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'finance_invoicecreditapplication'

    def __str__(self):
        return f"{self.invoice} credit {self.amount}"


class FeeClearancePolicy(models.Model):
    """School-level setting (spec section 4.9): whether an unpaid fee balance
    blocks a report card or promotion, and how much leeway (grace_threshold, a
    whole-KES balance at or below which a student still counts as clear) is
    allowed. Both flags default OFF so deploying this module never silently
    withholds a report card -- a school opts in. Singleton, following the
    exact convention already established by GlobalAllocationPolicy
    (apps/allocations/models.py) and TimetableConstraint: save() forces pk=1,
    get_solo() is get_or_create(pk=1, ...) so two concurrent first-reads race
    on the DB's own uniqueness of pk=1 rather than a Python-level check, and
    the row is never deleted (see delete() below)."""
    block_report_cards = models.BooleanField(default=False)
    block_promotion = models.BooleanField(default=False)
    grace_threshold = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, null=True, blank=True, related_name='+')

    class Meta:
        db_table = 'finance_feeclearancepolicy'
        verbose_name = 'Fee clearance policy'
        verbose_name_plural = 'Fee clearance policy'

    def save(self, *args, **kwargs):
        self.pk = 1  # Singleton: forces this table to only ever have one row.
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise FinancialRecordImmutableError("The fee-clearance policy singleton cannot be deleted.")

    @classmethod
    def get_solo(cls):
        """get_or_create(pk=1, ...), not a filter-then-create -- so two concurrent
        first-reads racing to create row 1 rely on the DB's own primary-key
        uniqueness (get_or_create retries with a plain get() if its insert hits
        an IntegrityError) rather than a Python-level check-then-act that a race
        could slip through."""
        policy, _created = cls.objects.get_or_create(pk=1)
        return policy

    def __str__(self):
        return (
            f"Fee clearance policy (report cards {'blocked' if self.block_report_cards else 'allowed'}, "
            f"promotion {'blocked' if self.block_promotion else 'allowed'}, grace {self.grace_threshold})"
        )


class FeeClearanceOverride(ImmutableFinancialRecordMixin, models.Model):
    """One student's exemption from one fee-clearance gate (spec section 4.9) --
    e.g. "let this student's report card through this term despite an unpaid
    balance." Immutable and never deleted, like every other financial record
    here: a mistake is corrected by revoking it (revoked_at/revoked_by/
    revoke_reason), not by editing or deleting the row.

    Exactly one of `term` (report_card gate) / `academic_year` (promotion gate)
    is set, per which gate this override is for -- enforced in
    services_fees.grant_clearance_override(), not here, since the model layer
    has no clean way to make a FK's nullability conditional on a sibling field.

    Uniqueness ("at most one ACTIVE override per (student, gate, term/year)")
    needs TWO partial constraints, not one covering all four columns: a
    plain multi-column UniqueConstraint treats NULL as never equal to NULL, so
    a single constraint over (student, gate, term, academic_year) would silently
    stop protecting BOTH gates -- report_card rows always have academic_year
    NULL, promotion rows always have term NULL, so every row would differ from
    every other row in at least one column and never collide. Splitting into
    one constraint per gate, each scoped to just the FK that gate actually uses
    (student+term for report_card, student+academic_year for promotion) keeps
    every column in each constraint non-null for the rows it applies to, so the
    DB can actually enforce it."""
    GATE_CHOICES = [
        ('report_card', 'Report Card'),
        ('promotion', 'Promotion'),
    ]
    PROTECTED_FIELDS = ('student_id', 'gate', 'term_id', 'academic_year_id', 'reason', 'granted_by_id')

    student = models.ForeignKey('identity.StudentExtra', on_delete=models.PROTECT, related_name='fee_clearance_overrides')
    gate = models.CharField(max_length=15, choices=GATE_CHOICES)
    term = models.ForeignKey('academics.ExamTerm', on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    academic_year = models.ForeignKey('academics.AcademicYear', on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    reason = models.TextField()
    granted_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    revoke_reason = models.TextField(blank=True)

    class Meta:
        db_table = 'finance_feeclearanceoverride'
        constraints = [
            models.UniqueConstraint(
                fields=['student', 'term'],
                condition=models.Q(revoked_at__isnull=True, gate='report_card'),
                name='uniq_active_override_report_card',
            ),
            models.UniqueConstraint(
                fields=['student', 'academic_year'],
                condition=models.Q(revoked_at__isnull=True, gate='promotion'),
                name='uniq_active_override_promotion',
            ),
        ]

    def __str__(self):
        return f"{self.student} override for {self.get_gate_display()}"


class Receipt(models.Model):
    """1:1 with a confirmed Payment. Generated synchronously the instant the
    payment is confirmed — a single row, no Celery needed."""
    payment = models.OneToOneField(Payment, on_delete=models.PROTECT, related_name='receipt')
    receipt_number = models.CharField(max_length=30, unique=True)
    generated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'finance_receipt'

    def __str__(self):
        return self.receipt_number
