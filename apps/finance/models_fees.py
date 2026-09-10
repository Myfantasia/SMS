"""Fee-domain models: categories, structures, invoicing, payments, and the
per-student ledger. See docs/superpowers/specs/2026-09-09-finance-subsystem-design.md
section 4 for the full design this file implements."""
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from apps.finance.models_shared import CashAccount, ImmutableFinancialRecordMixin


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


class StudentFeeAdjustment(models.Model):
    """A discount, scholarship, bursary, penalty, or correction applied to a
    student's fee account — spec section 4.4. A negative/waiving amount
    (discount, scholarship, bursary) requires approved_by to be set; this is
    enforced in create_adjustment(), not here, since the model layer can't
    know who is allowed to approve."""
    ADJUSTMENT_TYPE_CHOICES = [
        ('discount', 'Discount'),
        ('scholarship', 'Scholarship'),
        ('bursary', 'Bursary'),
        ('penalty', 'Penalty'),
        ('correction', 'Correction'),
    ]
    student = models.ForeignKey('identity.StudentExtra', on_delete=models.PROTECT, related_name='fee_adjustments')
    category = models.ForeignKey(FeeCategory, on_delete=models.PROTECT, null=True, blank=True, related_name='adjustments')
    adjustment_type = models.CharField(max_length=15, choices=ADJUSTMENT_TYPE_CHOICES)
    amount = models.IntegerField(help_text='Signed: negative waives/reduces the balance, positive adds to it.')
    reason = models.TextField()
    requested_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, related_name='+')
    approved_by = models.ForeignKey('auth.User', on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'finance_studentfeeadjustment'


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
