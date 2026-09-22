"""Views for the fee-clearance policy singleton and its overrides (spec
section 4.9, Task 28). Thin: every view validates input with a DRF serializer
first, then calls into services_fees, catching the service layer's
ValidationError/PermissionDenied the same way apps/finance/views.py already
does (see _service_error_response, reused here rather than duplicated)."""
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied, ValidationError as DjangoValidationError
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from apps.finance.models_fees import FeeClearanceOverride
from apps.finance.serializers_fees import (
    FeeClearancePolicySerializer, FeeClearancePolicyUpdateSerializer,
    FeeClearanceOverrideSerializer, ClearanceOverrideCreateSerializer,
    ClearanceOverrideRevokeSerializer, ClearanceOverrideListQuerySerializer,
)
from apps.finance.services_fees import (
    get_fee_clearance_policy, update_fee_clearance_policy,
    grant_clearance_override, revoke_clearance_override,
)
from apps.finance.views import _service_error_response
from school.rbac import HasModulePermission


class FeeClearancePolicyAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'
    rbac_edit_permission = 'finance.edit'

    def get(self, request):
        return Response(FeeClearancePolicySerializer(get_fee_clearance_policy()).data)

    def put(self, request):
        return self._update(request)

    def patch(self, request):
        return self._update(request)

    def _update(self, request):
        data = FeeClearancePolicyUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            policy = update_fee_clearance_policy(updated_by=request.user, **data.validated_data)
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(FeeClearancePolicySerializer(policy).data)


class ClearanceOverrideListCreateAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'finance.view'
    rbac_edit_permission = 'finance.override_clearance'

    def get(self, request):
        query = ClearanceOverrideListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        overrides = FeeClearanceOverride.objects.all()
        if 'student_id' in query.validated_data:
            overrides = overrides.filter(student_id=query.validated_data['student_id'])
        if 'gate' in query.validated_data:
            overrides = overrides.filter(gate=query.validated_data['gate'])
        return Response(FeeClearanceOverrideSerializer(overrides.order_by('-created_at', '-id'), many=True).data)

    def post(self, request):
        data = ClearanceOverrideCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            override = grant_clearance_override(
                student=data.validated_data['student'], gate=data.validated_data['gate'],
                granted_by=request.user, reason=data.validated_data['reason'],
                term=data.validated_data.get('term'), academic_year=data.validated_data.get('academic_year'),
            )
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(FeeClearanceOverrideSerializer(override).data, status=status.HTTP_201_CREATED)


class ClearanceOverrideRevokeAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'finance.override_clearance'

    def post(self, request, override_id):
        override = FeeClearanceOverride.objects.filter(id=override_id).first()
        if override is None:
            return Response({"error": "Override not found."}, status=status.HTTP_404_NOT_FOUND)
        data = ClearanceOverrideRevokeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            # The service re-reads under lock and returns the fresh row; serialize that, not our stale copy.
            revoked = revoke_clearance_override(override=override, revoked_by=request.user, reason=data.validated_data['reason'])
        except (DjangoValidationError, DjangoPermissionDenied) as exc:
            return _service_error_response(exc)
        return Response(FeeClearanceOverrideSerializer(revoked).data)
