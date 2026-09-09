"""Fee-domain models: categories, structures, invoicing, payments, and the
per-student ledger. See docs/superpowers/specs/2026-09-09-finance-subsystem-design.md
section 4 for the full design this file implements."""
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models


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
