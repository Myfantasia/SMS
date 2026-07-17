from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from school.models.assignments_models import Assignment
from school.models.models import Notice, StudentExtra
from school.serializers.teacher_serializers import NoticeSerializer
from school.utils import get_attendance_summary, get_class_stream_name, get_unread_message_count


class StudentDashboardOverviewAPI(APIView):
    """API Endpoint for the React Student Dashboard Home."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        try:
            student = StudentExtra.objects.select_related('cl__grade').get(user=user, status=True)
        except StudentExtra.DoesNotExist:
            return Response({"error": "Active Student profile not found."}, status=403)

        profile_data = {
            "name": student.get_name,
            "roll": student.roll,
            "class_name": get_class_stream_name(student.cl),
            "mobile": student.mobile,
            "fee": student.fee,
            "profile_pic": request.build_absolute_uri(student.profile_pic.url) if student.profile_pic else None,
        }

        notices = Notice.objects.filter(audience__in=['All', 'Students']).order_by('-date')[:5]
        notice_data = NoticeSerializer(notices, many=True).data

        pending_assignments_count = 0
        if student.cl:
            pending_assignments_count = Assignment.objects.filter(
                class_stream=student.cl, status='Published'
            ).exclude(submissions__student=student).count()

        return Response({
            "status": "success",
            "data": {
                "profile": profile_data,
                "notices": notice_data,
                "attendance": get_attendance_summary(student),
                "action_items": {
                    "pending_assignments": pending_assignments_count,
                    "unread_messages": get_unread_message_count(user),
                }
            }
        })
