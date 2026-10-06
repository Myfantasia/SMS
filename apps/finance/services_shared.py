"""Cross-cutting finance services usable by every finance sub-module (fees now,
payroll/GL in later phases)."""
from django.db import transaction
from django.utils import timezone

from apps.finance.models_shared import DocumentSequenceCounter


def next_document_number(document_type: str, year: int | None = None) -> str:
    """Atomically allocate the next sequential number for a document type
    (e.g. 'INV', 'RCPT', 'PAYSLIP') in the given year, formatted as
    '{document_type}-{year}-{number:06d}'. Numbers are never reused, including
    after a document is voided — the counter only ever goes up."""
    year = year or timezone.now().year
    with transaction.atomic():
        counter, _ = DocumentSequenceCounter.objects.select_for_update().get_or_create(
            document_type=document_type, year=year,
        )
        counter.last_number += 1
        counter.save(update_fields=['last_number'])
        return f"{document_type}-{year}-{counter.last_number:06d}"
