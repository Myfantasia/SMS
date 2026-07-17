from django.db import models
from django.contrib.auth.models import User


class Permission(models.Model):
    """A granular capability, e.g. 'curriculum.edit'. Module-tagged so the
    management UI can group permissions by feature area as more get added."""
    code = models.CharField(max_length=100, unique=True, help_text="e.g. 'curriculum.edit'")
    label = models.CharField(max_length=150)
    module = models.CharField(max_length=50, help_text="Groups permissions in the UI, e.g. 'Curriculum'")

    class Meta:
        ordering = ['module', 'code']

    def __str__(self):
        return self.code


class Role(models.Model):
    """A named bundle of permissions. Additive to Django's Group system —
    Groups still govern dashboard routing, Role/Permission governs finer
    in-dashboard capabilities."""
    name = models.CharField(max_length=100, unique=True)
    description = models.CharField(max_length=255, blank=True)
    permissions = models.ManyToManyField(Permission, related_name='roles', blank=True)
    # Set only by seed_rbac.py for the Admin/Teacher roles it manages — never via the API.
    # Protects against deleting or renaming a role that seed_rbac's Group-sync and every
    # non-superuser admin's access depend on existing under an exact, stable name.
    is_system_role = models.BooleanField(default=False)

    def __str__(self):
        return self.name


class UserRole(models.Model):
    """Assigns a Role to a User. A user may hold multiple roles."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='rbac_roles')
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name='user_assignments')
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'role')

    def __str__(self):
        return f"{self.user.username} -> {self.role.name}"
