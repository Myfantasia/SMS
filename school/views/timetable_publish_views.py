from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from orchestration import timetable_publish as publish_flow
from school.rbac import HasModulePermission


def _parse(data):
    try:
        return int(data.get('timetable_id'))
    except (TypeError, ValueError):
        raise ValueError("timetable_id is required and must be a number.")


class TimetablePublishPreviewAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'timetable.view'
    rbac_edit_permission = 'timetable.edit'

    def post(self, request):
        try:
            timetable_id = _parse(request.data)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        report = publish_flow.preview_timetable_publish(timetable_id=timetable_id)
        return Response({
            'timetable_id': report.timetable_id, 'fingerprint': report.fingerprint,
            'blockers': [b.to_dict() for b in report.blockers],
            'can_publish': not report.hard_blockers,
            'requires_acknowledgement': bool(report.soft_blockers),
        })


class TimetablePublishAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'timetable.view'
    rbac_edit_permission = 'timetable.edit'

    def post(self, request):
        try:
            timetable_id = _parse(request.data)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = publish_flow.publish_timetable(
                timetable_id=timetable_id,
                review_fingerprint=str(request.data.get('review_fingerprint') or ''),
                acknowledge_soft=bool(request.data.get('acknowledge_soft')),
                operator_id=request.user.id, make_active=bool(request.data.get('make_active')),
            )
        except publish_flow.StaleReviewError as exc:
            return Response({'error': str(exc), 'code': exc.code}, status=status.HTTP_409_CONFLICT)
        except (publish_flow.TimetableBlockedError, publish_flow.AcknowledgementRequiredError) as exc:
            return Response({'error': str(exc), 'code': exc.code, 'blockers': [b.to_dict() for b in exc.blockers]},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response({'message': 'Timetable published.', 'warnings_acknowledged': result.warnings_acknowledged})
