"""Models for the `identity` app.

Users, role profiles (Teacher/Student/Parent/Admin/Staff Extra), RBAC, admin invites, School/tenant anchor.

Track B step 9 (final Track B step): TeacherExtra, StaffExtra, StudentExtra,
ParentExtra, AdminExtra, ForcedPasswordChange, AdminInviteCode, Permission,
Role, UserRole physically relocated here from school/models/models.py and
school/models/rbac_models.py (both files deleted entirely -- they had
nothing else in them). Every Meta.db_table below pins the original
`school_<lowercase modelname>` table name so the physical tables never
moved; `TeacherExtra.qualified_subjects`/`Role.permissions`/
`ParentExtra.students` (M2M fields that never had an explicit db_table=
before this move -- Django's implicit join-table name is derived from the
*owning* model's app_label) are pinned the same way, to their pre-existing
implicit names, so those 3 join tables don't silently rename.

This is the LAST Track B step -- once its migration is applied, every model
in the codebase physically lives in its target app; nothing remains in
school/models/ at all (identity is deliberately last since TeacherExtra/
StudentExtra are the two most cross-referenced models in the codebase --
~9 other apps' models.py files have real FK/M2M fields into them, all using
app-label-qualified string references, e.g. 'identity.TeacherExtra', per the
pattern established relocating `academics` in Track B step 8).

`School` below was the one exception that physically moved in Track A
already (a brand-new model, no relocation risk) -- its own migration
(`0001_initial`) is already applied; nothing to do with it here.
"""
import hashlib

from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone

from school.validators import profile_pic_validator


class School(models.Model):
    """Anchor for eventual multi-school/tenant scoping.

    Deliberately NOT wired to any other model yet -- see the modular-monolith
    plan's scope decision: retrofitting `school_id` scoping onto ~90
    migrations' worth of existing models is a separate, materially bigger
    project than this restructuring pass. This model exists now so that
    future work has a real table to FK against instead of inventing one
    under time pressure later.

    `level` follows the CBC-Kenya curriculum dossier's finding
    (/home/jordan/Documents/CBC-Kenya-Curriculum-Research.html, "Is JSS the
    same school as the primary school?") that Junior Secondary School is
    administratively its own institution even when physically co-located
    with a primary school on the same compound -- "two different schools in
    one compound." `shares_compound_with` lets that real-world relationship
    be modeled explicitly (JSS.shares_compound_with = the primary school)
    without implying they're the same administrative entity.
    """
    LEVEL_CHOICES = [
        ('PRE_PRIMARY', 'Pre-Primary'),
        ('PRIMARY', 'Primary (Lower + Upper)'),
        ('JSS', 'Junior School'),
        ('SENIOR', 'Senior School'),
        ('COMBINED', 'Combined / Multiple levels under one administration'),
    ]

    name = models.CharField(max_length=200)
    level = models.CharField(max_length=20, choices=LEVEL_CHOICES)
    shares_compound_with = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='co_located_schools',
        help_text="Another School row this one physically shares a compound with, "
                  "while remaining administratively separate (e.g. a JSS row pointing "
                  "at its co-located primary school).",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'identity_school'

    def __str__(self):
        return f"{self.name} ({self.get_level_display()})"


class TeacherExtra(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)

    # --- NEW FIELDS ADDED ---
    id_number = models.CharField(max_length=20, null=True)
    address = models.CharField(max_length=255, null=True)
    # The upload_to argument automatically creates a 'profile_pic/Teacher' folder in your media directory
    profile_pic = models.ImageField(upload_to='profile_pic/Teacher/', null=True, blank=True, validators=[profile_pic_validator])

    # LEFT UNTOUCHED: Preserves your current React UI and existing text data
    subjects = models.CharField(max_length=255, null=True, blank=True)

    # Real relation, single source of truth for "is this teacher qualified for subject X"
    # eligibility checks across the allocation matrix, auto-draft, substitution finder, and
    # manual timetable picker — those previously each re-implemented their own inconsistent
    # string-matching against `subjects` above (exact-match here, icontains substring there).
    # `subjects` stays as-is for legacy display; this field is what matching logic reads now.
    qualified_subjects = models.ManyToManyField(
        'academics.Subject', blank=True, related_name='qualified_teachers',
        db_table='school_teacherextra_qualified_subjects',
    )

    # --- EXISTING FIELDS ---
    mobile = models.CharField(max_length=40)
    joindate = models.DateField(auto_now_add=True)
    status = models.BooleanField(default=False)  # False means waiting for admin approval

    # We make salary optional and default to 0 so the admin can set it later
    salary = models.PositiveIntegerField(null=True, blank=True, default=0)

    class Meta:
        db_table = 'school_teacherextra'

    def __str__(self):
        return self.get_name

    @property
    def get_id(self):
        return self.user.id if self.user else self.id

    @property
    def get_name(self):
        if not self.user:
            return f"Teacher {self.id}"

        full_name = f"{self.user.first_name} {self.user.last_name}".strip()
        return full_name if full_name else self.user.username

    @property
    def qualified_subjects_list(self):
        if not self.subjects:
            return []
        return [sub.strip().lower() for sub in self.subjects.split(',') if sub.strip()]


class StaffExtra(models.Model):
    """Non-teaching school staff (librarian, finance officer, secretary, IT support, etc).
    This model only grants login — it carries zero permissions of its own. Real access is
    entirely delegated to the RBAC Role/Permission system (this same module): an admin
    assigns a Role (e.g. 'Librarian', 'Finance Officer') to this user's underlying
    User via the Roles & Permissions page, and get_user_permission_codes() takes it from
    there. job_title is display-only — it does not drive access on its own."""
    user = models.OneToOneField(User, on_delete=models.CASCADE)

    job_title = models.CharField(max_length=100, blank=True, help_text="e.g. 'Librarian', 'Finance Officer' — display only, doesn't grant access on its own.")
    # What the applicant picked on the signup form — auto-assigned as their actual Role
    # on approval (see api_process_approval), so admin doesn't have to hunt for the right
    # Role by hand. Still just a starting point: admin can add/remove/change Roles freely
    # afterward on the Roles & Permissions page, same as any other individual assignment.
    requested_role = models.ForeignKey('Role', on_delete=models.SET_NULL, null=True, blank=True, related_name='staff_applicants')
    id_number = models.CharField(max_length=20, null=True, blank=True)
    mobile = models.CharField(max_length=40, blank=True)
    address = models.CharField(max_length=255, null=True, blank=True)
    profile_pic = models.ImageField(upload_to='profile_pic/Staff/', null=True, blank=True, validators=[profile_pic_validator])

    joindate = models.DateField(auto_now_add=True)
    status = models.BooleanField(default=False)  # False means waiting for admin approval

    class Meta:
        db_table = 'school_staffextra'

    def __str__(self):
        return self.get_name

    @property
    def get_id(self):
        return self.user.id if self.user else self.id

    @property
    def get_name(self):
        if not self.user:
            return f"Staff {self.id}"
        full_name = f"{self.user.first_name} {self.user.last_name}".strip()
        return full_name if full_name else self.user.username


class StudentExtra(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    roll = models.CharField(max_length=20, unique=True)
    mobile = models.CharField(max_length=40, null=True, blank=True)
    address = models.CharField(max_length=255, null=True)
    fee = models.PositiveIntegerField(null=True)
    cl = models.ForeignKey('academics.ClassStream', on_delete=models.SET_NULL, null=True, verbose_name="Class")

    status = models.BooleanField(default=False)

    # --- LEGACY SUMMARY FIELDS ---
    # Kept for every existing reader (AdminDashboard student list/API, seed scripts) that
    # displays a single "parent contact" line. No longer edited directly at signup — see
    # FAMILY_STRUCTURE_CHOICES below — instead auto-derived by refresh_parent_summary()
    # from the structured fields any time those change, so nothing reading these two loses
    # information. Still directly editable from the admin Edit Profile screen for accounts
    # created before this structure existed (which have no structured data to derive from).
    parent_name = models.CharField(max_length=100, null=True)
    parent_mobile = models.CharField(max_length=40, null=True)

    FAMILY_STRUCTURE_CHOICES = [
        ('both', 'Both Parents'),
        ('single', 'Single Parent'),
        ('guardian', 'Guardian'),
    ]
    SINGLE_PARENT_CHOICES = [
        ('Mother', 'Mother'),
        ('Father', 'Father'),
    ]

    family_structure = models.CharField(max_length=10, choices=FAMILY_STRUCTURE_CHOICES, null=True, blank=True)
    # Only meaningful when family_structure='single' — which of father_name/mother_name
    # below actually holds that parent's details.
    single_parent_type = models.CharField(max_length=10, choices=SINGLE_PARENT_CHOICES, null=True, blank=True)

    father_name = models.CharField(max_length=100, null=True, blank=True)
    father_mobile = models.CharField(max_length=40, null=True, blank=True)
    mother_name = models.CharField(max_length=100, null=True, blank=True)
    mother_mobile = models.CharField(max_length=40, null=True, blank=True)
    guardian_name = models.CharField(max_length=100, null=True, blank=True)
    guardian_mobile = models.CharField(max_length=40, null=True, blank=True)
    # Free text (e.g. "Aunt", "Grandfather") — only meaningful when family_structure='guardian'.
    guardian_relationship = models.CharField(max_length=50, null=True, blank=True)

    profile_pic = models.ImageField(upload_to='profile_pic/Student/', null=True, blank=True, validators=[profile_pic_validator])

    ENROLLMENT_STATUS_CHOICES = [
        ('Active', 'Active'),
        ('Suspended', 'Suspended'),
        ('Expelled', 'Expelled'),
        ('Transferred', 'Transferred Out'),
        ('Graduated', 'Graduated'),
    ]

    enrollment_state = models.CharField(max_length=20, choices=ENROLLMENT_STATUS_CHOICES, default='Active')
    enrollment_notes = models.TextField(null=True, blank=True, help_text="Reason for suspension/expulsion/transfer")
    last_enrollment_change = models.DateTimeField(auto_now=True, null=True)

    class Meta:
        db_table = 'school_studentextra'

    def refresh_parent_summary(self):
        """Recomputes parent_name/parent_mobile from the structured father/mother/guardian
        fields, so every existing single-line reader (AdminDashboard list, seed scripts)
        keeps working without changes. Does not save() — callers save alongside their own
        other field updates."""
        parts = []
        if self.father_name:
            parts.append(f"{self.father_name} (Father)")
        if self.mother_name:
            parts.append(f"{self.mother_name} (Mother)")
        if self.guardian_name:
            label = self.guardian_relationship or 'Guardian'
            parts.append(f"{self.guardian_name} ({label})")

        if parts:
            self.parent_name = ", ".join(parts)
            self.parent_mobile = self.father_mobile or self.mother_mobile or self.guardian_mobile or None

    @property
    def get_name(self):
        return self.user.first_name + " " + self.user.last_name

    @property
    def get_id(self):
        return self.user.id

    def __str__(self):
        return self.user.first_name


RELATIONSHIP_CHOICES = [
    ('Father', 'Father'),
    ('Mother', 'Mother'),
    ('Guardian', 'Guardian'),
    ('Other', 'Other'),
]


class ParentExtra(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    mobile = models.CharField(max_length=40)

    relationship = models.CharField(max_length=20, choices=RELATIONSHIP_CHOICES, default='Father')

    # Linking Parent to a specific Student
    students = models.ManyToManyField(StudentExtra, db_table='school_parentextra_students')
    status = models.BooleanField(default=False)

    class Meta:
        db_table = 'school_parentextra'

    def __str__(self):
        return self.user.first_name

    @property
    def get_id(self):
        return self.user.id

    @property
    def get_name(self):
        return self.user.first_name + " " + self.user.last_name


class AdminExtra(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    mobile = models.CharField(max_length=40, null=True)
    address = models.CharField(max_length=200, null=True)

    # False = not yet fully approved by an existing admin. Unlike Teacher/Student/Parent,
    # a pending admin is NOT added to the ADMIN group until approved, since ADMIN
    # group membership alone is sufficient to pass is_admin() / api_admin_required.
    #
    # Admin approval is a two-step flow, since this is the highest-privilege role:
    #   1. status=False, verification_code=None      -> awaiting an existing admin's initial review.
    #   2. status=False, verification_code=<hash>     -> an admin clicked "Approve"; a code was
    #      generated and shown to that admin to relay to the applicant out-of-band. The applicant
    #      must enter it correctly to finish activating their own account.
    #   3. status=True                                -> fully approved; added to the ADMIN group.
    #
    # verification_code stores a make_password() hash, not the raw digits — it's a low-entropy
    # 6-digit OTP, so a salted/slow hash matters here (unlike AdminInviteCode.code_hash below,
    # which is high-entropy and can safely use a fast unsalted digest).
    status = models.BooleanField(default=False)
    verification_code = models.CharField(max_length=128, null=True, blank=True)
    code_generated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'school_adminextra'

    def __str__(self):
        return self.user.first_name


class ForcedPasswordChange(models.Model):
    """Presence of a row means this user must set their own new password before they
    can use the dashboard. Created whenever an admin resets someone's password, so a
    relayed temporary password can't quietly become permanent — and cleared
    automatically the next time that user changes their password themselves."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='forced_password_change')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'school_forcedpasswordchange'

    def __str__(self):
        return f"{self.user.username} must change password"


class AdminInviteCode(models.Model):
    """
    A single-use, expiring code an existing admin generates and relays out-of-band to let
    someone else register for an admin account (school/views/admin_invite_views.py). Replaces
    the old ADMIN_SIGNUP_INVITE_CODE static shared secret.

    Only a sha256 digest of the raw code is ever stored, plus a 4-char plaintext preview so an
    admin can tell their own generated codes apart in a list without the raw value being
    recoverable. Unlike AdminExtra.verification_code, this is high-entropy random data (not a
    short OTP), so a fast unsalted hash is appropriate and lets signup look it up by exact
    match instead of scanning every outstanding invite.
    """
    code_hash = models.CharField(max_length=64, unique=True, db_index=True)
    code_preview = models.CharField(max_length=4)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='generated_admin_invites')
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    used_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        db_table = 'school_admininvitecode'
        ordering = ['-created_at']

    @staticmethod
    def hash_code(raw_code):
        """Normalizes (case/whitespace/hyphen-insensitive) and sha256-hashes a raw invite
        code, used identically at generation time and at signup lookup time."""
        normalized = raw_code.strip().upper().replace('-', '').replace(' ', '')
        return hashlib.sha256(normalized.encode()).hexdigest()

    @property
    def status(self):
        if self.revoked_at:
            return 'Revoked'
        if self.used_at:
            return 'Used'
        if timezone.now() > self.expires_at:
            return 'Expired'
        return 'Active'

    def __str__(self):
        return f"Invite ...{self.code_preview} ({self.status})"


class Permission(models.Model):
    """A granular capability, e.g. 'curriculum.edit'. Module-tagged so the
    management UI can group permissions by feature area as more get added."""
    code = models.CharField(max_length=100, unique=True, help_text="e.g. 'curriculum.edit'")
    label = models.CharField(max_length=150)
    module = models.CharField(max_length=50, help_text="Groups permissions in the UI, e.g. 'Curriculum'")

    class Meta:
        db_table = 'school_permission'
        ordering = ['module', 'code']

    def __str__(self):
        return self.code


class Role(models.Model):
    """A named bundle of permissions. Additive to Django's Group system —
    Groups still govern dashboard routing, Role/Permission governs finer
    in-dashboard capabilities."""
    name = models.CharField(max_length=100, unique=True)
    description = models.CharField(max_length=255, blank=True)
    permissions = models.ManyToManyField(Permission, related_name='roles', blank=True, db_table='school_role_permissions')
    # Set only by seed_rbac.py for the Admin/Teacher roles it manages — never via the API.
    # Protects against deleting or renaming a role that seed_rbac's Group-sync and every
    # non-superuser admin's access depend on existing under an exact, stable name.
    is_system_role = models.BooleanField(default=False)

    class Meta:
        db_table = 'school_role'

    def __str__(self):
        return self.name


class UserRole(models.Model):
    """Assigns a Role to a User. A user may hold multiple roles."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='rbac_roles')
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name='user_assignments')
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'school_userrole'
        unique_together = ('user', 'role')

    def __str__(self):
        return f"{self.user.username} -> {self.role.name}"
