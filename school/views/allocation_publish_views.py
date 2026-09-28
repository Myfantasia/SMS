from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.allocations import publish_gate
from orchestration import publish as publish_flow
from school.rbac import HasModulePermission


def _parse(data):
    """(term_id, year_id, class_ids) from a request body, or ValueError with a readable message."""
    try:
        term_id, year_id, class_id = int(data.get('term_id')), int(data.get('year_id')), int(data.get('class_id'))
        grade_id = int(data['grade_id']) if data.get('grade_id') else None
    except (TypeError, ValueError):
        raise ValueError("term_id, year_id and class_id are required and must be numbers.")
    class_ids = publish_gate.resolve_publish_scope(
        term_id=term_id, year_id=year_id, scope=data.get('scope') or publish_gate.SCOPE_CLASS,
        class_id=class_id, grade_id=grade_id,
    )
    return term_id, year_id, class_ids


def _sync_dict(sync):
    return {
        'target_timetable_id': sync.target_timetable_id, 'target_timetable_name': sync.target_timetable_name,
        'target_is_live': sync.target_is_live, 'synced': sync.synced,
        'ejected_count': sync.ejected_count, 'swapped_count': sync.swapped_count,
        'locked_skipped_count': sync.locked_skipped_count,
        'regenerated_subject_count': sync.regenerated_subject_count,
    }


class PublishPreviewAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'allocations.view'
    rbac_edit_permission = 'allocations.edit'

    def post(self, request):
        try:
            term_id, year_id, class_ids = _parse(request.data)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        preview = publish_flow.preview_publish(term_id=term_id, year_id=year_id, class_ids=class_ids)
        return Response({
            'class_ids': list(preview.class_ids), 'fingerprint': preview.fingerprint,
            'blockers': [b.to_dict() for b in preview.blockers],
            'can_publish': preview.can_publish, 'requires_acknowledgement': preview.requires_acknowledgement,
            'sync': _sync_dict(preview.sync),
        })


class PublishAllocationsAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'allocations.view'
    rbac_edit_permission = 'allocations.edit'

    def post(self, request):
        try:
            term_id, year_id, class_ids = _parse(request.data)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = publish_flow.publish_scope(
                term_id=term_id, year_id=year_id, class_ids=class_ids,
                review_fingerprint=str(request.data.get('review_fingerprint') or ''),
                acknowledge_soft=bool(request.data.get('acknowledge_soft')),
                operator_id=request.user.id,
            )
        except publish_flow.StaleReviewError as exc:
            return Response({'error': str(exc), 'code': exc.code}, status=status.HTTP_409_CONFLICT)
        except (publish_flow.PublishBlockedError, publish_flow.AcknowledgementRequiredError) as exc:
            return Response({'error': str(exc), 'code': exc.code, 'blockers': [b.to_dict() for b in exc.blockers]},
                            status=status.HTTP_400_BAD_REQUEST)
        message = f"Published {len(result.class_ids)} class(es)."
        if result.sync.synced:
            message += f" The draft timetable '{result.sync.target_timetable_name}' was updated."
        elif result.sync.target_is_live:
            message += " The active timetable is live and was not changed - regenerate a draft to apply this."
        return Response({'message': message, 'class_ids': list(result.class_ids),
                         'sync': _sync_dict(result.sync), 'warnings_acknowledged': result.warnings_acknowledged})
