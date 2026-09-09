import io
import random

from django.contrib.auth.hashers import make_password
from django.contrib.auth.models import User, Group
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction
from PIL import Image, ImageDraw, ImageFont

from apps.identity.models import TeacherExtra, StudentExtra, ParentExtra
from apps.academics.models import GradeLevel, ClassStream, Subject, AcademicYear
from apps.allocations.models import SubjectBlock
from apps.students.models import StudentSubjectEnrollment

# Synthetic-but-realistic Kenyan name pools (no real individuals) — large enough that
# first+last combinations rarely repeat across a ~600-student run, and the email/username
# uniqueness loop below handles it when they do.
FIRST_NAMES_M = [
    'Brian', 'Kevin', 'Dennis', 'Collins', 'Victor', 'Felix', 'Elvis', 'Erick', 'Duncan',
    'Alex', 'Samuel', 'Peter', 'James', 'John', 'David', 'Daniel', 'Joseph', 'Anthony',
    'Michael', 'Patrick', 'Simon', 'Stephen', 'Charles', 'Francis', 'Moses', 'Isaac',
    'Emmanuel', 'Benson', 'Geoffrey', 'Kelvin', 'Nixon', 'Allan', 'Edwin', 'Bramwel',
    'Cyrus', 'Amos', 'Hillary', 'Ibrahim', 'Yusuf', 'Omar',
]
FIRST_NAMES_F = [
    'Faith', 'Grace', 'Mercy', 'Joy', 'Ann', 'Mary', 'Jane', 'Purity', 'Esther', 'Ruth',
    'Sharon', 'Diana', 'Brenda', 'Winnie', 'Caroline', 'Lilian', 'Irene', 'Cynthia',
    'Beatrice', 'Agnes', 'Nancy', 'Eunice', 'Josephine', 'Dorcas', 'Rose', 'Catherine',
    'Elizabeth', 'Patricia', 'Susan', 'Christine', 'Millicent', 'Jacinta', 'Vivian',
    'Amina', 'Fatuma', 'Zainab', 'Halima', 'Naomi', 'Rachael', 'Stacy',
]
LAST_NAMES = [
    'Mwangi', 'Kamau', 'Kariuki', 'Njoroge', 'Otieno', 'Odhiambo', 'Owino', 'Ochieng',
    'Wanjiru', 'Wambui', 'Mutahi', 'Kiprono', 'Kiprotich', 'Cheruiyot', 'Korir', 'Rotich',
    'Mugendi', 'Kimani', 'Muriuki', 'Gitau', 'Njeri', 'Wafula', 'Wekesa', 'Barasa',
    'Simiyu', 'Achieng', 'Auma', 'Onyango', 'Agunda', 'Kazungu', 'Nyongesa', 'Mwakio',
    'Hassan', 'Msanii', 'Mwangangi', 'Kilonzo', 'Mutua', 'Ndolo', 'Wangari', 'Nduta',
]

TEST_PASSWORD = "TestPass@2026"

AVATAR_COLORS = [
    '#4F46E5', '#059669', '#DC2626', '#D97706', '#7C3AED', '#0891B2',
    '#DB2777', '#65A30D', '#EA580C', '#2563EB',
]

# Subjects with the thinnest current qualified-teacher coverage get priority when adding
# new teachers, so the extra headcount actually relieves the tightest spots first.
PRIORITY_SUBJECTS = [
    'Physical Education', 'Islam Religious Education', 'French', 'Drawing and Design',
    'Home Science', 'Agriculture', 'Business Studies', 'Computer Studies',
]


def make_avatar(initials, seed):
    color = AVATAR_COLORS[seed % len(AVATAR_COLORS)]
    img = Image.new('RGB', (256, 256), color)
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype('DejaVuSans-Bold.ttf', 96)
    except OSError:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), initials, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((256 - w) / 2 - bbox[0], (256 - h) / 2 - bbox[1]), initials, fill='white', font=font)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return ContentFile(buf.getvalue())


def unique_username(base, existing_usernames):
    candidate = base
    n = 1
    while candidate in existing_usernames or User.objects.filter(username=candidate).exists():
        n += 1
        candidate = f"{base}{n}"
    existing_usernames.add(candidate)
    return candidate


def unique_email(local, domain, existing_emails):
    candidate = f"{local}{domain}"
    n = 1
    while candidate in existing_emails or User.objects.filter(email=candidate).exists():
        n += 1
        candidate = f"{local}{n}{domain}"
    existing_emails.add(candidate)
    return candidate


class Command(BaseCommand):
    help = (
        "Populate the dev database with a large, realistic-looking synthetic population of "
        "students (filled to near stream capacity), extra teachers, and parent accounts, plus "
        "generated avatar images and tech-elective enrollments — so capacity-dependent features "
        "(allocation, virtual streams, pagination, dashboards) can be exercised at real scale."
    )

    def add_arguments(self, parser):
        parser.add_argument('--students-per-stream', type=int, default=38,
                             help='Target student count per real stream (default 38, capacity is 40).')
        parser.add_argument('--extra-teachers', type=int, default=20,
                             help='Number of additional teacher accounts to create.')
        parser.add_argument('--dry-run', action='store_true', help='Roll back at the end, print counts only.')

    def handle(self, *args, **options):
        students_per_stream = options['students_per_stream']
        extra_teachers = options['extra_teachers']
        dry_run = options['dry_run']

        # Every synthetic account shares the one known TEST_PASSWORD — hashing it once and
        # reusing the digest (instead of calling set_password() per user) skips Django's
        # deliberately-slow per-call PBKDF2 hashing for every one of the ~1000+ accounts this
        # command creates, which was the dominant cost in the first run.
        hashed_password = make_password(TEST_PASSWORD)

        existing_usernames = set(User.objects.values_list('username', flat=True))
        existing_emails = set(User.objects.values_list('email', flat=True))

        student_group, _ = Group.objects.get_or_create(name='STUDENT')
        teacher_group, _ = Group.objects.get_or_create(name='TEACHER')
        parent_group, _ = Group.objects.get_or_create(name='PARENT')

        current_year = AcademicYear.objects.filter(is_active=True).first()

        max_roll = 0
        for roll in StudentExtra.objects.values_list('roll', flat=True):
            try:
                max_roll = max(max_roll, int(roll))
            except (TypeError, ValueError):
                pass
        next_roll = max_roll + 1 if max_roll else 2026001

        summary = {'students': 0, 'parents': 0, 'teachers': 0, 'enrollments': 0}

        with transaction.atomic():
            sid = transaction.savepoint()

            # --- STUDENTS: fill every real stream up to the target count ---
            streams = list(ClassStream.live.filter(is_virtual=False).select_related('grade'))
            pending_family = []  # buffer of newly-created StudentExtra awaiting a parent

            def flush_family():
                if not pending_family:
                    return
                is_father = random.random() < 0.5
                first = random.choice(FIRST_NAMES_M if is_father else FIRST_NAMES_F)
                last = pending_family[0].user.last_name
                p_username = unique_username(f"{first.lower()}{last.lower()}_parent", existing_usernames)
                p_email = unique_email(f"{first.lower()}{last.lower()}", "@gmail.com", existing_emails)
                p_user = User.objects.create(
                    username=p_username, email=p_email, first_name=first, last_name=last,
                    password=hashed_password,
                )
                mobile = f"07{random.randint(10000000, 99999999)}"
                parent = ParentExtra.objects.create(
                    user=p_user, mobile=mobile,
                    relationship='Father' if is_father else 'Mother',
                    status=True,
                )
                parent.students.set(pending_family)
                parent_group.user_set.add(p_user)
                for st in pending_family:
                    st.parent_name = f"{first} {last}"
                    st.parent_mobile = mobile
                    st.save(update_fields=['parent_name', 'parent_mobile'])
                summary['parents'] += 1
                pending_family.clear()

            for stream in streams:
                current_count = StudentExtra.objects.filter(cl=stream).count()
                to_create = max(0, students_per_stream - current_count)
                for i in range(to_create):
                    is_male = random.random() < 0.5
                    first = random.choice(FIRST_NAMES_M if is_male else FIRST_NAMES_F)
                    last = random.choice(LAST_NAMES)
                    username = str(next_roll)
                    email = unique_email(f"{first.lower()}.{last.lower()}", "@student.myfantasia.com", existing_emails)
                    existing_usernames.add(username)

                    user = User.objects.create(
                        username=username, email=email, first_name=first, last_name=last,
                        password=hashed_password,
                    )

                    student = StudentExtra.objects.create(
                        user=user, roll=username, mobile=f"07{random.randint(10000000, 99999999)}",
                        address=f"{random.randint(1, 999)} {last} Estate",
                        fee=random.choice([15000, 20000, 25000, 30000]),
                        cl=stream, status=True, enrollment_state='Active',
                    )
                    student_group.user_set.add(user)
                    student.profile_pic.save(
                        f"{username}.png", make_avatar(f"{first[0]}{last[0]}", user.id), save=True
                    )
                    next_roll += 1
                    summary['students'] += 1

                    pending_family.append(student)
                    # Siblings: ~35% chance the next student shares this family instead of
                    # starting a fresh one, otherwise flush now (1-2 kids per parent).
                    if len(pending_family) >= 2 or random.random() > 0.35:
                        flush_family()
            flush_family()

            # --- TEACHERS: add extra headcount, prioritising thinly-covered subjects ---
            priority_subjects = list(Subject.objects.filter(name__in=PRIORITY_SUBJECTS))
            other_subjects = list(Subject.objects.exclude(name__in=PRIORITY_SUBJECTS))
            for i in range(extra_teachers):
                is_male = random.random() < 0.5
                first = random.choice(FIRST_NAMES_M if is_male else FIRST_NAMES_F)
                last = random.choice(LAST_NAMES)
                username = unique_username(f"{first.lower()}_{last.lower()}", existing_usernames)
                email = unique_email(f"{first.lower()}{last.lower()}", "@gmail.com", existing_emails)

                user = User.objects.create(
                    username=username, email=email, first_name=first, last_name=last,
                    password=hashed_password,
                )

                teacher = TeacherExtra.objects.create(
                    user=user, id_number=str(random.randint(20000000, 39999999)),
                    address=f"{random.randint(1, 999)} {last} Estate",
                    mobile=f"07{random.randint(10000000, 99999999)}",
                    status=True, salary=random.randint(35000, 75000),
                )
                if priority_subjects:
                    chosen = [priority_subjects.pop(random.randrange(len(priority_subjects)))]
                else:
                    chosen = []
                chosen += random.sample(other_subjects, k=min(2, len(other_subjects)))
                teacher.qualified_subjects.set(chosen)
                teacher.subjects = ", ".join(s.name for s in chosen)
                teacher.save(update_fields=['subjects'])
                teacher_group.user_set.add(user)
                teacher.profile_pic.save(
                    f"{username}.png", make_avatar(f"{first[0]}{last[0]}", user.id), save=True
                )
                summary['teachers'] += 1

            # --- TECH ELECTIVES: enroll every student (existing + new) into one tech
            # subject per grade's SubjectBlock, so the virtual-stream splitting engine has
            # real headcounts to work with. Balanced round-robin across each stream. ---
            if current_year:
                block_subjects_by_grade = {}
                for block in SubjectBlock.objects.filter(academic_year=current_year).prefetch_related('subjects'):
                    block_subjects_by_grade.setdefault(block.grade_level_id, list(block.subjects.all()))

                for stream in streams:
                    subjects = block_subjects_by_grade.get(stream.grade_id)
                    if not subjects:
                        continue
                    students = list(StudentExtra.objects.filter(cl=stream))
                    already = set(StudentSubjectEnrollment.objects.filter(
                        student__in=students, academic_year=current_year, subject__in=subjects,
                    ).values_list('student_id', flat=True))
                    idx = 0
                    for student in students:
                        if student.id in already:
                            continue
                        subject = subjects[idx % len(subjects)]
                        idx += 1
                        StudentSubjectEnrollment.objects.create(
                            student=student, academic_year=current_year, subject=subject,
                            status='Approved',
                        )
                        summary['enrollments'] += 1

            if dry_run:
                transaction.savepoint_rollback(sid)
                self.stdout.write(self.style.WARNING("DRY RUN — rolled back. Would have created:"))
            else:
                transaction.savepoint_commit(sid)
                self.stdout.write(self.style.SUCCESS("Committed. Created:"))

        for k, v in summary.items():
            self.stdout.write(f"  {k}: {v}")
        self.stdout.write(f"\nShared login password for all synthetic accounts: {TEST_PASSWORD}")
        self.stdout.write("Student usernames = their roll number. Teacher/parent usernames printed above pattern: firstname_lastname / firstnamelastname_parent.")
