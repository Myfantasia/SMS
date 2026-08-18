from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand

from apps.identity.models import Permission, Role, UserRole

# (code, label, module) — module groups the checkbox grid on the Roles & Permissions page.
# Every code here is one actually referenced by a rbac_view_permission/rbac_edit_permission
# attribute or require_permission(...) call somewhere in school/views/ — kept in lockstep with
# the code, not aspirational, so an unchecked box always means "this literally does nothing yet."
#
# Adding RBAC coverage for a new/growing component, as the system grows past today's set:
#   1. Add a (code, label, module) row below. Decide whether TEACHER_PERMISSIONS should also
#      get it (Admin always does — see admin_role.permissions.set(...) in handle() below).
#   2. Gate the view with require_permission(code) (FBVs) or HasModulePermission +
#      rbac_view_permission/rbac_edit_permission class attrs (CBVs/ViewSets).
#   3. Re-run `python manage.py seed_rbac` so the new code (and any Admin/Teacher grant) exists.
PERMISSIONS = [
    ('curriculum.view', 'View curriculum data', 'Curriculum'),
    ('curriculum.edit', 'Edit curriculum data', 'Curriculum'),
    ('curriculum.archive', 'Sunset/archive a curriculum, or correct an archived record', 'Curriculum'),

    ('pathway.view', 'View Pathway selection requests', 'Curriculum'),
    ('pathway.edit', 'Approve/reject Pathway requests (also grants Class Teachers approval rights)', 'Curriculum'),

    ('attendance.view', 'View attendance registers', 'Attendance'),
    ('attendance.edit', 'Submit attendance registers', 'Attendance'),

    ('events.edit', 'Create/edit/delete events', 'Events'),

    ('notices.edit', 'Create/edit/delete notices', 'Notices'),

    ('leave.view', 'View leave requests', 'Leave'),
    ('leave.edit', 'Apply for leave, or (admin-equivalent) log/backfill and delete any request', 'Leave'),
    ('leave.approve', 'Approve/reject leave requests and assign relief teachers — narrower than leave.edit: no backfill-create or delete', 'Leave'),

    ('results.view', 'View exam results & analytics', 'Results'),
    ('results.edit', 'Generate/publish exam results', 'Results'),

    ('exams.view', 'View exam setup & marks entry data', 'Exams'),
    ('exams.edit', 'Manage exam terms, events, and grading rules', 'Exams'),
    ('exams.marks', 'Enter/edit marks for an exam event — narrower than exams.edit: no term/event/grading-rule changes', 'Exams'),
    ('exams.publish', 'Publish or revert an exam event\'s results to students/parents — narrower than exams.edit', 'Exams'),

    ('assignments.view', 'View assignment management data', 'Assignments'),
    ('assignments.edit', 'Create/grade assignments', 'Assignments'),

    ('finance.view', 'View fees & salary overview', 'Finance'),

    ('timetable.view', 'View the timetable', 'Timetable'),
    ('timetable.edit', 'Build/edit the timetable', 'Timetable'),

    ('allocations.view', 'View subject-teacher allocations', 'Allocations'),
    ('allocations.edit', 'Manage subject-teacher allocations (manual matrix edits)', 'Allocations'),
    ('allocations.bulk', 'Run bulk/global allocation operations — rollover, auto-allocate, global policy, split execution', 'Allocations'),

    ('classes.view', 'View class/stream/enrollment data', 'Classes'),
    ('classes.edit', 'Manage classes and streams (structure, capacity, class-teacher assignment)', 'Classes'),
    ('classes.enrollment', 'Enroll/transfer students between classes — narrower than classes.edit: no stream/structure changes', 'Classes'),

    ('chat.manage', 'Full chat admin toolkit: compliance audit log, parent cohort bulk-select, and broadcasts', 'Chat'),
    ('chat.broadcast', 'Send school-wide broadcast messages — narrower than chat.manage: no audit log or parent cohort access', 'Chat'),

    ('audit.view', 'View the system-wide audit log (all modules, including RBAC changes)', 'Audit'),

    ('users.view', 'View the user directory, pending approvals, and dashboard stats', 'Users'),
    ('users.approve', 'Approve or reject pending account applications (any user type)', 'Users'),
    ('users.edit', 'Edit user profile data (students, teachers, parents)', 'Users'),
    ('users.delete', 'Delete/deactivate a user account', 'Users'),
    ('users.reset_password', "Trigger an admin-initiated password reset for another user's account", 'Users'),

    ('admin_invites.manage', 'Generate/revoke admin signup invite codes; view and regenerate post-approval verification codes', 'AdminInvites'),

    ('trash.view', 'View the Trash (soft-deleted items across all modules)', 'Trash'),
    ('trash.manage', 'Restore or permanently delete items in the Trash', 'Trash'),
]

# Admin gets every permission in the catalog automatically (see handle()) — no hardcoded
# list to keep in sync as new modules are added.
TEACHER_PERMISSIONS = [
    # View + edit: matches what teachers can already do today, so this rollout changes
    # enforcement, not capability.
    'attendance.view', 'attendance.edit',
    'results.view', 'results.edit',
    'exams.view', 'exams.edit',
    'assignments.view', 'assignments.edit',
    'leave.view', 'leave.edit',
    'curriculum.view', 'curriculum.edit',
    'pathway.view', 'pathway.edit',
    # View only: teachers see the master timetable/class data but don't build it.
    'timetable.view',
    'classes.view',
    # Not granted: events.edit/notices.edit (posting is admin-only today via IsAdminForWrite,
    # this preserves that), finance.view, allocations.*, chat.manage.
]

ROLE_GROUP_SOURCE = {
    'Admin': 'ADMIN',
    'Teacher': 'TEACHER',
}


class Command(BaseCommand):
    """
    Seeds the RBAC permission catalog and starter roles, and assigns those
    roles to every user who currently belongs to the matching Django Group —
    so gating endpoints behind require_permission/HasModulePermission doesn't
    lock out anyone who could already do the equivalent action yesterday.

    Safe to re-run — everything is get_or_create'd.

    Usage:
        python manage.py seed_rbac              # apply
        python manage.py seed_rbac --dry-run     # preview only, no writes
    """
    help = "Seed the RBAC permission catalog, starter roles, and role assignments from existing Groups."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        self.stdout.write("Permissions:")
        permissions_by_code = {}
        for code, label, module in PERMISSIONS:
            if dry_run:
                exists = Permission.objects.filter(code=code).exists()
                self.stdout.write(f"  {'exists' if exists else '[DRY RUN] would create'}: {code}")
                permissions_by_code[code] = Permission.objects.filter(code=code).first()
                continue
            permission, created = Permission.objects.update_or_create(
                code=code, defaults={'label': label, 'module': module}
            )
            permissions_by_code[code] = permission
            self.stdout.write(f"  {'created' if created else 'exists'}: {code}")

        self.stdout.write("\nRoles:")
        roles_by_name = {}

        if dry_run:
            admin_exists = Role.objects.filter(name='Admin').exists()
            all_codes = [c for c, _, m in PERMISSIONS if m != 'Trash']
            self.stdout.write(f"  {'exists' if admin_exists else '[DRY RUN] would create'}: Admin -> ALL except Trash ({len(all_codes)} permissions)")
            roles_by_name['Admin'] = Role.objects.filter(name='Admin').first()
        else:
            admin_role, created = Role.objects.get_or_create(name='Admin', defaults={'description': 'Full access to every module.'})
            # Trash is the one module Admin does NOT get automatically — it's a
            # deliberate per-admin grant via Roles & Permissions, not a blanket right.
            admin_role.permissions.set(Permission.objects.exclude(code__startswith='trash.'))
            if not admin_role.is_system_role:
                admin_role.is_system_role = True
                admin_role.save(update_fields=['is_system_role'])
            roles_by_name['Admin'] = admin_role
            self.stdout.write(f"  {'created' if created else 'updated'}: Admin -> ALL except Trash ({Permission.objects.exclude(code__startswith='trash.').count()} permissions)")

        if dry_run:
            teacher_exists = Role.objects.filter(name='Teacher').exists()
            self.stdout.write(f"  {'exists' if teacher_exists else '[DRY RUN] would create'}: Teacher -> {TEACHER_PERMISSIONS}")
            roles_by_name['Teacher'] = Role.objects.filter(name='Teacher').first()
        else:
            teacher_role, created = Role.objects.get_or_create(name='Teacher', defaults={'description': 'Day-to-day teaching modules.'})
            teacher_role.permissions.set([permissions_by_code[c] for c in TEACHER_PERMISSIONS if permissions_by_code.get(c)])
            if not teacher_role.is_system_role:
                teacher_role.is_system_role = True
                teacher_role.save(update_fields=['is_system_role'])
            roles_by_name['Teacher'] = teacher_role
            self.stdout.write(f"  {'created' if created else 'updated'}: Teacher -> {TEACHER_PERMISSIONS}")

        self.stdout.write("\nRole assignments (from existing Groups):")
        assigned_count = 0
        for role_name, group_name in ROLE_GROUP_SOURCE.items():
            role = roles_by_name.get(role_name)
            group = Group.objects.filter(name=group_name).first()
            if not group:
                self.stdout.write(f"  no '{group_name}' group found, skipping.")
                continue

            for user in group.user_set.all():
                if dry_run:
                    already = not role or UserRole.objects.filter(user=user, role=role).exists()
                    self.stdout.write(
                        f"  {'[DRY RUN] would assign' if not already else 'already assigned'}: "
                        f"{user.username} -> {role_name}"
                    )
                    continue
                _, created = UserRole.objects.get_or_create(user=user, role=role)
                if created:
                    assigned_count += 1
                self.stdout.write(f"  {'assigned' if created else 'already assigned'}: {user.username} -> {role_name}")

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would assign' if dry_run else 'Assigned'} {assigned_count} new role(s)."
        ))
