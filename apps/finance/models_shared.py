"""Shared building blocks for the finance app: the immutability guard every
financial record uses, and the physical cash/bank accounts payments and GL
entries can reference. Kept separate from models_fees.py because
models_payroll.py and models_gl.py (later phases) both need these too."""
from django.db import models


class FinancialRecordImmutableError(Exception):
    """Raised when code tries to change a protected field on an already-created
    financial record. Correcting a mistake means voiding the record and creating
    a new one — see the Finance Subsystem Design spec, section 4.5."""


class ImmutableFinancialRecordMixin(models.Model):
    """Abstract base that blocks edits to a subclass's PROTECTED_FIELDS once the
    row already has a primary key. Status fields and void_* fields are deliberately
    left out of PROTECTED_FIELDS by each subclass, since those ARE allowed to change
    (a status transition, or voiding). This is a backend-layer guarantee — it runs
    regardless of what the frontend sends."""
    PROTECTED_FIELDS: tuple = ()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self.pk is not None and self.PROTECTED_FIELDS:
            db_row = type(self).objects.filter(pk=self.pk).values(*self.PROTECTED_FIELDS).first()
            if db_row is not None:
                for field_name in self.PROTECTED_FIELDS:
                    if getattr(self, field_name) != db_row[field_name]:
                        raise FinancialRecordImmutableError(
                            f"{type(self).__name__}.{field_name} cannot be changed after "
                            f"creation (record pk={self.pk}). Void this record and create "
                            f"a new one instead."
                        )
        super().save(*args, **kwargs)


class CashAccount(models.Model):
    """Where money physically sits. Seeded with a small default set (see the
    seed_finance_cash_accounts management command in a later task) even without
    detailed requirements yet — Payment and (in a later phase) GeneralLedgerEntry
    both reference it optionally."""
    ACCOUNT_TYPE_CHOICES = [
        ('bank', 'Bank Account'),
        ('petty_cash', 'Petty Cash'),
        ('mobile_money', 'Mobile Money'),
    ]
    name = models.CharField(max_length=100, unique=True)
    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'finance_cashaccount'

    def __str__(self):
        return self.name


class DocumentSequenceCounter(models.Model):
    """Backing store for next_document_number() in services_shared.py. One row
    per (document_type, year); last_number is incremented under select_for_update
    so concurrent requests can never generate the same number."""
    document_type = models.CharField(max_length=20)
    year = models.PositiveIntegerField()
    last_number = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = 'finance_documentsequencecounter'
        unique_together = [('document_type', 'year')]
