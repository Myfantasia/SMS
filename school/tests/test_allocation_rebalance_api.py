from datetime import date

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ClassStream, ExamTerm, GradeLevel, Subject
from apps.allocations.models import AllocationPublishState, SubjectAllocation
from apps.identity.models import Permission, TeacherExtra


class AllocationRebalanceApiTests(TestCase):
    def setUp(self):
        self.year = AcademicYear.objects.create(year='2026', is_active=True)
        self.term = ExamTerm.objects.create(
            name='Term 1', academic_year=self.year,
            start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True,
        )
        self.grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        self.stream = ClassStream.objects.create(name='North', grade=self.grade)
        self.maths = Subject.objects.create(code='MAT101', name='Mathematics', is_core=True)
        self.english = Subject.objects.create(code='ENG101', name='English', is_core=True)
        self.kiswahili = Subject.objects.create(code='KIS101', name='Kiswahili', is_core=True)
        teacher_user = User.objects.create_user(username='rb_teacher', password='x')
        self.teacher = TeacherExtra.objects.create(user=teacher_user, mobile='0700000000', status=True)
        spare_user = User.objects.create_user(username='rb_spare', password='x')
        self.spare = TeacherExtra.objects.create(user=spare_user, mobile='0711111111', status=True)
        for subject in (self.maths, self.english, self.kiswahili):
            self.teacher.qualified_subjects.add(subject)
            self.spare.qualified_subjects.add(subject)  # spare must be qualified to take over any blocked subject
        for subject in (self.maths, self.english, self.kiswahili):
            SubjectAllocation.objects.create(
                classroom=self.stream, subject=subject, teacher=self.teacher,
                academic_year=self.year, term=self.term, is_active=True,
            )

        for code in ('allocations.view', 'allocations.edit'):
            Permission.objects.get_or_create(code=code, defaults={'label': code, 'module': 'allocations'})
        self.admin = User.objects.create_user(username='rb_admin', password='x', is_superuser=True, is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def body(self, **extra):
        data = {'term_id': self.term.id, 'year_id': self.year.id, 'class_id': self.stream.id,
                'grade_id': self.grade.id, 'scope': 'class'}
        data.update(extra)
        return data

    def propose(self):
        return self.client.post('/api/allocations/rebalance/propose/', self.body(), format='json')

    def test_propose_returns_moves_and_a_fingerprint(self):
        response = self.propose()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['fingerprint'])
        self.assertTrue(len(response.data['moves']) >= 1)
        self.assertTrue(response.data['moves'][0]['reason'])

    def test_confirm_with_the_proposed_fingerprint_applies_the_moves(self):
        fingerprint = self.propose().data['fingerprint']
        response = self.client.post(
            '/api/allocations/rebalance/confirm/',
            self.body(proposal_fingerprint=fingerprint), format='json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['moves_applied'] >= 1)

    def test_confirm_after_the_draft_changed_is_a_409(self):
        fingerprint = self.propose().data['fingerprint']
        SubjectAllocation.objects.filter(classroom=self.stream, subject=self.kiswahili).update(teacher=self.spare)
        response = self.client.post(
            '/api/allocations/rebalance/confirm/',
            self.body(proposal_fingerprint=fingerprint), format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'STALE_PROPOSAL')

    def test_confirm_without_a_fingerprint_is_a_400(self):
        response = self.client.post('/api/allocations/rebalance/confirm/', self.body(), format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['error'], 'proposal_fingerprint is required.')

    def publish_class(self):
        AllocationPublishState.objects.update_or_create(
            classroom=self.stream, term=self.term, academic_year=self.year,
            defaults={'is_published': True},
        )

    def test_propose_on_a_published_class_is_a_409_published_scope(self):
        self.publish_class()
        response = self.propose()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'PUBLISHED_SCOPE')

    def test_confirm_on_a_published_class_is_a_409_and_leaves_the_draft_unchanged(self):
        fingerprint = self.propose().data['fingerprint']
        self.publish_class()  # publish lands between propose and confirm
        before = list(SubjectAllocation.objects.filter(classroom=self.stream).values_list('subject_id', 'teacher_id'))
        response = self.client.post(
            '/api/allocations/rebalance/confirm/',
            self.body(proposal_fingerprint=fingerprint), format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'PUBLISHED_SCOPE')
        after = list(SubjectAllocation.objects.filter(classroom=self.stream).values_list('subject_id', 'teacher_id'))
        self.assertEqual(before, after)

    def test_a_user_without_the_edit_permission_is_refused(self):
        plain = User.objects.create_user(username='rb_plain', password='x')
        client = APIClient()
        client.force_authenticate(user=plain)
        self.assertEqual(client.post('/api/allocations/rebalance/propose/', self.body(), format='json').status_code, 403)
        self.assertEqual(client.post('/api/allocations/rebalance/confirm/', self.body(proposal_fingerprint='x'), format='json').status_code, 403)
