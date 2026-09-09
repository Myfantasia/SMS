from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from apps.academics.models import GradeLevel, ClassStream
from apps.identity.models import StudentExtra


def _valid_payload(**overrides):
    payload = {
        'first_name': 'Amina',
        'last_name': 'Otieno',
        'username': 'ADM-2026001',
        'password': 'pass12345',
        'password2': 'pass12345',
        'mobile': '0733000222',
        'address': 'Nairobi',
        'family_structure': 'guardian',
        'guardian_name': 'Aunt Mary',
        'guardian_mobile': '0799999999',
        'guardian_relationship': 'Aunt',
    }
    payload.update(overrides)
    return payload


class StudentSignupUniquenessTests(TestCase):
    """Covers the admission-number/username and auto-generated-email uniqueness
    guarantees on student signup."""

    @classmethod
    def setUpTestData(cls):
        cls.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        cls.stream = ClassStream.objects.create(name='North', grade=cls.grade)

    def test_successful_signup_creates_student(self):
        response = self.client.post(reverse('api_public_signup_student'), _valid_payload(cl=self.stream.id))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'success')
        user = User.objects.get(username='ADM-2026001')
        self.assertEqual(user.email, 'amina.otieno@student.myfantasia.com')

    def test_duplicate_admission_number_rejected_with_friendly_message(self):
        self.client.post(reverse('api_public_signup_student'), _valid_payload(cl=self.stream.id))
        response = self.client.post(reverse('api_public_signup_student'), _valid_payload(cl=self.stream.id))
        self.assertEqual(User.objects.filter(username='ADM-2026001').count(), 1)
        field_errors = response.json()['field_errors']
        self.assertIn('username', field_errors)
        self.assertIn('already registered', str(field_errors['username']))

    def test_same_name_students_get_distinct_emails(self):
        self.client.post(reverse('api_public_signup_student'), _valid_payload(username='ADM-1', cl=self.stream.id))
        self.client.post(reverse('api_public_signup_student'), _valid_payload(username='ADM-2', cl=self.stream.id))
        emails = set(User.objects.filter(username__in=['ADM-1', 'ADM-2']).values_list('email', flat=True))
        self.assertEqual(emails, {'amina.otieno@student.myfantasia.com', 'amina.otieno1@student.myfantasia.com'})

    def test_email_local_part_strips_special_characters(self):
        self.client.post(reverse('api_public_signup_student'), _valid_payload(
            username='ADM-3', first_name="Anne-Marie", last_name="O'Brien", cl=self.stream.id,
        ))
        user = User.objects.get(username='ADM-3')
        self.assertEqual(user.email, 'annemarie.obrien@student.myfantasia.com')


class StudentSignupFamilyStructureTests(TestCase):
    """Covers the Both Parents / Single Parent / Guardian dropdown and its conditional
    validation + derived parent_name/parent_mobile summary."""

    @classmethod
    def setUpTestData(cls):
        cls.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        cls.stream = ClassStream.objects.create(name='North', grade=cls.grade)

    def test_both_parents_requires_all_four_fields(self):
        response = self.client.post(reverse('api_public_signup_student'), _valid_payload(
            cl=self.stream.id, family_structure='both', guardian_name='', guardian_mobile='', guardian_relationship='',
        ))
        self.assertFalse(User.objects.filter(username='ADM-2026001').exists())
        errors = response.json()['field_errors']
        for field in ('father_name', 'father_mobile', 'mother_name', 'mother_mobile'):
            self.assertIn(field, errors)

    def test_both_parents_success_derives_summary(self):
        self.client.post(reverse('api_public_signup_student'), _valid_payload(
            cl=self.stream.id, family_structure='both', guardian_name='', guardian_mobile='', guardian_relationship='',
            father_name='John Doe', father_mobile='0711111111',
            mother_name='Jane Doe', mother_mobile='0722222222',
        ))
        student = StudentExtra.objects.get(roll='ADM-2026001')
        self.assertEqual(student.parent_name, 'John Doe (Father), Jane Doe (Mother)')
        self.assertEqual(student.parent_mobile, '0711111111')

    def test_single_parent_without_type_rejected(self):
        response = self.client.post(reverse('api_public_signup_student'), _valid_payload(
            cl=self.stream.id, family_structure='single', guardian_name='', guardian_mobile='', guardian_relationship='',
        ))
        self.assertFalse(User.objects.filter(username='ADM-2026001').exists())
        self.assertIn('single_parent_type', response.json()['field_errors'])

    def test_single_mother_success_derives_summary(self):
        self.client.post(reverse('api_public_signup_student'), _valid_payload(
            cl=self.stream.id, family_structure='single', single_parent_type='Mother',
            guardian_name='', guardian_mobile='', guardian_relationship='',
            mother_name='Solo Mum', mother_mobile='0700000000',
        ))
        student = StudentExtra.objects.get(roll='ADM-2026001')
        self.assertEqual(student.parent_name, 'Solo Mum (Mother)')
        self.assertEqual(student.parent_mobile, '0700000000')

    def test_guardian_requires_name_and_mobile(self):
        response = self.client.post(reverse('api_public_signup_student'), _valid_payload(
            cl=self.stream.id, family_structure='guardian', guardian_name='', guardian_mobile='',
        ))
        self.assertFalse(User.objects.filter(username='ADM-2026001').exists())
        errors = response.json()['field_errors']
        self.assertIn('guardian_name', errors)
        self.assertIn('guardian_mobile', errors)

    def test_guardian_success_derives_summary_with_relationship_label(self):
        self.client.post(reverse('api_public_signup_student'), _valid_payload(cl=self.stream.id))
        student = StudentExtra.objects.get(roll='ADM-2026001')
        self.assertEqual(student.parent_name, 'Aunt Mary (Aunt)')
        self.assertEqual(student.parent_mobile, '0799999999')
