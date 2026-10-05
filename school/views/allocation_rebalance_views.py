from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.allocations import publish_gate
from apps.allocations.rebalance import RebalanceNotAllowedError, StaleProposalError, confirm_rebalance, propose_rebalance
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


def _move_dict(move):
    return {
        'classroom_id': move.classroom_id, 'subject_id': move.subject_id,
        'from_teacher_id': move.from_teacher_id, 'to_teacher_id': move.to_teacher_id,
        'reason': move.reason, 'resolves_blocker_code': move.resolves_blocker_code,
    }


class RebalanceProposeAPIView(APIView):
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
            proposal = propose_rebalance(term_id=term_id, year_id=year_id, class_ids=class_ids)
        except RebalanceNotAllowedError as exc:
            return Response({'error': str(exc), 'code': exc.code}, status=status.HTTP_409_CONFLICT)
        return Response({
            'class_ids': list(proposal.class_ids), 'fingerprint': proposal.fingerprint,
            'blockers_before': [b.to_dict() for b in proposal.blockers_before],
            'moves': [_move_dict(m) for m in proposal.moves],
            'unresolved_blockers': [b.to_dict() for b in proposal.unresolved_blockers],
        })


class RebalanceConfirmAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'allocations.view'
    rbac_edit_permission = 'allocations.edit'

    def post(self, request):
        try:
            term_id, year_id, class_ids = _parse(request.data)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        proposal_fingerprint = str(request.data.get('proposal_fingerprint') or '')
        if not proposal_fingerprint:
            return Response({'error': 'proposal_fingerprint is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = confirm_rebalance(
                term_id=term_id, year_id=year_id, class_ids=class_ids,
                proposal_fingerprint=proposal_fingerprint,
                operator_id=request.user.id,
            )
        except RebalanceNotAllowedError as exc:
            return Response({'error': str(exc), 'code': exc.code}, status=status.HTTP_409_CONFLICT)
        except StaleProposalError as exc:
            return Response({'error': str(exc), 'code': 'STALE_PROPOSAL'}, status=status.HTTP_409_CONFLICT)
        return Response({
            'message': f"Rebalanced {result.moves_applied} contract(s) across {len(result.class_ids)} class(es).",
            'class_ids': list(result.class_ids), 'moves_applied': result.moves_applied,
        })
