from django.core.management.base import BaseCommand

from apps.identity.models import Role, School


class Command(BaseCommand):
    """
    One-time backfill run after migrating in Role.school (nullable, from
    apps.identity.migrations.0007_role_school). Assigns the one existing School row to
    every Role that doesn't have one yet -- without this, RoleViewSet's school-scoped
    queryset would show zero existing roles.

    Assumes exactly one School row already exists (apps.academics's
    backfill_curriculum_preset_school creates it if this is the first tenancy-scoped
    entity to run in this deployment) -- mirrors that command's own single-tenant
    assumption rather than duplicating its "create a Default School" logic.

    Safe to re-run (idempotent): a second run finds zero unassigned roles left.

    Usage:
        python manage.py backfill_role_school             # apply
        python manage.py backfill_role_school --dry-run   # preview only
    """
    help = "Assign the existing School to every Role that doesn't have one yet."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help="Preview without saving changes.")

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        count = School.objects.count()
        if count == 0:
            self.stderr.write(self.style.ERROR(
                "No School row exists yet -- run "
                "`python manage.py backfill_curriculum_preset_school` first."
            ))
            return
        if count > 1:
            self.stderr.write(self.style.ERROR(
                f"Found {count} School rows -- this command assumes single-tenant and won't "
                "guess which one owns the unassigned roles. Assign them manually."
            ))
            return

        school = School.objects.get()
        unassigned = Role.objects.filter(school__isnull=True)
        updated = unassigned.count()
        if not dry_run:
            unassigned.update(school=school)

        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY RUN] Would assign' if dry_run else 'Assigned'} school to {updated} role(s)."
        ))
