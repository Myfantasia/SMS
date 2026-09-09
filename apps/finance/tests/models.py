from django.db import models
from apps.finance.models_shared import ImmutableFinancialRecordMixin


class DummyImmutableModel(ImmutableFinancialRecordMixin, models.Model):
    """Test-only concrete model to exercise the mixin without touching real finance models."""
    amount = models.IntegerField()
    note = models.CharField(max_length=50, default='')
    PROTECTED_FIELDS = ('amount',)

    class Meta:
        app_label = 'finance'
