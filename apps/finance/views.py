from django.db import transaction
from django.db.models import Sum
from rest_framework.authentication import SessionAuthentication
from rest_framework.generics import ListCreateAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from apps.identity.models import StudentExtra, TeacherExtra
from apps.core.services import write_audit_log
from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem, StudentFeeItemEnrollment
from apps.finance.serializers_fees import FeeCategorySerializer, FeeStructureSerializer, FeeStructureDetailSerializer
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
