from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.identity.models import ParentExtra
from apps.messaging.models import Notice
from school.serializers.teacher_serializers import NoticeSerializer
from school.utils import get_attendance_summary, get_class_stream_name, get_unread_message_count


class ParentDashboardOverviewAPI(APIView):
    """API Endpoint for the React Parent Dashboard Home."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        try:
            parent = ParentExtra.objects.get(user=user, status=True)
        except ParentExtra.DoesNotExist:
            return Response({"error": "Active Parent profile not found."}, status=403)

        profile_data = {
            "name": parent.get_name,
            "mobile": parent.mobile,
            "relationship": parent.relationship,
        }

        children_details = []
        for child in parent.students.select_related('cl__grade', 'user').order_by('user__first_name', 'user__last_name'):
            children_details.append({
                "id": child.id,
                "name": child.get_name,
                "roll": child.roll,
                "class_name": get_class_stream_name(child.cl),
                "fee": child.fee,
                "attendance": get_attendance_summary(child),
            })

        notices = Notice.objects.filter(audience__in=['All', 'Parents']).order_by('-date')[:5]
        notice_data = NoticeSerializer(notices, many=True).data

        return Response({
            "status": "success",
            "data": {
                "profile": profile_data,
                "children": children_details,
                "notices": notice_data,
                "action_items": {
                    "unread_messages": get_unread_message_count(user),
                }
            }
        })
