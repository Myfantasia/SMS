from django.db.models import Sum
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response

from school.models.models import StudentExtra, TeacherExtra
from school.rbac import HasModulePermission, user_has_permission


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
