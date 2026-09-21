"""Backward-compatible re-exports. The real is_fees_clear() and
get_credit_balance() implementations live in services_fees.py alongside the
rest of the fee-domain logic they depend on (StudentFeeLedgerEntry) — this
file exists so `from apps.finance.services import is_fees_clear` (and
get_credit_balance) keeps working unchanged for any existing or future caller
(e.g. results/promotion gates).

Public service surface for the `finance` app. RULE: other apps must only
import from here, never from finance's models or services_fees directly.

This app may import services from:
    - apps.identity.services
    - apps.students.services
"""
from apps.finance.services_fees import get_credit_balance, is_fees_clear  # noqa: F401  (public re-exports)
