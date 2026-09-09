"""Focused coverage for school/views/public_api_views.py -- one happy-path and one
validation-error case per endpoint, mirroring the existing test_admin_signup.py style.
Not a full re-test of the underlying business logic (that logic is reused verbatim from
the pre-existing template-rendering views, which already have their own coverage where
it exists) -- this file exists to catch transport-layer regressions (wrong status code,
wrong JSON shape, wrong redirect target) in the new JSON wrapper layer itself.
"""
from django.contrib.auth.models import Group, User
from django.core import mail
from django.test import TestCase
from django.urls import reverse

from apps.academics.models import ClassStream, GradeLevel, Subject
from apps.identity.models import AdminExtra, ParentExtra, Role, StaffExtra, StudentExtra, TeacherExtra


class PublicApiBaseTests(TestCase):
    def test_csrf_endpoint_sets_cookie(self):
        response = self.client.get(reverse('api_public_csrf'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'ok')
        self.assertIn('csrftoken', response.cookies)

    def test_home_returns_recent_events(self):
        response = self.client.get(reverse('api_public_home'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'success')
        self.assertIn('recent_events', response.json())

    def test_system_status_reports_database_operational(self):
        response = self.client.get(reverse('api_public_system_status'))
        data = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(data['all_operational'])
        db_service = next(s for s in data['services'] if s['name'] == 'Database')
        self.assertTrue(db_service['operational'])

    def test_afterlogin_requires_authentication(self):
        response = self.client.get(reverse('api_public_afterlogin'))
        self.assertEqual(response.status_code, 401)

    def test_afterlogin_routes_admin_to_dashboard(self):
        user = User.objects.create_user(username='an_admin', password='x')
        Group.objects.get_or_create(name='ADMIN')[0].user_set.add(user)
        AdminExtra.objects.create(user=user, status=True)
        self.client.force_login(user)
        response = self.client.get(reverse('api_public_afterlogin'))
        data = response.json()
        self.assertEqual(data['destination'], 'dashboard')
        self.assertEqual(data['path'], '/admin-dashboard')

    def test_contact_valid_submission_sends_mail(self):
        response = self.client.post(reverse('api_public_contact'), {
            'Name': 'A Visitor', 'Email': 'visitor@example.com', 'Message': 'Hello there',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'success')
        self.assertEqual(len(mail.outbox), 1)

    def test_contact_invalid_submission_returns_field_errors(self):
        response = self.client.post(reverse('api_public_contact'), {
            'Name': '', 'Email': 'not-an-email', 'Message': '',
        })
        data = response.json()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(data['status'], 'error')
        self.assertIn('Email', data['field_errors'])


class AdminSignupApiTests(TestCase):
    def test_bootstrap_admin_gets_immediate_access(self):
        response = self.client.post(reverse('api_public_signup_admin'), {
            'first_name': 'Ada', 'last_name': 'Admin', 'username': 'ada_admin',
            'email': 'ada@example.com', 'mobile': '+254712345678', 'address': '123 Main St',
            'password': 'correct-horse-battery', 'password2': 'correct-horse-battery',
            'invite_code': '',
        })
        data = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(data['is_bootstrap'])
        user = User.objects.get(username='ada_admin')
        self.assertTrue(user.groups.filter(name='ADMIN').exists())
        self.assertTrue(AdminExtra.objects.get(user=user).status)

    def test_password_mismatch_returns_field_error(self):
        response = self.client.post(reverse('api_public_signup_admin'), {
            'first_name': 'Ada', 'last_name': 'Admin', 'username': 'ada_admin2',
            'email': 'ada2@example.com', 'mobile': '+254712345678', 'address': '123 Main St',
            'password': 'correct-horse-battery', 'password2': 'does-not-match',
            'invite_code': '',
        })
        data = response.json()
        self.assertEqual(response.status_code, 400)
        self.assertIn('password2', data['field_errors'])


class StudentSignupApiTests(TestCase):
    def setUp(self):
        grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        self.stream = ClassStream.objects.create(name='North', grade=grade)

    def test_valid_signup_auto_generates_school_email(self):
        response = self.client.post(reverse('api_public_signup_student'), {
            'first_name': 'Beatrice', 'last_name': 'Otieno', 'username': 'BO001',
            'password': 'correct-horse-battery', 'password2': 'correct-horse-battery',
            'cl': self.stream.id, 'address': '456 Side St',
            'family_structure': 'guardian', 'guardian_name': 'Aunt Jane', 'guardian_mobile': '0700000000',
        })
        data = response.json()
        self.assertEqual(response.status_code, 200, data)
        user = User.objects.get(username='BO001')
        self.assertTrue(user.email.endswith('@student.myfantasia.com'))
        self.assertFalse(StudentExtra.objects.get(user=user).status)

    def test_guardian_structure_without_guardian_name_fails(self):
        response = self.client.post(reverse('api_public_signup_student'), {
            'first_name': 'Beatrice', 'last_name': 'Otieno', 'username': 'BO002',
            'password': 'correct-horse-battery', 'password2': 'correct-horse-battery',
            'cl': self.stream.id, 'address': '456 Side St',
            'family_structure': 'guardian',
        })
        data = response.json()
        self.assertEqual(response.status_code, 400)
        self.assertIn('guardian_name', data['field_errors'])


class TeacherSignupApiTests(TestCase):
    def setUp(self):
        self.subject = Subject.objects.create(code='MAT101', name='Mathematics')

    def test_subjects_list_endpoint(self):
        response = self.client.get(reverse('api_public_teacher_signup_subjects'))
        data = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(any(s['name'] == 'Mathematics' for s in data['subjects']))

    def test_valid_signup_auto_logs_in_and_returns_wait_for_approval(self):
        response = self.client.post(reverse('api_public_signup_teacher'), {
            'first_name': 'Tom', 'last_name': 'Teacher', 'username': 'tom_t',
            'email': 'tom@example.com', 'password': 'correct-horse-battery', 'password2': 'correct-horse-battery',
            'id_number': '12345678', 'mobile': '0711111111', 'address': '1 Teacher Way',
            'subjects': [self.subject.name],
        })
        data = response.json()
        self.assertEqual(response.status_code, 200, data)
        self.assertEqual(data['destination'], 'wait-for-approval')
        self.assertEqual(data['role'], 'teacher')
        user = User.objects.get(username='tom_t')
        self.assertFalse(TeacherExtra.objects.get(user=user).status)

    def test_duplicate_username_returns_error(self):
        User.objects.create_user(username='taken_name', password='x')
        response = self.client.post(reverse('api_public_signup_teacher'), {
            'first_name': 'Tom', 'last_name': 'Teacher', 'username': 'taken_name',
            'email': 'tom2@example.com', 'password': 'correct-horse-battery', 'password2': 'correct-horse-battery',
            'id_number': '12345678', 'mobile': '0711111111', 'address': '1 Teacher Way',
        })
        data = response.json()
        self.assertEqual(response.status_code, 400)
        self.assertIn('already taken', data['message'])


class StaffSignupApiTests(TestCase):
    def setUp(self):
        self.role = Role.objects.create(name='Librarian', is_system_role=False)

    def test_roles_list_endpoint(self):
        response = self.client.get(reverse('api_public_staff_signup_roles'))
        data = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(any(r['name'] == 'Librarian' for r in data['roles']))

    def test_valid_signup(self):
        response = self.client.post(reverse('api_public_signup_staff'), {
            'first_name': 'Sam', 'last_name': 'Staff', 'username': 'sam_s',
            'email': 'sam@example.com', 'password': 'correct-horse-battery', 'password2': 'correct-horse-battery',
            'job_title': 'Librarian', 'id_number': '87654321', 'mobile': '0722222222',
            'address': '2 Staff Rd', 'role_id': self.role.id,
        })
        data = response.json()
        self.assertEqual(response.status_code, 200, data)
        self.assertEqual(data['destination'], 'wait-for-approval')
        self.assertEqual(StaffExtra.objects.get(user__username='sam_s').requested_role_id, self.role.id)


class ParentSignupApiTests(TestCase):
    def setUp(self):
        grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        stream = ClassStream.objects.create(name='North', grade=grade)
        child_user = User.objects.create_user(username='child1', password='x')
        self.child = StudentExtra.objects.create(user=child_user, roll='C001', cl=stream, status=True)

    def test_valid_signup_links_child_and_auto_logs_in(self):
        response = self.client.post(reverse('api_public_signup_parent'), {
            'first_name': 'Pat', 'last_name': 'Parent', 'username': 'pat_p', 'email': 'pat@example.com',
            'password': 'correct-horse-battery', 'password2': 'correct-horse-battery',
            'mobile': '0733333333', 'relationship': 'Mother',
            'selected_student_ids': str(self.child.id),
        })
        data = response.json()
        self.assertEqual(response.status_code, 200, data)
        parent_extra = ParentExtra.objects.get(user__username='pat_p')
        self.assertIn(self.child, parent_extra.students.all())

    def test_missing_selected_students_returns_error(self):
        response = self.client.post(reverse('api_public_signup_parent'), {
            'first_name': 'Pat', 'last_name': 'Parent', 'username': 'pat_p2', 'email': 'pat2@example.com',
            'password': 'correct-horse-battery', 'password2': 'correct-horse-battery',
            'mobile': '0733333333', 'relationship': 'Mother',
            'selected_student_ids': '',
        })
        data = response.json()
        self.assertEqual(response.status_code, 400)
        self.assertIn('selected_student_ids', data['field_errors'])


class LoginApiTests(TestCase):
    def test_admin_login_success(self):
        user = User.objects.create_user(
            username='an_admin', password='correct-horse-battery', email='an_admin@example.com')
        Group.objects.get_or_create(name='ADMIN')[0].user_set.add(user)
        AdminExtra.objects.create(user=user, status=True)
        response = self.client.post(reverse('api_public_login_admin'), {
            'email': 'an_admin@example.com', 'password': 'correct-horse-battery',
        })
        data = response.json()
        self.assertEqual(data['status'], 'success')
        self.assertEqual(data['destination'], 'dashboard')

    def test_admin_login_wrong_password_fails(self):
        user = User.objects.create_user(username='an_admin2', password='correct-horse-battery', email='a2@example.com')
        Group.objects.get_or_create(name='ADMIN')[0].user_set.add(user)
        AdminExtra.objects.create(user=user, status=True)
        response = self.client.post(reverse('api_public_login_admin'), {
            'email': 'a2@example.com', 'password': 'wrong-password',
        })
        data = response.json()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(data['status'], 'error')

    def test_student_login_success(self):
        grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        stream = ClassStream.objects.create(name='North', grade=grade)
        user = User.objects.create_user(username='S001', password='correct-horse-battery')
        Group.objects.get_or_create(name='STUDENT')[0].user_set.add(user)
        StudentExtra.objects.create(user=user, roll='S001', cl=stream, status=True)
        response = self.client.post(reverse('api_public_login_student'), {
            'username': 'S001', 'password': 'correct-horse-battery',
        })
        data = response.json()
        self.assertEqual(data['status'], 'success')
        self.assertEqual(data['destination'], 'dashboard')
        self.assertEqual(data['path'], '/student-dashboard')

    def test_staff_login_no_account_returns_error(self):
        response = self.client.post(reverse('api_public_login_staff'), {
            'email': 'nobody@example.com', 'password': 'whatever',
        })
        data = response.json()
        self.assertEqual(response.status_code, 400)
        self.assertIn('No account found', data['message'])


class PasswordResetApiTests(TestCase):
    def test_request_for_unknown_email_still_returns_success(self):
        response = self.client.post(reverse('api_public_password_reset_request'), {
            'email': 'nobody@example.com',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'success')
        self.assertEqual(len(mail.outbox), 0)

    def test_request_for_known_email_sends_mail_with_frontend_link(self):
        User.objects.create_user(username='resetme', password='x', email='resetme@example.com')
        response = self.client.post(reverse('api_public_password_reset_request'), {
            'email': 'resetme@example.com',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('http://localhost:5173/password-reset-confirm/', mail.outbox[0].body)

    def test_confirm_flow_with_valid_token(self):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode

        user = User.objects.create_user(username='resetme2', password='old-password', email='r2@example.com')
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)

        check = self.client.get(reverse('api_public_password_reset_confirm', args=[uid, token]))
        self.assertTrue(check.json()['valid'])

        submit = self.client.post(reverse('api_public_password_reset_confirm', args=[uid, token]), {
            'new_password1': 'brand-new-password-9', 'new_password2': 'brand-new-password-9',
        })
        self.assertEqual(submit.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.check_password('brand-new-password-9'))

    def test_confirm_flow_with_invalid_token(self):
        user = User.objects.create_user(username='resetme3', password='x', email='r3@example.com')
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode
        uid = urlsafe_base64_encode(force_bytes(user.pk))

        check = self.client.get(reverse('api_public_password_reset_confirm', args=[uid, 'bad-token']))
        self.assertFalse(check.json()['valid'])
