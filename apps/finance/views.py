from django.core.exceptions import PermissionDenied as DjangoPermissionDenied, ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Prefetch, Sum
from django.http import HttpResponse
from rest_framework.authentication import SessionAuthentication
from rest_framework.generics import ListCreateAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from apps.identity.models import ParentExtra, StudentExtra, TeacherExtra
from apps.core.services import write_audit_log
from apps.finance.models_fees import (
    FeeCategory, FeeStructure, FeeStructureItem, Invoice, Payment, Receipt, StudentFeeItemEnrollment, StudentFeeLedgerEntry,
)
from apps.finance.serializers_fees import (
    FeeCategorySerializer, FeeStructureSerializer, FeeStructureDetailSerializer,
    InvoiceSerializer, InvoiceDetailSerializer, PaymentSerializer, StudentFeeAdjustmentSerializer,
    StudentFeeLedgerEntrySerializer, PaymentCreateSerializer, AdjustmentCreateSerializer, VoidSerializer,
    InvoiceListQuerySerializer, PaymentListQuerySerializer, PageQuerySerializer, FeeClearanceQuerySerializer,
)
from apps.finance.services_fees import (
    record_payment, void_invoice, void_payment, create_adjustment, is_fees_clear, get_credit_balance,
)
from apps.finance.services_documents import render_invoice_pdf, render_receipt_pdf
from school.rbac import HasModulePermission, user_has_permission
from school.jobs import dispatch_background_job
from orchestration.tasks import generate_invoices_for_structure_task


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

        # Scoped per fee structure — a double-submit on the same structure shares
        # one lock rather than racing to generate duplicate invoices.
        lock_key = f"finance_generate_invoices_lock_structure_{structure_id}"

        job, error_response = dispatch_background_job(
            job_type='generate_invoices_for_structure',
            task=generate_invoices_for_structure_task,
            task_args=(structure_id, request.user.id, lock_key),
            operator=request.user,
        )
        if error_response is not None:
            return error_response

        fee_structure.status = 'active'
        fee_structure.save(update_fields=['status'])

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
            StudentFeeItemEnrollment.objects.filter(fee_structure_item=item).exclude(student_id__in=valid_ids).delete()
            StudentFeeItemEnrollment.objects.bulk_create([
                StudentFeeItemEnrollment(student_id=student_id, fee_structure_item=item)
                for student_id in valid_ids - existing_ids
            ])
            write_audit_log(
                operator_id=request.user.id,
                action_type='UPDATE',
                module='finance',
                description=(
                    f"Replaced enrollment roster for fee structure item {item.id}: "
                    f"{len(existing_ids)} -> {len(valid_ids)} enrolled."
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
        invoices = Invoice.objects.prefetch_related('line_items__category')
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
    """`finance.edit` is enough to REQUEST an adjustment. A negative one (a
    discount/scholarship/bursary) also needs `approved_by`, which must name an
    active user holding `finance.approve_adjustment` other than the requester."""
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
                approved_by=data.validated_data.get('approved_by'),
            )
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(StudentFeeAdjustmentSerializer(adjustment).data, status=status.HTTP_201_CREATED)


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


class FeeClearanceStatusAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'

    def get(self, request, student_id):
        query = FeeClearanceQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        is_clear = is_fees_clear(
            student_id=student_id, term_id=query.validated_data['term_id'],
            grace_threshold=query.validated_data['grace_threshold'],
        )
        if is_clear is None:
            return Response({"error": "Student not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response({"is_clear": is_clear})


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
    except (ImportError, OSError):
        # WeasyPrint (or its native pango/cairo libraries) is not installed on this server.
        return Response({"error": "PDF generation is not available on this server."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{filename(record)}.pdf"'
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
