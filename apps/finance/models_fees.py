"""Fee-domain models: categories, structures, invoicing, payments, and the
per-student ledger. See docs/superpowers/specs/2026-09-09-finance-subsystem-design.md
section 4 for the full design this file implements."""
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
