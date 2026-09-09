from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from apps.identity.models import TeacherExtra, StaffExtra


def _teacher_payload(**overrides):
    payload = {
        'first_name': 'Peter',
        'last_name': 'Kamau',
        'username': 'p_kamau',
        'email': 'peter.kamau@example.com',
        'password': 'pass12345',
        'password2': 'pass12345',
        'id_number': '12345678',
        'mobile': '0711000000',
        'address': 'Nairobi',
    }
    payload.update(overrides)
    return payload


def _staff_payload(**overrides):
    payload = {
        'first_name': 'Susan',
        'last_name': 'Njeri',
        'username': 's_njeri',
        'email': 'susan.njeri@example.com',
        'password': 'pass12345',
        'password2': 'pass12345',
        'job_title': 'Librarian',
        'id_number': '87654321',
        'mobile': '0722000000',
        'address': 'Nairobi',
    }
    payload.update(overrides)
    return payload


class TeacherSignupTests(TestCase):
    """Covers username/email uniqueness and password confirmation on teacher signup —
    this view builds the User directly with create_user() (no ModelForm), so these checks
    have to be enforced by hand rather than relying on automatic form validation."""

    def test_successful_signup_creates_teacher(self):
        response = self.client.post(reverse('api_public_signup_teacher'), _teacher_payload())
        self.assertTrue(User.objects.filter(username='p_kamau').exists())
        self.assertTrue(TeacherExtra.objects.filter(user__username='p_kamau').exists())

    def test_duplicate_username_rejected(self):
        self.client.post(reverse('api_public_signup_teacher'), _teacher_payload())
        self.client.post(reverse('api_public_signup_teacher'), _teacher_payload(email='other@example.com'))
        self.assertEqual(User.objects.filter(username='p_kamau').count(), 1)

    def test_duplicate_email_rejected(self):
        self.client.post(reverse('api_public_signup_teacher'), _teacher_payload())
        self.client.post(reverse('api_public_signup_teacher'), _teacher_payload(username='p_kamau2'))
        self.assertFalse(User.objects.filter(username='p_kamau2').exists())

    def test_password_mismatch_rejected(self):
        response = self.client.post(reverse('api_public_signup_teacher'), _teacher_payload(password2='different'))
        self.assertFalse(User.objects.filter(username='p_kamau').exists())

    def test_short_password_rejected(self):
        response = self.client.post(reverse('api_public_signup_teacher'), _teacher_payload(password='abc', password2='abc'))
        self.assertFalse(User.objects.filter(username='p_kamau').exists())


class StaffSignupTests(TestCase):
    """Same checks as TeacherSignupTests — staff signup shares the identical raw-POST
    create_user() pattern."""

    def test_successful_signup_creates_staff(self):
        self.client.post(reverse('api_public_signup_staff'), _staff_payload())
        self.assertTrue(User.objects.filter(username='s_njeri').exists())
        self.assertTrue(StaffExtra.objects.filter(user__username='s_njeri').exists())

    def test_duplicate_username_rejected(self):
        self.client.post(reverse('api_public_signup_staff'), _staff_payload())
        self.client.post(reverse('api_public_signup_staff'), _staff_payload(email='other@example.com'))
        self.assertEqual(User.objects.filter(username='s_njeri').count(), 1)

    def test_duplicate_email_rejected(self):
        self.client.post(reverse('api_public_signup_staff'), _staff_payload())
        self.client.post(reverse('api_public_signup_staff'), _staff_payload(username='s_njeri2'))
        self.assertFalse(User.objects.filter(username='s_njeri2').exists())

    def test_password_mismatch_rejected(self):
        self.client.post(reverse('api_public_signup_staff'), _staff_payload(password2='different'))
        self.assertFalse(User.objects.filter(username='s_njeri').exists())

    def test_short_password_rejected(self):
        self.client.post(reverse('api_public_signup_staff'), _staff_payload(password='abc', password2='abc'))
        self.assertFalse(User.objects.filter(username='s_njeri').exists())
