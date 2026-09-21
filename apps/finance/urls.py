"""URL routes for the `finance` app.

Track B step 1: FinanceOverviewAPI physically relocated here from
school/views/finance_views.py. Path kept byte-for-byte identical to the
original (verified against the frontend's actual call site in
FinanceHub.tsx) so the frontend needs zero changes.
"""
from django.urls import path

from apps.finance.views import FinanceOverviewAPI, ActivateFeeStructureAPIView

urlpatterns = [
    path('api/finance-overview/', FinanceOverviewAPI.as_view(), name='api_finance_overview'),
]

urlpatterns += [
    path('api/finance/fee-structures/<int:structure_id>/activate/', ActivateFeeStructureAPIView.as_view(), name='api_activate_fee_structure'),
]
