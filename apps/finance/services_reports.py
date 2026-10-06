"""Read-only cross-cutting fee reporting. Every function here only reads —
never writes across module boundaries, per spec section 3.

Ledger caveats every report here respects:
- Void reversals reuse entry_type 'charge'/'payment' with the opposite sign, so
  ledger rows are never counted and "billed"/"collected" is never derived from
  entry_type. Balances come only from each student's LATEST running_balance;
  every other figure comes from the source tables (invoices not voided,
  payments not voided and confirmed).
- A ledger row's generic `reference` can dangle after a hard delete, so it is
  never dereferenced."""
from datetime import timedelta

from django.db.models import Sum
from django.utils import timezone

from apps.finance.models_fees import Invoice, InvoiceLineItem, Payment, StudentFeeLedgerEntry

_AGING_BUCKETS = [(30, '0-30'), (60, '31-60'), (90, '61-90')]


def _latest_ledger_entry_per_student():
    """One row per student: their most recent StudentFeeLedgerEntry, i.e. their
    current balance. Uses Postgres's DISTINCT ON via .distinct(field). This
    loads every student that has ledger history into memory when evaluated —
    fine at school scale (a few thousand rows)."""
    return StudentFeeLedgerEntry.objects.order_by('student_id', '-id').distinct('student_id')


def _confirmed_payments():
    return Payment.objects.filter(voided_at__isnull=True, status='confirmed')


def _open_invoices():
    """Non-voided invoices that are not fully paid."""
    return Invoice.objects.filter(voided_at__isnull=True).exclude(status__in=['paid', 'voided'])


def fee_kpi_tiles():
    """Headline numbers:
    - outstanding_ar: sum of every student's positive latest balance.
    - total_credit: sum of |negative latest balance| (overpaid students), kept
      separate so credits are visible rather than silently netted off AR.
    - unpaid_invoice_count: non-voided invoices not fully paid.
    - overdue_count: non-voided invoices that are unpaid or partially paid
      whose fee structure's term ended before today (nothing in Phase 1 writes
      the 'overdue' status and invoices have no due date, so "the term is over
      and it is still unpaid" is the definition used).
    - collections_30d: confirmed, non-voided payments dated in the last 30 days."""
    balances = [e.running_balance for e in _latest_ledger_entry_per_student()]
    today = timezone.localdate()
    overdue_count = _open_invoices().filter(
        status__in=['unpaid', 'partially_paid'], fee_structure__term__end_date__lt=today,
    ).count()
    collections_30d = _confirmed_payments().filter(
        date__gte=today - timedelta(days=30),
    ).aggregate(total=Sum('amount'))['total'] or 0
    return {
        'outstanding_ar': sum(b for b in balances if b > 0),
        'total_credit': sum(-b for b in balances if b < 0),
        'unpaid_invoice_count': _open_invoices().count(),
        'overdue_count': overdue_count,
        'collections_30d': collections_30d,
    }


def collections_trend(days=30):
    """Confirmed, non-voided payment totals per day for the last `days` days, oldest first."""
    since = timezone.localdate() - timedelta(days=days)
    rows = (
        _confirmed_payments().filter(date__gte=since)
        .values('date').annotate(total=Sum('amount')).order_by('date')
    )
    return list(rows)


def fee_category_breakdown():
    """Invoiced totals per fee category across non-voided invoices, largest first."""
    rows = (
        InvoiceLineItem.objects.exclude(invoice__status='voided')
        .values('category__name').annotate(total=Sum('amount')).order_by('-total')
    )
    return list(rows)


def _bucket(days_outstanding):
    if days_outstanding is None:
        return 'no-invoice'
    for upper_bound, label in _AGING_BUCKETS:
        if days_outstanding <= upper_bound:
            return label
    return '90+'


def student_balance_aging():
    """Every student with a positive balance, oldest debt first (unknown age last).
    `days_outstanding` is the days since the issue date (local) of the student's
    OLDEST non-voided, not-fully-paid invoice; None when the balance has no such
    invoice behind it (e.g. it comes from an adjustment)."""
    today = timezone.localdate()
    latest = [
        e for e in _latest_ledger_entry_per_student().select_related('student__user')
        if e.running_balance > 0
    ]
    oldest_issued = {}
    for student_id, issued_at in (
        _open_invoices().filter(student_id__in=[e.student_id for e in latest])
        .values_list('student_id', 'issued_at')
    ):
        if student_id not in oldest_issued or issued_at < oldest_issued[student_id]:
            oldest_issued[student_id] = issued_at

    rows = []
    for entry in latest:
        issued_at = oldest_issued.get(entry.student_id)
        days_outstanding = (today - timezone.localtime(issued_at).date()).days if issued_at else None
        rows.append({
            'student_id': entry.student_id,
            'student_name': entry.student.user.get_full_name() or entry.student.user.username,
            'balance': entry.running_balance,
            'days_outstanding': days_outstanding,
            'bucket': _bucket(days_outstanding),
        })
    return sorted(rows, key=lambda row: (row['days_outstanding'] is None, -(row['days_outstanding'] or 0)))
