"""URL routes for the `finance` app.

Track B step 1: FinanceOverviewAPI physically relocated here from
school/views/finance_views.py. Path kept byte-for-byte identical to the
original (verified against the frontend's actual call site in
FinanceHub.tsx) so the frontend needs zero changes.
"""
from django.urls import path

from apps.finance.views import (
    FinanceOverviewAPI, ActivateFeeStructureAPIView,
    FeeCategoryListCreateAPIView, FeeStructureListCreateAPIView,
    FeeStructureDetailAPIView, StudentFeeItemEnrollmentSetAPIView,
    InvoiceListAPIView, InvoiceDetailAPIView, PaymentListCreateAPIView, VoidInvoiceAPIView, VoidPaymentAPIView,
    StudentFeeAdjustmentCreateAPIView, StudentFeeLedgerStatementAPIView, FeeClearanceStatusAPIView,
)

urlpatterns = [
    path('api/finance-overview/', FinanceOverviewAPI.as_view(), name='api_finance_overview'),
]

urlpatterns += [
    path('api/finance/fee-structures/<int:structure_id>/activate/', ActivateFeeStructureAPIView.as_view(), name='api_activate_fee_structure'),
    path('api/finance/fee-categories/', FeeCategoryListCreateAPIView.as_view(), name='api_fee_categories'),
    path('api/finance/fee-structures/', FeeStructureListCreateAPIView.as_view(), name='api_fee_structures'),
    path('api/finance/fee-structures/<int:structure_id>/', FeeStructureDetailAPIView.as_view(), name='api_fee_structure_detail'),
    path('api/finance/fee-structure-items/<int:item_id>/enrollments/', StudentFeeItemEnrollmentSetAPIView.as_view(), name='api_fee_structure_item_enrollments'),
    path('api/finance/invoices/', InvoiceListAPIView.as_view(), name='api_invoices'),
    path('api/finance/invoices/<int:invoice_id>/', InvoiceDetailAPIView.as_view(), name='api_invoice_detail'),
    path('api/finance/invoices/<int:invoice_id>/void/', VoidInvoiceAPIView.as_view(), name='api_void_invoice'),
    path('api/finance/payments/', PaymentListCreateAPIView.as_view(), name='api_payments'),
    path('api/finance/payments/<int:payment_id>/void/', VoidPaymentAPIView.as_view(), name='api_void_payment'),
    path('api/finance/adjustments/', StudentFeeAdjustmentCreateAPIView.as_view(), name='api_fee_adjustments'),
    path('api/finance/students/<int:student_id>/ledger/', StudentFeeLedgerStatementAPIView.as_view(), name='api_student_fee_ledger'),
    path('api/finance/students/<int:student_id>/fee-clearance/', FeeClearanceStatusAPIView.as_view(), name='api_fee_clearance_status'),
]
