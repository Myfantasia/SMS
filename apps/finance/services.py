"""Public service surface for the `finance` app.

Fee/finance tracking. No models exist yet -- `apps/finance/views.py`'s
`FinanceOverviewAPI` (relocated here in Track B step 1) is a read-only
aggregate over StudentExtra.fee/TeacherExtra.salary, with no persisted
fee-ledger data behind it.

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet.

This app may import services from:
    - apps.identity.services
    - apps.students.services

Track A/B status: this is one of the two apps (with `analytics`) chosen as
the lowest-risk Track B pilot precisely because there's no real model to
relocate yet -- the scaffold+URL+services conventions get proven here
first, before any actual data is at stake.

`is_fees_clear` below is a placeholder matching the shape `results` would
call if/when StudentTermResult.results_withheld is ever actually wired up
(currently dormant -- that field is defined but never read/written anywhere
in the codebase today, verified by grep). Don't build real fee-tracking
logic speculatively; this exists only so the call shape is documented for
whoever picks up that feature.
"""
from typing import Optional

from apps.finance.services_fees import get_credit_balance  # noqa: F401  (public re-export)


def is_fees_clear(*, student_id: int, term_id: int) -> Optional[bool]:
    """Returns None (unknown/not tracked) today -- no fee data exists to check.
    A real implementation would return True/False once finance has its own
    model(s) to query."""
    return None
