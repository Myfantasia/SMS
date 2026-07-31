import hashlib

from django.db import models
from django.contrib.auth.models import User
from django.core.validators import MinValueValidator
from django.utils import timezone

from school.validators import safe_document_validator, profile_pic_validator


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
        'Subject', blank=True, related_name='qualified_teachers'
    )

    # --- EXISTING FIELDS ---
    mobile = models.CharField(max_length=40)
    joindate = models.DateField(auto_now_add=True)
    status = models.BooleanField(default=False)  # False means waiting for admin approval

    # We make salary optional and default to 0 so the admin can set it later
    salary = models.PositiveIntegerField(null=True, blank=True, default=0)

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
    entirely delegated to the RBAC Role/Permission system (school/models/rbac_models.py):
    an admin assigns a Role (e.g. 'Librarian', 'Finance Officer') to this user's underlying
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
    cl = models.ForeignKey('ClassStream', on_delete=models.SET_NULL, null=True, verbose_name="Class")

    # --- SAFE DEPRECATION ZONE ---
    # We have safely disabled this. The system now strictly relies on `StudentSubjectEnrollment`.
    # elective_subjects = models.ManyToManyField('Subject', related_name='students_enrolled', blank=True)
    # -----------------------------

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
    ]

    enrollment_state = models.CharField(max_length=20, choices=ENROLLMENT_STATUS_CHOICES, default='Active')
    enrollment_notes = models.TextField(null=True, blank=True, help_text="Reason for suspension/expulsion/transfer")
    last_enrollment_change = models.DateTimeField(auto_now=True, null=True)

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

# Opinion: We split Attendance into two models: the "Session" (the register being submitted)
# and the "Record" (the individual student's status). This prevents massive database bloat.

class AttendanceSession(models.Model):
    """
    Records the event of a teacher submitting a daily register for a specific class.
    """
    class_stream = models.ForeignKey('ClassStream', on_delete=models.CASCADE, related_name='attendance_sessions')
    date = models.DateField()

    # We link to User instead of TeacherExtra so Admin can also submit on their behalf right now
    submitted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Prevents a teacher from accidentally submitting two registers for the same class on the same day
        unique_together = ('class_stream', 'date')

    def __str__(self):
        return f"{self.class_stream} - {self.date}"


class AttendanceRecord(models.Model):
    """
    Replaces your old Attendance model.
    This now links directly to your StudentExtra model for accurate reporting.
    """
    STATUS_CHOICES = [
        ('Present', 'Present'),
        ('Absent', 'Absent'),
        ('Late', 'Late'),
        ('Excused', 'Excused')
    ]

    session = models.ForeignKey(AttendanceSession, on_delete=models.CASCADE, related_name='records')
    student = models.ForeignKey('StudentExtra', on_delete=models.CASCADE, related_name='attendance_records')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='Present')
    remarks = models.CharField(max_length=255, null=True, blank=True, help_text="e.g., 'Sick leave', 'Arrived at 9 AM'")

    class Meta:
        unique_together = ('session', 'student')

    def __str__(self):
        return f"{self.student.get_name} - {self.status} ({self.session.date})"


class Notice(models.Model):
    """
    Upgraded from your original model. Added a title, target audience, and file uploads.
    """
    AUDIENCE_CHOICES = [
        ('All', 'All'),
        ('Teachers', 'Teachers Only'),
        ('Parents', 'Parents Only'),
        ('Students', 'Students Only'),
    ]

    title = models.CharField(max_length=200, default="General Notice")
    message = models.TextField()  # Upgraded to TextField for longer announcements
    date = models.DateField(auto_now_add=True)
    by = models.CharField(max_length=50, default='School Admin')

    # New fields for better UI filtering
    audience = models.CharField(max_length=20, choices=AUDIENCE_CHOICES, default='All')
    attachment = models.FileField(
        upload_to='notices/',
        null=True,
        blank=True,
        validators=[safe_document_validator]
    )

    # --- ADDED: Urgency Flag ---
    is_urgent = models.BooleanField(default=False)

    def __str__(self):
        return self.title


class Event(models.Model):
    """
    Powers the School Calendar (e.g., Sports Day, Mid-Term Breaks, KCSE Start Date).
    """
    title = models.CharField(max_length=200)
    description = models.TextField(null=True, blank=True)
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()

    # e.g., 'Holiday', 'Exam', 'Meeting' - helps color-code the React Calendar
    event_type = models.CharField(max_length=50, default='General')
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.title} ({self.start_time.date()})"


# ==========================================
# 3. THE NOTIFICATION ENGINE (Parent Dashboard Prep)
# ==========================================

class Notification(models.Model):
    """
    The permanent ledger of alerts. This will feed the bell icon on the Parent Dashboard.
    """
    # Links directly to the base User model so it can be used for Parents, Teachers, or Students later
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    title = models.CharField(max_length=100)
    message = models.TextField()

    # Crucial for the UI "Unread" badge
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    # Optional: A URL path to redirect the user when they click the notification
    action_url = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        ordering = ['-created_at']  # Ensures the newest notifications appear at the top

    def __str__(self):
        return f"To: {self.recipient.username} - {self.title} (Read: {self.is_read})"


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
    students = models.ManyToManyField(StudentExtra)
    status = models.BooleanField(default=False)

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

    def __str__(self):
        return self.user.first_name


class ForcedPasswordChange(models.Model):
    """Presence of a row means this user must set their own new password before they
    can use the dashboard. Created whenever an admin resets someone's password, so a
    relayed temporary password can't quietly become permanent — and cleared
    automatically the next time that user changes their password themselves."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='forced_password_change')
    created_at = models.DateTimeField(auto_now_add=True)

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


# ==========================================
# EXAMINATIONS & RESULTS ENGINE (NEWLY ADDED)
# ==========================================

class AcademicYear(models.Model):
    """
    Handles the transition between years (e.g., 2026 to 2027).
    When an admin archives a year, all results under it become read-only.
    """
    year = models.CharField(max_length=10, unique=True, help_text="e.g., 2026")
    is_active = models.BooleanField(default=True, help_text="Is this the current academic year?")
    is_archived = models.BooleanField(default=False)

    def __str__(self):
        return self.year


class ExamTerm(models.Model):
    """Groups exams into terms (e.g., Term 1, Term 2)"""
    name = models.CharField(max_length=50, help_text="e.g., Term 1")
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.CASCADE, related_name='terms')
    start_date = models.DateField()
    end_date = models.DateField()

    is_active = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.name} - {self.academic_year.year}"


class ExamEvent(models.Model):
    """The actual assessment (e.g., CAT 1, End of Term)"""
    EXAM_TYPES = (
        ('CAT', 'Continuous Assessment Test'),
        ('MAIN', 'Main/End of Term Exam'),
    )
    name = models.CharField(max_length=100, help_text="e.g., Term 1 CAT 1")
    exam_type = models.CharField(max_length=10, choices=EXAM_TYPES, default='CAT')
    term = models.ForeignKey(ExamTerm, on_delete=models.CASCADE, related_name='exams')

    # Weighting: e.g., if CAT 1 is out of 30, total_marks = 30.
    total_marks = models.IntegerField(default=100)

    # The Publishing Pipeline Status
    PUBLISH_STATUS = [
        ('Draft', 'Draft - Teachers entering marks'),
        ('Submitted', 'Submitted - Waiting Admin Approval'),
        ('Published', 'Published - Visible to Students/Parents')
    ]
    status = models.CharField(max_length=20, choices=PUBLISH_STATUS, default='Draft')

    published_at = models.DateTimeField(null=True, blank=True, help_text="Timestamp of when the exam was published.")

    def __str__(self):
        return f"{self.name} ({self.term.name})"


class GradingRule(models.Model):
    """
    Admin-configurable grading scale.
    Can be configured for 8-4-4 (A, B, C) or CBC (4, 3, 2, 1).
    """

    CURRICULUM_CHOICES = [
        ('CBC', 'Competency Based Curriculum (CBC)'),
        ('8-4-4', 'Standard 8-4-4 Curriculum'),
    ]

    curriculum = models.CharField(max_length=10, choices=CURRICULUM_CHOICES, default='8-4-4')
    grade_label = models.CharField(max_length=5, help_text="e.g., 'A' or 'EE'")
    min_score = models.DecimalField(max_digits=5, decimal_places=2, help_text="Minimum percentage/score")
    max_score = models.DecimalField(max_digits=5, decimal_places=2, help_text="Maximum percentage/score")
    remarks = models.CharField(max_length=100, blank=True, help_text="e.g., 'Excellent', 'Exceeding Expectation'")

    class Meta:
        ordering = ['-min_score']

    def __str__(self):
        return f"{self.grade_label} ({self.min_score} - {self.max_score} | {self.curriculum})"


class ExamResult(models.Model):
    """The individual score a student gets in a specific subject for a specific exam."""
    exam = models.ForeignKey(ExamEvent, on_delete=models.CASCADE, related_name='results')
    student = models.ForeignKey(StudentExtra, on_delete=models.CASCADE, related_name='exam_results')
    subject = models.ForeignKey('Subject', on_delete=models.CASCADE)

    # NEW: Tracks exactly who entered this mark and remark
    teacher = models.ForeignKey(TeacherExtra, on_delete=models.SET_NULL, null=True, blank=True)

    # The actual score. For CBC, a teacher might enter 1, 2, 3, or 4. For 8-4-4, up to 100.
    marks_obtained = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(0)]
    )

    # Overrides or specific remarks for this student's performance
    teacher_remarks = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        # Prevent double-entry: A student can only have ONE score per subject per exam
        unique_together = ('exam', 'student', 'subject')

    def __str__(self):
        return f"{self.student.get_name} - {self.subject.name} - {self.marks_obtained}"


class StudentReportSummary(models.Model):
    """
    Stores the manual overall remarks for a student's specific exam.
    """
    student = models.ForeignKey(StudentExtra, on_delete=models.CASCADE, related_name='report_summaries')
    exam = models.ForeignKey(ExamEvent, on_delete=models.CASCADE, related_name='student_summaries')

    class_teacher_remark = models.TextField(blank=True, null=True, help_text="Manual remark from the class teacher")
    principal_remark = models.TextField(blank=True, null=True, help_text="Manual remark from the principal")

    class Meta:
        # A student can only have ONE overall summary per exam event
        unique_together = ('student', 'exam')

    def __str__(self):
        return f"Summary for {self.student.get_name} - {self.exam.name}"


class ClassExamStatus(models.Model):
    """
    Tracks whether a specific class stream has had its results published for a specific exam.
    This allows staggered, class-by-class publishing.
    """
    exam = models.ForeignKey(ExamEvent, on_delete=models.CASCADE, related_name='class_publish_statuses')
    class_stream = models.ForeignKey('ClassStream', on_delete=models.CASCADE, related_name='exam_publish_statuses')

    # Same choices as your ExamEvent model
    status = models.CharField(max_length=20, choices=ExamEvent.PUBLISH_STATUS, default='Draft')

    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        # A class can only have ONE publish status per exam
        unique_together = ('exam', 'class_stream')

    def __str__(self):
        return f"{self.class_stream} - {self.exam.name} ({self.status})"

