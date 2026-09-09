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
