import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied, ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Prefetch, Q, Sum
from django.http import HttpResponse
from rest_framework.authentication import SessionAuthentication
from rest_framework.generics import ListCreateAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from apps.academics.models import GradeLevel, ExamTerm, AcademicYear
from apps.identity.models import ParentExtra, StudentExtra, TeacherExtra
from apps.core.services import write_audit_log
from apps.finance.models_fees import (
    DiscountRule, DiscountType, FeeCategory, FeeStructure, FeeStructureItem, Invoice, Payment, Receipt,
    StudentFeeAdjustment, StudentFeeItemEnrollment, StudentFeeLedgerEntry,
)
from apps.finance.serializers_fees import (
    FeeCategorySerializer, FeeStructureSerializer, FeeStructureDetailSerializer,
    DiscountTypeSerializer, DiscountTypeListQuerySerializer,
    DiscountRuleSerializer, DiscountRuleCreateSerializer, DiscountRulePreviewSerializer,
    DiscountRuleApplySerializer, DiscountRulePatchSerializer,
    InvoiceSerializer, InvoiceDetailSerializer, PaymentSerializer, StudentFeeAdjustmentSerializer,
    StudentFeeLedgerEntrySerializer, PaymentCreateSerializer, AdjustmentCreateSerializer,
    AdjustmentDecisionSerializer, AdjustmentListQuerySerializer, VoidSerializer,
    InvoiceListQuerySerializer, PaymentListQuerySerializer, PageQuerySerializer, FeeClearanceQuerySerializer,
    CollectionsTrendQuerySerializer, ExamTermLookupQuerySerializer, StudentLookupQuerySerializer,
)
from apps.finance.services_fees import (
    record_payment, void_invoice, void_payment, create_adjustment, decide_adjustment,
    is_fees_clear, get_credit_balance, is_gate_blocked, create_discount_type, update_discount_type,
    create_discount_rule, update_discount_rule, preview_discount_rule, apply_discount_rule,
)
from apps.finance.services_documents import render_invoice_pdf, render_receipt_pdf
from apps.finance import services_reports
from school.rbac import HasModulePermission, user_has_permission
from school.jobs import dispatch_background_job


def _is_admin(user):
    """Matches the convention used in attendance_views.py / class_views.py."""
    return (
        user.is_superuser or user.is_staff or
        user.groups.filter(name='ADMIN').exists() or
        hasattr(user, 'adminextra')
    )


class FinanceOverviewAPI(APIView):
    """
    Read-only rollup of student fees and staff salaries for the admin
    Fees & Salary page. Both figures already live on StudentExtra.fee and
    TeacherExtra.salary — this just aggregates and lists them. No payments/
    transactions ledger exists yet, so this is a snapshot, not a ledger.
    """
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request):
        # HasModulePermission already required finance.view to reach here — no one besides
        # Admin holds that code today (see seed_rbac.py TEACHER_PERMISSIONS, which
        # deliberately excludes it), so any holder (a Staff account with a Finance-granting
        # Role included) is safe to admit here without a teacher-style narrower branch.
        if not (_is_admin(request.user) or user_has_permission(request.user, 'finance.view')):
            return Response({"error": "Unauthorized. Admins only."}, status=403)

        students = StudentExtra.objects.filter(status=True).select_related('user', 'cl__grade')
        teachers = TeacherExtra.objects.filter(status=True).select_related('user')

        total_revenue = students.aggregate(total=Sum('fee'))['total'] or 0
        total_salary_expense = teachers.aggregate(total=Sum('salary'))['total'] or 0

        student_data = [{
            "id": s.id,
            "name": s.get_name,
            "class_name": str(s.cl) if s.cl else "Unassigned",
            "fee": s.fee or 0,
        } for s in students]

        teacher_data = [{
            "id": t.id,
            "name": t.get_name,
            "subjects": t.subjects or "N/A",
            "salary": t.salary or 0,
        } for t in teachers]

        return Response({
            "status": "success",
            "data": {
                "total_revenue": total_revenue,
                "total_salary_expense": total_salary_expense,
                "net": total_revenue - total_salary_expense,
                "students": student_data,
                "teachers": teacher_data,
            }
        })


class ActivateFeeStructureAPIView(APIView):
    """Dispatches bulk invoice generation for every eligible student in a grade,
    on the bulk_ops queue, then sets a FeeStructure to 'active' — mirrors
    PromoteStudentsAPIView's dispatch pattern exactly."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'finance.edit'

    def post(self, request, structure_id):
        fee_structure = FeeStructure.objects.filter(id=structure_id).first()
        if fee_structure is None:
            return Response({"error": "Fee structure not found."}, status=status.HTTP_404_NOT_FOUND)
        # A structure with no line items would generate zero-total invoices that can never
        # be paid off, so refuse activation until at least one item exists.
        if not fee_structure.items.exists():
            return Response(
                {"error": "A fee structure needs at least one line item before it can be activated."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Scoped per fee structure — a double-submit on the same structure shares
        # one lock rather than racing to generate duplicate invoices.
        lock_key = f"finance_generate_invoices_lock_structure_{structure_id}"

        # Lazy import: orchestration sits above every app layer, so no app may import it at module level.
        from orchestration.tasks import generate_invoices_for_structure_task

        job, error_response = dispatch_background_job(
            job_type='generate_invoices_for_structure',
            task=generate_invoices_for_structure_task,
            task_args=(structure_id, request.user.id, lock_key),
            operator=request.user,
        )
        if error_response is not None:
            return error_response

        with transaction.atomic():
            fee_structure.status = 'active'
            fee_structure.save(update_fields=['status'])
            write_audit_log(
                operator_id=request.user.id, action_type='UPDATE', module='finance',
                description=f"Activated fee structure '{fee_structure.name}' (id {fee_structure.id})",
            )

        return Response({"status": "queued", "job_id": str(job.id)}, status=status.HTTP_202_ACCEPTED)


class FeeCategoryListCreateAPIView(ListCreateAPIView):
    queryset = FeeCategory.objects.all().order_by('name')
    serializer_class = FeeCategorySerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'
    rbac_edit_permission = 'finance.edit'

    def perform_create(self, serializer):
        with transaction.atomic():
            category = serializer.save()
            write_audit_log(
                operator_id=self.request.user.id,
                action_type='CREATE',
                module='finance',
                description=f"Created fee category '{category.name}' (id {category.id}).",
            )


class DiscountTypeListCreateAPIView(APIView):
    """GET lists discount types (active and inactive; ?active=true|false filters).
    POST creates one. Spec section 4.12. There is deliberately no DELETE: a
    discount type that has been used must never disappear, so callers deactivate
    it with PATCH active=false instead."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'
    rbac_edit_permission = 'finance.edit'

    def get(self, request):
        query = DiscountTypeListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        discount_types = DiscountType.objects.select_related('category').order_by('name')
        # Filter only when ?active= is actually present. DRF's BooleanField treats an
        # ABSENT key in a QueryDict as False, so checking validated_data alone would
        # silently narrow an unfiltered GET to inactive rows only.
        if 'active' in request.query_params:
            discount_types = discount_types.filter(active=query.validated_data['active'])
        return Response(DiscountTypeSerializer(discount_types, many=True).data)

    def post(self, request):
        serializer = DiscountTypeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            discount_type = create_discount_type(operator=request.user, **serializer.validated_data)
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(DiscountTypeSerializer(discount_type).data, status=status.HTTP_201_CREATED)


class DiscountTypeDetailAPIView(APIView):
    """GET retrieves one discount type; PATCH updates name/kind/value/category/active.
    No DELETE method exists, so DELETE returns 405 (spec section 4.12)."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'
    rbac_edit_permission = 'finance.edit'

    def get(self, request, discount_type_id):
        discount_type = DiscountType.objects.select_related('category').filter(id=discount_type_id).first()
        if discount_type is None:
            return Response({"error": "Discount type not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(DiscountTypeSerializer(discount_type).data)

    def patch(self, request, discount_type_id):
        discount_type = DiscountType.objects.select_related('category').filter(id=discount_type_id).first()
        if discount_type is None:
            return Response({"error": "Discount type not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = DiscountTypeSerializer(discount_type, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            updated = update_discount_type(
                operator=request.user, discount_type=discount_type, changes=serializer.validated_data,
            )
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(DiscountTypeSerializer(updated).data)


class DiscountRuleListCreateAPIView(APIView):
    """GET lists discount rules (finance.view). POST stores a new rule (finance.edit).
    Creating a rule discounts nobody: that is apply's job. Spec section 4.12. There is
    no DELETE; deactivate a rule with PATCH active=false."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'
    rbac_edit_permission = 'finance.edit'

    def get(self, request):
        rules = (
            DiscountRule.objects.select_related('discount_type', 'academic_year', 'term', 'grade_level', 'class_stream')
            .prefetch_related('students').order_by('-created_at', '-id')
        )
        return Response(DiscountRuleSerializer(rules, many=True).data)

    def post(self, request):
        serializer = DiscountRuleCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            rule = create_discount_rule(
                operator=request.user, discount_type=data['discount_type'], academic_year=data['academic_year'],
                term=data['term'], grade_level=data.get('grade_level'), class_stream=data.get('class_stream'),
                student_ids=data.get('student_ids'),
            )
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(DiscountRuleSerializer(rule).data, status=status.HTTP_201_CREATED)


class DiscountRuleDetailAPIView(APIView):
    """GET retrieves one rule (finance.view). PATCH sets `active` (finance.edit), which
    is how a rule is deactivated. No DELETE method exists."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'
    rbac_edit_permission = 'finance.edit'

    def get(self, request, rule_id):
        rule = DiscountRule.objects.select_related('discount_type', 'academic_year', 'term', 'grade_level', 'class_stream').filter(id=rule_id).first()
        if rule is None:
            return Response({"error": "Discount rule not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(DiscountRuleSerializer(rule).data)

    def patch(self, request, rule_id):
        rule = DiscountRule.objects.filter(id=rule_id).first()
        if rule is None:
            return Response({"error": "Discount rule not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = DiscountRulePatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            updated = update_discount_rule(operator=request.user, rule=rule, changes=serializer.validated_data)
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(DiscountRuleSerializer(updated).data)


class DiscountRulePreviewAPIView(APIView):
    """POST /api/finance/discount-rules/preview/ -- read-only. Lists the students a rule
    would cover, the amount apply would create for each, and the total. Gated on
    finance.view only, because it writes nothing."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def post(self, request):
        serializer = DiscountRulePreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            preview = preview_discount_rule(
                discount_type=data['discount_type'], term=data['term'], grade_level=data.get('grade_level'),
                class_stream=data.get('class_stream'), student_ids=data.get('student_ids'), amount=data.get('amount'),
            )
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(preview)


class DiscountRuleApplyAPIView(APIView):
    """POST /api/finance/discount-rules/<id>/apply/ -- an explicit admin action. Creates
    one pending adjustment per targeted student and returns the counts. Repeating it
    creates nothing new. Gated on finance.edit."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'finance.edit'

    def post(self, request, rule_id):
        rule = DiscountRule.objects.filter(id=rule_id).first()
        if rule is None:
            return Response({"error": "Discount rule not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = DiscountRuleApplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = apply_discount_rule(rule=rule, operator=request.user, amount=serializer.validated_data.get('amount'))
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(result)


class FeeStructureListCreateAPIView(ListCreateAPIView):
    queryset = FeeStructure.objects.all().select_related('grade_level', 'term').order_by('-created_at')
    serializer_class = FeeStructureSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'
    rbac_edit_permission = 'finance.edit'

    def perform_create(self, serializer):
        with transaction.atomic():
            structure = serializer.save()
            write_audit_log(
                operator_id=self.request.user.id,
                action_type='CREATE',
                module='finance',
                description=(
                    f"Created fee structure '{structure.name}' (id {structure.id}) "
                    f"for grade {structure.grade_level_id}, term {structure.term_id}."
                ),
            )


class FeeStructureDetailAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request, structure_id):
        structure = FeeStructure.objects.filter(id=structure_id).prefetch_related('items__category').first()
        if structure is None:
            return Response({"error": "Fee structure not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(FeeStructureDetailSerializer(structure).data)


class StudentFeeItemEnrollmentSetAPIView(APIView):
    """PUT replaces the entire enrollment roster for one optional
    FeeStructureItem with the given student_ids -- the "checklist" UI action
    from spec section 4.3. Unknown student ids are skipped and echoed back in
    `ignored_student_ids` rather than failing the whole request."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'finance.edit'

    def put(self, request, item_id):
        if not isinstance(request.data, dict):
            return Response({"error": "Request body must be a JSON object."}, status=status.HTTP_400_BAD_REQUEST)
        raw_ids = request.data.get('student_ids')
        # bool is an int subclass, so it has to be excluded explicitly.
        if not isinstance(raw_ids, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in raw_ids):
            return Response({"error": "student_ids must be a list of integers."}, status=status.HTTP_400_BAD_REQUEST)
        requested_ids = set(raw_ids)

        with transaction.atomic():
            # Row lock serialises concurrent roster replacements on the same item.
            item = FeeStructureItem.objects.select_for_update().filter(id=item_id).first()
            if item is None:
                return Response({"error": "Fee structure item not found."}, status=status.HTTP_404_NOT_FOUND)
            if not item.is_optional:
                return Response(
                    {"error": "Only optional items have an enrollment roster; mandatory items apply to every student."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            valid_ids = set(StudentExtra.objects.filter(id__in=requested_ids).values_list('id', flat=True))
            existing_ids = set(
                StudentFeeItemEnrollment.objects.filter(fee_structure_item=item).values_list('student_id', flat=True)
            )
            added_ids = valid_ids - existing_ids
            removed_ids = existing_ids - valid_ids
            StudentFeeItemEnrollment.objects.filter(fee_structure_item=item).exclude(student_id__in=valid_ids).delete()
            StudentFeeItemEnrollment.objects.bulk_create([
                StudentFeeItemEnrollment(student_id=student_id, fee_structure_item=item)
                for student_id in added_ids
            ])
            write_audit_log(
                operator_id=request.user.id,
                action_type='UPDATE',
                module='finance',
                description=(
                    f"Replaced enrollment roster for fee structure item {item.id}: "
                    f"{len(existing_ids)} -> {len(valid_ids)} enrolled. "
                    f"Added student ids {sorted(added_ids)}; removed student ids {sorted(removed_ids)}."
                ),
            )

        return Response({
            "status": "ok",
            "enrolled_count": len(valid_ids),
            "ignored_student_ids": sorted(requested_ids - valid_ids),
        })


def _service_error_response(exc):
    """Turns a service-layer refusal into a clean 4xx. `exc.messages` (not
    str(exc), which renders the list repr) gives plain human-readable text."""
    if isinstance(exc, DjangoPermissionDenied):
        return Response({"error": str(exc) or "Permission denied."}, status=status.HTTP_403_FORBIDDEN)
    return Response({"error": ' '.join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)


class InvoiceListAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request):
        query = InvoiceListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        filters = query.validated_data
        invoices = Invoice.objects.prefetch_related('line_items__category', 'credit_applications')
        if 'student_id' in filters:
            invoices = invoices.filter(student_id=filters['student_id'])
        if 'fee_structure_id' in filters:
            invoices = invoices.filter(fee_structure_id=filters['fee_structure_id'])
        if 'status' in filters:
            invoices = invoices.filter(status=filters['status'])
        page = query.slice(invoices.order_by('-issued_at', '-id'))
        return Response(InvoiceSerializer(page, many=True).data)


class InvoiceDetailAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request, invoice_id):
        invoice = (
            Invoice.objects.filter(id=invoice_id)
            .prefetch_related(
                'line_items__category', 'credit_applications',
                Prefetch('payments', queryset=Payment.objects.select_related('receipt').order_by('date', 'id')),
            )
            .first()
        )
        if invoice is None:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(InvoiceDetailSerializer(invoice).data)


class PaymentListCreateAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'
    rbac_edit_permission = 'finance.record_payment'

    def get(self, request):
        query = PaymentListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        payments = Payment.objects.select_related('receipt')
        if 'student_id' in query.validated_data:
            payments = payments.filter(student_id=query.validated_data['student_id'])
        return Response(PaymentSerializer(query.slice(payments.order_by('-date', '-id')), many=True).data)

    def post(self, request):
        data = PaymentCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            payment, _receipt = record_payment(
                student=data.validated_data['student'], amount=data.validated_data['amount'],
                method=data.validated_data['method'], recorded_by=request.user,
                invoice=data.validated_data.get('invoice'), reference=data.validated_data['reference'],
                date=data.validated_data['date'],
            )
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(PaymentSerializer(payment).data, status=status.HTTP_201_CREATED)


class VoidInvoiceAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'finance.void'

    def post(self, request, invoice_id):
        invoice = Invoice.objects.filter(id=invoice_id).first()
        if invoice is None:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        data = VoidSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            # The service re-reads under lock and returns the fresh row; serialize that, not our stale copy.
            voided = void_invoice(invoice=invoice, voided_by=request.user, reason=data.validated_data['reason'])
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        # InvoiceSerializer.get_credit_applied expects credit_applications prefetched
        # (see its docstring); void_invoice returns a freshly-read row that isn't.
        voided = Invoice.objects.prefetch_related('credit_applications').get(pk=voided.pk)
        return Response(InvoiceSerializer(voided).data)


class VoidPaymentAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'finance.void'

    def post(self, request, payment_id):
        payment = Payment.objects.filter(id=payment_id).first()
        if payment is None:
            return Response({"error": "Payment not found."}, status=status.HTTP_404_NOT_FOUND)
        data = VoidSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            voided = void_payment(payment=payment, voided_by=request.user, reason=data.validated_data['reason'])
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(PaymentSerializer(voided).data)


class StudentFeeAdjustmentCreateAPIView(APIView):
    """`finance.edit` is enough to REQUEST an adjustment. Spec section 4.10
    (Task 30): a negative one (a discount/scholarship/bursary) is created
    `pending` and needs a separate decide_adjustment() approval (see
    AdjustmentDecisionAPIView) before it posts to the ledger; a positive one
    is approved and posted immediately, same as before this feature existed."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'finance.edit'

    def post(self, request):
        data = AdjustmentCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        category = data.validated_data.get('category')
        try:
            adjustment = create_adjustment(
                student=data.validated_data['student'], adjustment_type=data.validated_data['adjustment_type'],
                amount=data.validated_data['amount'], reason=data.validated_data['reason'],
                requested_by=request.user, category_id=category.id if category else None,
                discount_type=data.validated_data.get('discount_type'),
            )
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(StudentFeeAdjustmentSerializer(adjustment).data, status=status.HTTP_201_CREATED)


class AdjustmentListAPIView(APIView):
    """GET-only list of StudentFeeAdjustment rows, filterable by status and/or
    student (spec section 4.10, Task 30) -- lets finance staff see what's
    pending without going through the ledger. `finance.view` gates this, same
    as every other read-only finance list view."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request):
        query = AdjustmentListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        adjustments = StudentFeeAdjustment.objects.all()
        if 'status' in query.validated_data:
            adjustments = adjustments.filter(status=query.validated_data['status'])
        if 'student_id' in query.validated_data:
            adjustments = adjustments.filter(student_id=query.validated_data['student_id'])
        adjustments = adjustments.order_by('-created_at', '-id')
        return Response(StudentFeeAdjustmentSerializer(query.slice(adjustments), many=True).data)


class AdjustmentDecisionAPIView(APIView):
    """POST /api/finance/adjustments/<id>/decision/ -- approve or reject a
    pending adjustment (spec section 4.10, Task 30). Gated on
    `finance.approve_adjustment`, not `finance.edit`: deciding is a distinct
    privilege from requesting, mirroring ClearanceOverrideRevokeAPIView's
    `rbac_edit_permission = 'finance.override_clearance'` convention (Tasks
    28/29) -- same shape: a POST-only view with ONLY rbac_edit_permission set,
    using a narrower, action-specific code rather than the blanket finance.edit."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'finance.approve_adjustment'

    def post(self, request, adjustment_id):
        adjustment = StudentFeeAdjustment.objects.filter(id=adjustment_id).first()
        if adjustment is None:
            return Response({"error": "Adjustment not found."}, status=status.HTTP_404_NOT_FOUND)
        data = AdjustmentDecisionSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            decided = decide_adjustment(
                adjustment=adjustment, decided_by=request.user,
                approve=data.validated_data['approve'], note=data.validated_data['note'],
            )
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(StudentFeeAdjustmentSerializer(decided).data)


def _can_view_student_statement(user, student_id):
    """Finance staff (finance.view), the student themself, or an approved parent
    linked to the student. Ownership-based access carries no permission code."""
    if user_has_permission(user, 'finance.view'):
        return True
    if StudentExtra.objects.filter(pk=student_id, user=user).exists():
        return True
    return ParentExtra.objects.filter(
        user=user, status=True, deleted_at__isnull=True, students__id=student_id,
    ).exists()


class StudentFeeLedgerStatementAPIView(APIView):
    """Powers both the admin student-ledger view and the parent/student
    read-only fee statement page (Task 21)."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, student_id):
        # Authorize before looking the student up so a stranger cannot probe which ids exist.
        if not _can_view_student_statement(request.user, student_id):
            return Response({"error": "Not authorized to view this student's fee ledger."}, status=status.HTTP_403_FORBIDDEN)
        student = StudentExtra.objects.filter(pk=student_id).first()
        if student is None:
            return Response({"error": "Student not found."}, status=status.HTTP_404_NOT_FOUND)
        page = PageQuerySerializer(data=request.query_params)
        page.is_valid(raise_exception=True)
        entries = StudentFeeLedgerEntry.objects.filter(student=student).order_by('-id')
        latest_balance = entries.values_list('running_balance', flat=True).first()
        return Response({
            "balance": latest_balance or 0,
            "credit_balance": get_credit_balance(student),
            "entries": StudentFeeLedgerEntrySerializer(page.slice(entries), many=True).data,
        })


class MyFeeLedgerAPIView(APIView):
    """The logged-in student's own fee ledger, resolved server-side -- no
    student_id in the URL, mirroring studentAssignmentService.ts's
    /api/assignments/student/board/ convention (Task 24). Authenticated-only:
    no finance.* permission is required, since this is ownership-scoped
    self-service access, matching _can_view_student_statement's `is_self`
    branch above and InvoicePDFAPIView/ReceiptPDFAPIView's precedent."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        student = getattr(request.user, 'studentextra', None)
        if student is None:
            return Response({"error": "This account has no student profile."}, status=status.HTTP_403_FORBIDDEN)
        page = PageQuerySerializer(data=request.query_params)
        page.is_valid(raise_exception=True)
        entries = StudentFeeLedgerEntry.objects.filter(student=student).order_by('-id')
        latest_balance = entries.values_list('running_balance', flat=True).first()
        return Response({
            "balance": latest_balance or 0,
            "credit_balance": get_credit_balance(student),
            "entries": StudentFeeLedgerEntrySerializer(page.slice(entries), many=True).data,
        })


class MyFeeClearanceStatusAPIView(APIView):
    """The logged-in student's own fee-clearance status -- no student_id in the
    URL, mirroring MyFeeLedgerAPIView (Task 24). Authenticated-only: this is
    ownership-scoped self-service, same as MyFeeLedgerAPIView. Added because
    StudentFeeStatementPage's own-statement view (no studentId prop) had no way
    to learn its own StudentExtra id to call the by-id FeeClearanceStatusAPIView
    (Task 29 follow-up)."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        student = getattr(request.user, 'studentextra', None)
        if student is None:
            return Response({"error": "This account has no student profile."}, status=status.HTTP_403_FORBIDDEN)
        query = FeeClearanceQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        is_clear = is_fees_clear(
            student_id=student.id, term_id=query.validated_data['term_id'],
            grace_threshold=query.validated_data['grace_threshold'],
        )
        current_term = ExamTerm.objects.filter(is_active=True).first()
        current_year = AcademicYear.objects.filter(is_active=True).first()
        return Response({
            "is_clear": is_clear,
            "credit_balance": get_credit_balance(student),
            "blocked_report_card": is_gate_blocked(
                student_id=student.id, gate='report_card',
                term_id=current_term.id if current_term else None,
            ),
            "blocked_promotion": is_gate_blocked(
                student_id=student.id, gate='promotion',
                academic_year_id=current_year.id if current_year else None,
            ),
        })


class FeeClearanceStatusAPIView(APIView):
    """Finance staff (finance.view), the student themself, or their linked
    approved parent may check clearance status -- same authorization shape as
    StudentFeeLedgerStatementAPIView (see _can_view_student_statement, which
    already includes the finance.view branch, so no separate HasModulePermission
    wiring is needed here).

    In addition to the raw balance-vs-grace-threshold check (`is_clear`), this
    also reports whether the student is actually gate-blocked right now
    (`blocked_report_card`/`blocked_promotion`), via `is_gate_blocked` --
    policy-flag- and override-aware, unlike `is_clear`. "Current" term/year are
    resolved via each model's `is_active` flag; if none is active, `None` is
    passed through. Note: `is_gate_blocked` never errors on `term_id=None`/
    `academic_year_id=None` -- `is_fees_clear` doesn't filter by term_id at all
    (see its docstring), so the block still correctly reflects the policy flag
    and overall balance. The only effect of an unresolvable current term/year is
    that no override can ever suppress the block in that state, because
    `grant_clearance_override` always requires a real term (report_card) or
    academic_year (promotion), so a stored override's term/academic_year is
    never None and therefore never matches the None passed here."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, student_id):
        # Authorize before looking the student up so a stranger cannot probe which ids exist.
        if not _can_view_student_statement(request.user, student_id):
            return Response({"error": "Not authorized to view this student's fee clearance status."}, status=status.HTTP_403_FORBIDDEN)
        query = FeeClearanceQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        is_clear = is_fees_clear(
            student_id=student_id, term_id=query.validated_data['term_id'],
            grace_threshold=query.validated_data['grace_threshold'],
        )
        if is_clear is None:
            return Response({"error": "Student not found."}, status=status.HTTP_404_NOT_FOUND)
        student = StudentExtra.objects.filter(pk=student_id).first()
        current_term = ExamTerm.objects.filter(is_active=True).first()
        current_year = AcademicYear.objects.filter(is_active=True).first()
        return Response({
            "is_clear": is_clear,
            "credit_balance": get_credit_balance(student),
            "blocked_report_card": is_gate_blocked(
                student_id=student_id, gate='report_card',
                term_id=current_term.id if current_term else None,
            ),
            "blocked_promotion": is_gate_blocked(
                student_id=student_id, gate='promotion',
                academic_year_id=current_year.id if current_year else None,
            ),
        })


def _pdf_download_response(request, record, student_id_of, render, filename):
    """Shared by the invoice/receipt downloads. `record is None` means the id
    does not exist: only finance viewers may learn that (404); everyone else
    gets the same 403 as for a forbidden id, so ids cannot be enumerated."""
    if record is None:
        if user_has_permission(request.user, 'finance.view'):
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response({"error": "Not authorized to download this document."}, status=status.HTTP_403_FORBIDDEN)
    if not _can_view_student_statement(request.user, student_id_of(record)):
        return Response({"error": "Not authorized to download this document."}, status=status.HTTP_403_FORBIDDEN)
    try:
        pdf_bytes = render(record)
    except (ImportError, OSError) as exc:
        # WeasyPrint (or its native pango/cairo libraries) is not installed on this server.
        logging.getLogger(__name__).warning("PDF generation unavailable for %r: %s", record, exc, exc_info=True)
        return Response({"error": "PDF generation is not available on this server."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{filename(record)}.pdf"'
    response['Cache-Control'] = 'private, no-store'
    return response


class InvoicePDFAPIView(APIView):
    """Finance staff, the student, or a linked approved parent (see `_can_view_student_statement`)."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, invoice_id):
        invoice = Invoice.objects.filter(id=invoice_id).select_related('student__user', 'fee_structure__term').first()
        return _pdf_download_response(
            request, invoice, lambda i: i.student_id, render_invoice_pdf, lambda i: i.invoice_number,
        )


class ReceiptPDFAPIView(APIView):
    """Finance staff, the student, or a linked approved parent (see `_can_view_student_statement`)."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, receipt_id):
        receipt = Receipt.objects.filter(id=receipt_id).select_related('payment__student__user', 'payment__invoice').first()
        return _pdf_download_response(
            request, receipt, lambda r: r.payment.student_id, render_receipt_pdf, lambda r: r.receipt_number,
        )


class _FinanceReportAPIView(APIView):
    """Read-only fee reports: `finance.view` only, no dedicated permission code."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'


class FeeKPITilesAPIView(_FinanceReportAPIView):
    def get(self, request):
        return Response(services_reports.fee_kpi_tiles())


class CollectionsTrendAPIView(_FinanceReportAPIView):
    def get(self, request):
        query = CollectionsTrendQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        return Response(services_reports.collections_trend(days=query.validated_data['days']))


class FeeCategoryBreakdownAPIView(_FinanceReportAPIView):
    def get(self, request):
        return Response(services_reports.fee_category_breakdown())


class StudentBalanceAgingAPIView(_FinanceReportAPIView):
    def get(self, request):
        return Response(services_reports.student_balance_aging())


class GradeLevelLookupAPIView(_FinanceReportAPIView):
    """Read-only `{id, name}` picklist for the Fee Structure form's grade
    dropdown. Task 21a: gated on `finance.view` (not `classes.view`) so a
    Finance Officer can populate this without the broader classes grant.
    GradeLevel has no soft-delete flag, so every row is eligible."""

    def get(self, request):
        grades = GradeLevel.objects.order_by('numeric_order').values('id', 'name')
        return Response(list(grades))


class ExamTermLookupAPIView(_FinanceReportAPIView):
    """Read-only `{id, name, academic_year_id}` picklist for the Fee
    Structure form's term dropdown. Task 21a: gated on `finance.view`, same
    reasoning as GradeLevelLookupAPIView above. Ordered most-recent-first by
    start_date; an optional `?academic_year_id=` narrows to one year without
    needing a dedicated "active year" convention."""

    def get(self, request):
        query = ExamTermLookupQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        terms = ExamTerm.objects.order_by('-start_date')
        academic_year_id = query.validated_data.get('academic_year_id')
        if academic_year_id is not None:
            terms = terms.filter(academic_year_id=academic_year_id)
        return Response(list(terms.values('id', 'name', 'academic_year_id')))


class StudentLookupAPIView(_FinanceReportAPIView):
    """Read-only `[{id, name, roll}]` picklist so finance staff can find a student by
    name/roll when recording a payment or generating an invoice, gated on `finance.view`
    like the other Task 21a lookups above (no new RBAC code). This repo's only prior
    student-search endpoint (school/views/views.py's api_search_students_for_parent_signup)
    is deliberately public/pre-login and rate-limited against anonymous-abuse — wrong base
    for an authenticated, permission-gated lookup, so this is a separate endpoint rather
    than a reuse. Scoped to currently-enrolled students the same way
    services_fees.generate_invoices_for_structure already does (status=True,
    deleted_at__isnull=True); capped at STUDENT_LOOKUP_LIMIT, same order of magnitude as
    the public endpoint's own [:8]."""

    STUDENT_LOOKUP_LIMIT = 8

    def get(self, request):
        query = StudentLookupQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        q = query.validated_data['q']
        students = StudentExtra.objects.filter(
            Q(roll__icontains=q) | Q(user__first_name__icontains=q) | Q(user__last_name__icontains=q),
            status=True, deleted_at__isnull=True,
        ).select_related('user').order_by('user__first_name', 'user__last_name')[:self.STUDENT_LOOKUP_LIMIT]
        return Response([
            {'id': s.id, 'name': s.user.get_full_name() or s.user.username, 'roll': s.roll}
            for s in students
        ])
