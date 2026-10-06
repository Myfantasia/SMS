import csv

from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand

from apps.identity.models import StaffExtra
from apps.identity.models import Permission, Role, UserRole

DEMO_PASSWORD = 'CHANGE_ME_DEMO_PASSWORD'
CSV_PATH = '/tmp/staff_demo_credentials.csv'

# Non-system roles: admins can freely rename, edit, or delete these from the
# Roles & Permissions page — they exist only to give the RBAC UI real data to show.
#
# rank places each role in the same hierarchy as the system roles (Admin=1, Teacher=5,
# seed_rbac.py) so validate_rank_authority (school/rbac.py) actually lets a non-superuser
# Admin manage them — previously all 16 had rank=None, which that guard treats as
# "unmanageable except by a superuser." Tiers, anchored on the fixed Admin/Teacher ranks:
#   2: senior leadership (Deputy Principal)
#   3: senior coordinators/officers with cross-cutting authority (HOD, Exam Officer,
#      Timetable Coordinator, HR Officer, IT & Compliance Officer)
#   6: administrative staff, narrower scope (Finance Officer, Registrar, Secretary)
#   7: clerical/limited-scope support roles (the rest) — Librarian/Transport Coordinator
#      are provisional here until their minimal modules exist and give them real permissions
ROLES = [
    ('Secretary', 'Front-office administrative support', ['classes.view', 'attendance.view', 'notices.edit', 'events.edit'], 6),
    ('Finance Officer', 'Fees, salaries, and financial oversight', ['finance.view', 'finance.edit', 'finance.record_payment', 'finance.void', 'finance.approve_adjustment', 'finance.override_clearance'], 6),
    ('Registrar', 'Manages student enrollment, transfers, and status', ['classes.view', 'classes.enrollment'], 6),
    ('HR Officer', 'Approves staff leave requests', ['leave.view', 'leave.approve'], 3),
    ('Marks Entry Clerk', 'Enters exam marks only — cannot change exam terms, events, or grading rules', ['exams.view', 'exams.marks'], 7),
    ('Timetable Coordinator', 'Builds and maintains the school timetable', ['timetable.view', 'timetable.edit'], 3),
    ('IT & Compliance Officer', 'System oversight: chat compliance audit and school-wide audit log', ['chat.manage', 'audit.view'], 3),
    ('Librarian', 'Manages library resources', [], 7),
    ('Exam Officer', 'Coordinates exam scheduling and results processing', ['exams.view', 'exams.edit', 'results.view', 'results.edit'], 3),
    ('Deputy Principal', 'Senior leadership with broad academic oversight', ['classes.view', 'classes.edit', 'attendance.view', 'attendance.edit', 'results.view', 'results.edit', 'exams.view', 'exams.edit', 'timetable.view'], 2),
    ('Head of Department', 'Departmental academic oversight', ['results.view', 'exams.view', 'timetable.view'], 3),
    ('Chat Moderator', 'Sends school-wide broadcast messages only — no audit log or parent cohort access', ['chat.broadcast'], 7),
    ('School Nurse', 'Monitors student health and wellbeing', ['attendance.view'], 7),
    ('Counselor', 'Supports student wellbeing and academic progress', ['attendance.view', 'results.view'], 7),
    ('Transport Coordinator', 'Manages school transport logistics', [], 7),
    ('Receptionist', 'Front-desk visitor and enquiry management', ['classes.view'], 7),
]

# (username, first_name, last_name, email, job_title, id_number, mobile, address, role_names)
# role_names is a list — an individual can hold more than one Role at once (per-person
# assignment, not per-account-type), see deborah.deputy below for a stacked example.
STAFF = [
    ('jane.secretary', 'Jane', 'Wambui', 'jane.secretary@myfantasia.demo', 'Front Office Secretary', '30112233', '0712345601', 'Nairobi, Kenya', ['Secretary']),
    ('peter.finance', 'Peter', 'Otieno', 'peter.finance@myfantasia.demo', 'Finance Officer', '30112234', '0712345602', 'Nairobi, Kenya', ['Finance Officer']),
    ('grace.registrar', 'Grace', 'Achieng', 'grace.registrar@myfantasia.demo', 'Registrar', '30112235', '0712345603', 'Nairobi, Kenya', ['Registrar']),
    ('samuel.hr', 'Samuel', 'Kiptoo', 'samuel.hr@myfantasia.demo', 'HR Officer', '30112236', '0712345604', 'Nairobi, Kenya', ['HR Officer']),
    ('linet.marks', 'Linet', 'Mueni', 'linet.marks@myfantasia.demo', 'Marks Entry Clerk', '30112237', '0712345605', 'Nairobi, Kenya', ['Marks Entry Clerk']),
    ('brian.timetable', 'Brian', 'Kimani', 'brian.timetable@myfantasia.demo', 'Timetable Coordinator', '30112238', '0712345606', 'Nairobi, Kenya', ['Timetable Coordinator']),
    ('faith.it', 'Faith', 'Njeri', 'faith.it@myfantasia.demo', 'IT & Compliance Officer', '30112239', '0712345607', 'Nairobi, Kenya', ['IT & Compliance Officer']),
    ('daniel.library', 'Daniel', 'Mutiso', 'daniel.library@myfantasia.demo', 'Librarian', '30112240', '0712345608', 'Nairobi, Kenya', ['Librarian']),
    ('esther.exams', 'Esther', 'Wanjiru', 'esther.exams@myfantasia.demo', 'Exam Officer', '30112241', '0712345609', 'Nairobi, Kenya', ['Exam Officer']),
    ('deborah.deputy', 'Deborah', 'Chebet', 'deborah.deputy@myfantasia.demo', 'Deputy Principal', '30112242', '0712345610', 'Nairobi, Kenya', ['Deputy Principal', 'Timetable Coordinator']),
    ('michael.hod', 'Michael', 'Omondi', 'michael.hod@myfantasia.demo', 'Head of Department', '30112243', '0712345611', 'Nairobi, Kenya', ['Head of Department']),
    ('agnes.chat', 'Agnes', 'Nyambura', 'agnes.chat@myfantasia.demo', 'Chat Moderator', '30112244', '0712345612', 'Nairobi, Kenya', ['Chat Moderator']),
    ('john.nurse', 'John', 'Mwangi', 'john.nurse@myfantasia.demo', 'School Nurse', '30112245', '0712345613', 'Nairobi, Kenya', ['School Nurse']),
    ('mercy.counselor', 'Mercy', 'Adhiambo', 'mercy.counselor@myfantasia.demo', 'Counselor', '30112246', '0712345614', 'Nairobi, Kenya', ['Counselor']),
    ('victor.transport', 'Victor', 'Barasa', 'victor.transport@myfantasia.demo', 'Transport Coordinator', '30112247', '0712345615', 'Nairobi, Kenya', ['Transport Coordinator']),
    ('lucy.reception', 'Lucy', 'Wairimu', 'lucy.reception@myfantasia.demo', 'Receptionist', '30112248', '0712345616', 'Nairobi, Kenya', ['Receptionist']),
]


class Command(BaseCommand):
    """
    Populates the system with test Roles and approved, role-assigned Staff
    accounts for development/testing, and writes their login credentials to a
    CSV file.

    Safe to re-run — everything is get_or_create'd; existing users keep their password.

        python manage.py populate_demo_staff
    """
    help = "Create test Roles and pre-approved Staff accounts for RBAC testing, export credentials to CSV."

    def handle(self, *args, **options):
        self.stdout.write('Roles:')
        roles_by_name = {}
        for name, description, codes, rank in ROLES:
            role, created = Role.objects.get_or_create(name=name, defaults={'description': description, 'rank': rank})
            changed_fields = []
            if not created and role.description != description:
                role.description = description
                changed_fields.append('description')
            if not created and role.rank != rank:
                role.rank = rank
                changed_fields.append('rank')
            if changed_fields:
                role.save(update_fields=changed_fields)
            perms = list(Permission.objects.filter(code__in=codes))
            role.permissions.set(perms)
            roles_by_name[name] = role
            self.stdout.write(f"  {'created' if created else 'updated'}: {name} (rank={role.rank}) -> {codes or '(no permissions yet)'}")

        staff_group, _ = Group.objects.get_or_create(name='STAFF')

        self.stdout.write('\nStaff accounts:')
        rows = []
        codes_by_role = {name: codes for name, _desc, codes, _rank in ROLES}
        for username, first_name, last_name, email, job_title, id_number, mobile, address, role_names in STAFF:
            user, user_created = User.objects.get_or_create(
                username=username,
                defaults={'email': email, 'first_name': first_name, 'last_name': last_name},
            )
            if user_created:
                user.set_password(DEMO_PASSWORD)
                user.save()
            staff_group.user_set.add(user)

            StaffExtra.objects.update_or_create(
                user=user,
                defaults={'job_title': job_title, 'id_number': id_number, 'mobile': mobile, 'address': address, 'status': True},
            )

            all_codes = set()
            for role_name in role_names:
                role = roles_by_name.get(role_name)
                if role:
                    UserRole.objects.get_or_create(user=user, role=role)
                    all_codes.update(codes_by_role.get(role_name, []))

            rows.append({
                'username': username, 'first_name': first_name, 'last_name': last_name,
                'email': email, 'password': DEMO_PASSWORD, 'job_title': job_title,
                'role': ' + '.join(role_names), 'permissions': ', '.join(sorted(all_codes)) or '(none — login only)',
            })

            self.stdout.write(f"  {'created' if user_created else 'exists'}: {username} ({email}) -> {job_title} / roles: {role_names}")

        with open(CSV_PATH, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=['username', 'first_name', 'last_name', 'email', 'password', 'job_title', 'role', 'permissions'])
            writer.writeheader()
            writer.writerows(rows)

        self.stdout.write(self.style.SUCCESS(
            f"\nDone. {len(STAFF)} staff accounts, all pre-approved. Credentials written to {CSV_PATH}",
        ))
