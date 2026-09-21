from django.db.models import Sum
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from apps.identity.models import StudentExtra, TeacherExtra
from apps.finance.models_fees import FeeStructure
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
