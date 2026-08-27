from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Count, Q
from rest_framework import viewsets
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.services import write_audit_log
from apps.identity.models import Permission, Role, UserRole
from school.permissions import IsApprovedAdmin
from school.rbac import HasModulePermission, invalidate_user_permission_cache, validate_permission_delegation, validate_rank_authority
from school.serializers.rbac_serializers import PermissionSerializer, RoleSerializer


class PermissionViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only catalog — permissions are code, not admin-authored data."""
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsApprovedAdmin | HasModulePermission]
    rbac_view_permission = 'rbac.manage'


class RoleViewSet(viewsets.ModelViewSet):
    """
    Every mutation here grants or revokes real access elsewhere in the system, so — like
    every other sensitive admin action in this codebase (curriculum rules, allocation splits,
    exam mark alterations, enrollment changes) — it's logged to SystemAuditLog(module='RBAC').

    Guarded by two independent checks on every mutation (see school.rbac): the rank gate
    (an actor may only touch a role strictly more junior than their own effective rank) and
    permission containment (an actor may only grant permission codes they hold themselves).
    Superusers bypass both.
    """
    serializer_class = RoleSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsApprovedAdmin | HasModulePermission]
    rbac_view_permission = 'rbac.manage'
    rbac_edit_permission = 'rbac.manage'

    def get_queryset(self):
        from apps.identity.services import get_current_school_id
        return (
            Role.objects.filter(is_deleted=False, school_id=get_current_school_id(self.request))
            .prefetch_related('permissions')
            .annotate(member_count=Count('user_assignments', distinct=True))
        )

    @action(detail=True, methods=['get'])
    def members(self, request, pk=None):
        """Reverse lookup for the role card: who actually holds this role today.
        Without this, seeing a role's real-world footprint meant searching users one by
        one on the assignment panel — there was no way to go role -> people."""
        role = self.get_object()
        users = User.objects.filter(rbac_roles__role=role).order_by('first_name', 'last_name', 'username')
        return Response([
            {
                'id': u.id,
                'username': u.username,
                'email': u.email,
                'full_name': f"{u.first_name} {u.last_name}".strip() or u.username,
            }
            for u in users
        ])

    def perform_create(self, serializer):
        from apps.identity.services import get_current_school_id

        actor = self.request.user
        validate_rank_authority(actor, serializer.validated_data.get('rank'))
        permission_codes = {p.code for p in serializer.validated_data.get('permissions', [])}
        validate_permission_delegation(actor, permission_codes)

        with transaction.atomic():
            role = serializer.save(school_id=get_current_school_id(self.request))
            codes = sorted(role.permissions.values_list('code', flat=True))
            write_audit_log(
                operator_id=actor.id,
                action_type='CREATE',
                module='RBAC',
                description=f"Created role '{role.name}' with permissions: {', '.join(codes) or 'none'}."
            )

    def perform_update(self, serializer):
        actor = self.request.user
        validate_rank_authority(actor, serializer.instance.rank)
        new_rank = serializer.validated_data.get('rank', serializer.instance.rank)
        validate_rank_authority(actor, new_rank)

        new_permissions = serializer.validated_data.get('permissions')
        if new_permissions is not None:
            validate_permission_delegation(actor, {p.code for p in new_permissions})

        old_codes = set(serializer.instance.permissions.values_list('code', flat=True))
        old_name = serializer.instance.name

        # System roles (Admin/Teacher) can still have their permissions adjusted freely, but
        # not renamed — seed_rbac.py looks them up by exact name, and every non-superuser
        # admin's access depends on that name staying stable.
        if serializer.instance.is_system_role:
            new_name = serializer.validated_data.get('name', old_name)
            if new_name != old_name:
                raise ValidationError({
                    'name': f"'{old_name}' is a core system role and can't be renamed."
                })

        with transaction.atomic():
            role = serializer.save()
            new_codes = set(role.permissions.values_list('code', flat=True))

            added = sorted(new_codes - old_codes)
            removed = sorted(old_codes - new_codes)
            changes = []
            if old_name != role.name:
                changes.append(f"renamed from '{old_name}' to '{role.name}'")
            if added:
                changes.append(f"granted: {', '.join(added)}")
            if removed:
                changes.append(f"revoked: {', '.join(removed)}")

            write_audit_log(
                operator_id=actor.id,
                action_type='UPDATE',
                module='RBAC',
                description=f"Updated role '{role.name}'" + (f" — {'; '.join(changes)}." if changes else " (no changes).")
            )

    def perform_destroy(self, instance):
        validate_rank_authority(self.request.user, instance.rank)

        if instance.is_system_role:
            raise ValidationError(
                f"'{instance.name}' is a core system role and can't be deleted. "
                "You can still edit which permissions it grants."
            )

        from apps.core.trash import soft_delete
        role_name = instance.name
        affected_user_ids = list(instance.user_assignments.values_list('user_id', flat=True))
        affected_users = list(instance.user_assignments.values_list('user__username', flat=True))
        with transaction.atomic():
            soft_delete(
                instance, operator=self.request.user, module='RBAC',
                description=f"Deleted role '{role_name}'" + (
                    f" — previously assigned to: {', '.join(affected_users)}." if affected_users else "."
                ),
            )
            for uid in affected_user_ids:
                invalidate_user_permission_cache(uid)


class UserRoleAssignmentAPIView(APIView):
    """Search users and view/assign/unassign their RBAC roles."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsApprovedAdmin | HasModulePermission]
    rbac_view_permission = 'rbac.manage'
    rbac_edit_permission = 'rbac.manage'

    def get(self, request):
        user_id = request.query_params.get('user_id')
        search = request.query_params.get('search')

        if user_id:
            try:
                user = User.objects.get(id=user_id)
            except User.DoesNotExist:
                return Response({'error': 'User not found.'}, status=404)
            roles = Role.objects.filter(user_assignments__user=user, is_deleted=False).prefetch_related('permissions')
            return Response({
                'user': {'id': user.id, 'username': user.username, 'email': user.email},
                'roles': RoleSerializer(roles, many=True).data,
            })

        if search:
            # Split on whitespace and require every token to match at least one field —
            # a single Q()-per-field match couldn't find "Search Testable" for a user with
            # first_name='Search', last_name='Testable', since neither field alone contains
            # the full two-word string. AND-ing per-token OR-groups fixes full-name search
            # without needing a concatenated-name index.
            query = Q()
            for term in search.split():
                query &= (
                    Q(username__icontains=term) | Q(email__icontains=term)
                    | Q(first_name__icontains=term) | Q(last_name__icontains=term)
                )
            users = User.objects.filter(query)[:20]
            return Response([
                {
                    'id': u.id,
                    'username': u.username,
                    'email': u.email,
                    'full_name': f"{u.first_name} {u.last_name}".strip() or u.username,
                }
                for u in users
            ])

        return Response({'error': 'Provide a user_id or search query param.'}, status=400)

    def post(self, request):
        user_id = request.data.get('user_id')
        role_id = request.data.get('role_id')
        try:
            user = User.objects.get(id=user_id)
            role = Role.objects.get(id=role_id)
        except (User.DoesNotExist, Role.DoesNotExist):
            return Response({'error': 'User or role not found.'}, status=404)
        _, created = UserRole.objects.get_or_create(user=user, role=role)
        if created:
            invalidate_user_permission_cache(user.id)
            write_audit_log(
                operator_id=request.user.id,
                action_type='CREATE',
                module='RBAC',
                description=f"Assigned role '{role.name}' to user '{user.username}'."
            )
        return Response({'status': 'success'})

    def delete(self, request):
        user_id = request.data.get('user_id')
        role_id = request.data.get('role_id')

        # Self-lockout guard: superusers can never actually be locked out (they bypass RBAC
        # entirely, see get_user_permission_codes), so only non-superusers need protecting.
        # A user removing their own LAST role assignment would leave them with zero RBAC
        # access with no easy way back in — block that specific case.
        if str(request.user.id) == str(user_id) and not request.user.is_superuser:
            remaining = UserRole.objects.filter(user_id=user_id).exclude(role_id=role_id).count()
            if remaining == 0:
                return Response({
                    'error': "You can't remove your own last role — this would lock you out of "
                             "the system. Have another admin do this, or assign yourself a "
                             "replacement role first."
                }, status=400)

        deleted_count, _ = UserRole.objects.filter(user_id=user_id, role_id=role_id).delete()
        if deleted_count:
            invalidate_user_permission_cache(user_id)
            user = User.objects.filter(id=user_id).first()
            role = Role.objects.filter(id=role_id).first()
            write_audit_log(
                operator_id=request.user.id,
                action_type='DELETE',
                module='RBAC',
                description=f"Removed role '{role.name if role else role_id}' from user "
                             f"'{user.username if user else user_id}'."
            )
        return Response({'status': 'success'})
