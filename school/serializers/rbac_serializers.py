from rest_framework import serializers

from school.models.rbac_models import Permission, Role


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ['id', 'code', 'label', 'module']


class RoleSerializer(serializers.ModelSerializer):
    permissions = PermissionSerializer(many=True, read_only=True)
    permission_ids = serializers.PrimaryKeyRelatedField(
        queryset=Permission.objects.all(), source='permissions', many=True, write_only=True, required=False
    )
    member_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Role
        fields = ['id', 'name', 'description', 'rank', 'permissions', 'permission_ids', 'is_system_role', 'member_count']
        read_only_fields = ['is_system_role']
