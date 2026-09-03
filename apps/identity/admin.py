"""Admin registrations for the `identity` app.

Track B step 9 (final): model classes and their admin registrations
physically relocated here together from school/models/models.py,
school/models/rbac_models.py, and school/admin.py.
"""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import User, Group
from unfold.admin import ModelAdmin, StackedInline, TabularInline
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from apps.identity.models import AdminExtra, StudentExtra, TeacherExtra, StaffExtra, ParentExtra, Permission, Role, UserRole, School, ForcedPasswordChange, AdminInviteCode
from apps.students.models import StudentSubjectEnrollment
from apps.core.services import write_audit_log
from apps.core.trash import soft_delete
from school.rbac import invalidate_user_permission_cache


# --- 1. ADMIN INLINE SETUP ---
# This links the AdminExtra details to the User page in the admin panel
# Updated to inherit from Unfold's StackedInline
class AdminExtraInline(StackedInline):
    model = AdminExtra
    can_delete = False
    verbose_name_plural = 'Admin Profile Details'
    extra = 0  # ✅ prevents blank duplicate rows being created
    max_num = 1


# Updated to inherit from Unfold's customized UserAdmin
class UserAdmin(BaseUserAdmin, ModelAdmin):
    inlines = (AdminExtraInline,)

    # Unfold's specific forms for the User model to ensure the UI doesn't break
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm


admin.site.unregister(User)
admin.site.register(User, UserAdmin)


# --- ADMIN APPROVAL QUEUE ---
# Signups via /adminsignup land here with status=False and are NOT in the ADMIN group
# yet (group membership alone is what is_admin() checks). An existing superuser
# reviews and approves/revokes them from this list.
@admin.register(AdminExtra)
class AdminExtraAdmin(ModelAdmin):
    list_display = ('user', 'status', 'mobile')
    list_filter = ('status',)
    actions = ['approve_admins', 'revoke_admins']

    @admin.action(description='Approve selected admins (grants ADMIN group access)')
    def approve_admins(self, request, queryset):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        for admin_extra in queryset:
            admin_extra.status = True
            admin_extra.save()
            admin_group.user_set.add(admin_extra.user)

    @admin.action(description='Revoke admin access for selected')
    def revoke_admins(self, request, queryset):
        admin_group, _ = Group.objects.get_or_create(name='ADMIN')
        for admin_extra in queryset:
            admin_extra.status = False
            admin_extra.save()
            admin_group.user_set.remove(admin_extra.user)


# --- NEW: STUDENT SUBJECT PROFILE INLINE LAYOUT ---
class StudentSubjectEnrollmentInline(TabularInline):
    """Allows superusers to manage individual student subject matches within the student profile view"""
    model = StudentSubjectEnrollment
    extra = 0
    fields = ('subject', 'academic_year', 'status')


# --- 2. OTHER MODELS REGISTRATION ---
# All classes below are updated to inherit from unfold.admin.ModelAdmin

@admin.register(StudentExtra)
class StudentExtraAdmin(ModelAdmin):
    list_display = ('get_name', 'roll', 'cl', 'mobile', 'status')
    search_fields = ('user__first_name', 'user__last_name', 'roll')
    # UPDATED: Seamlessly appended the new subject manager inline to your existing student card
    inlines = [StudentSubjectEnrollmentInline]

    def get_name(self, obj):
        return obj.get_name

    get_name.short_description = 'Student Name'


@admin.register(TeacherExtra)
class TeacherExtraAdmin(ModelAdmin):
    list_display = ('get_name', 'subjects', 'mobile', 'status')

    def get_name(self, obj):
        return obj.get_name

    get_name.short_description = 'Teacher Name'


@admin.register(StaffExtra)
class StaffExtraAdmin(ModelAdmin):
    list_display = ('get_name', 'job_title', 'mobile', 'status')
    search_fields = ('user__first_name', 'user__last_name', 'job_title')

    def get_name(self, obj):
        return obj.get_name

    get_name.short_description = 'Staff Name'


@admin.register(ParentExtra)
class ParentExtraAdmin(ModelAdmin):
    list_display = ('get_name', 'get_children', 'relationship', 'mobile', 'status')
    search_fields = ('user__first_name', 'user__last_name', 'mobile')

    def get_name(self, obj):
        return obj.get_name

    get_name.short_description = 'Parent Name'

    def get_children(self, obj):
        # Grabs all students linked to this parent and joins their names with a comma
        return ", ".join([child.get_name for child in obj.students.all()])

    get_children.short_description = 'Linked Children'


# --- 3. RBAC: PERMISSION / ROLE / USERROLE ---
# Permission/Role/UserRole changes made here bypass the DRF RoleViewSet/
# UserRoleAssignmentAPIView entirely (Django admin writes straight to the ORM), so the
# audit-log and permission-cache side effects those views provide for free have to be
# replicated explicitly below -- otherwise a role assigned via /admin/ would be invisible
# in the audit trail and the recipient would wait out the 90s cache TTL instead of getting
# immediate access. The rank/permission-containment guards (validate_rank_authority,
# validate_permission_delegation) are NOT replicated here: both already no-op for
# is_superuser, and Django admin is a superuser-only surface in this codebase today.

@admin.register(Permission)
class PermissionAdmin(ModelAdmin):
    list_display = ('code', 'label', 'module')
    list_filter = ('module',)
    search_fields = ('code', 'label')


@admin.register(Role)
class RoleAdmin(ModelAdmin):
    list_display = ('name', 'rank', 'school', 'is_system_role', 'permission_count')
    list_filter = ('rank', 'school', 'is_system_role')
    search_fields = ('name',)
    filter_horizontal = ('permissions',)
    # Soft-delete bookkeeping is managed exclusively by soft_delete()/restore() -- excluded
    # here so a superuser can't hand-edit is_deleted/deleted_at/deleted_by through the form
    # and desync it from the Trash system's own state.
    exclude = ('is_deleted', 'deleted_at', 'deleted_by')

    def get_queryset(self, request):
        # Soft-deleted roles are managed through the Trash UI, not surfaced here as if
        # still active -- matches RoleViewSet.get_queryset()'s own is_deleted=False filter.
        return super().get_queryset(request).filter(is_deleted=False)

    def permission_count(self, obj):
        return obj.permissions.count()
    permission_count.short_description = 'Permissions'

    def get_readonly_fields(self, request, obj=None):
        fields = list(super().get_readonly_fields(request, obj))
        if obj is not None and obj.is_system_role:
            # Matches RoleViewSet.perform_update's is_system_role rename block -- Admin/
            # Teacher's names are looked up by exact string in seed_rbac.py and every
            # non-superuser admin's access depends on them staying stable.
            fields.append('name')
        return fields

    def has_delete_permission(self, request, obj=None):
        if obj is not None and obj.is_system_role:
            return False
        return super().has_delete_permission(request, obj)

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        write_audit_log(
            operator_id=request.user.id,
            action_type='UPDATE' if change else 'CREATE',
            module='RBAC',
            description=f"{'Updated' if change else 'Created'} role '{obj.name}' via Django admin.",
        )

    def save_related(self, request, form, formsets, change):
        # The permissions M2M is written here, after save_model -- invalidate the cache
        # for every current holder, since their effective permission set may have changed.
        super().save_related(request, form, formsets, change)
        for user_id in UserRole.objects.filter(role=form.instance).values_list('user_id', flat=True):
            invalidate_user_permission_cache(user_id)

    def delete_model(self, request, obj):
        # soft_delete() already calls write_audit_log(action_type='DELETE') internally --
        # do not also call it here, or the deletion double-logs.
        role_name = obj.name
        affected_user_ids = list(UserRole.objects.filter(role=obj).values_list('user_id', flat=True))
        soft_delete(
            obj, operator=request.user, module='RBAC',
            description=f"Deleted role '{role_name}' via Django admin.",
        )
        for user_id in affected_user_ids:
            invalidate_user_permission_cache(user_id)

    def delete_queryset(self, request, queryset):
        # Bulk "Delete selected" action -- route each object through the same guarded
        # delete_model logic rather than Django's default bulk .delete() (which would
        # hard-delete and skip soft_delete/cache invalidation entirely).
        for obj in queryset:
            self.delete_model(request, obj)


@admin.register(UserRole)
class UserRoleAdmin(ModelAdmin):
    """The actual role-assignment screen -- where a superuser gives a user a Role."""
    list_display = ('user', 'role', 'role_rank', 'assigned_at')
    list_filter = ('role',)
    search_fields = ('user__username', 'user__email', 'role__name')
    autocomplete_fields = ('user', 'role')

    def role_rank(self, obj):
        return obj.role.rank
    role_rank.short_description = 'Rank'

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        invalidate_user_permission_cache(obj.user_id)
        write_audit_log(
            operator_id=request.user.id,
            action_type='UPDATE' if change else 'CREATE',
            module='RBAC',
            description=f"Assigned role '{obj.role.name}' to user '{obj.user.username}' via Django admin.",
        )

    def delete_model(self, request, obj):
        user_id = obj.user_id
        role_name = obj.role.name
        username = obj.user.username
        super().delete_model(request, obj)
        invalidate_user_permission_cache(user_id)
        write_audit_log(
            operator_id=request.user.id,
            action_type='DELETE',
            module='RBAC',
            description=f"Removed role '{role_name}' from user '{username}' via Django admin.",
        )

    def delete_queryset(self, request, queryset):
        for obj in queryset:
            self.delete_model(request, obj)


# --- 4. PLATFORM MODELS ---

@admin.register(School)
class SchoolAdmin(ModelAdmin):
    list_display = ('name', 'level', 'shares_compound_with', 'created_at')
    list_filter = ('level', 'shares_compound_with')
    search_fields = ('name',)


@admin.register(ForcedPasswordChange)
class ForcedPasswordChangeAdmin(ModelAdmin):
    list_display = ('user', 'created_at')
    list_filter = ('created_at',)
    search_fields = ('user__username',)


@admin.register(AdminInviteCode)
class AdminInviteCodeAdmin(ModelAdmin):
    list_display = ('code_preview', 'created_by', 'created_at', 'expires_at', 'used_by', 'revoked_at')
    list_filter = ('created_at', 'expires_at')
    search_fields = ('code_preview', 'created_by__username', 'used_by__username')
