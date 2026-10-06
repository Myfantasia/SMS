"""
ParentDashboardOverviewAPI must show a graduated child's status and destination the same way
StudentDashboardOverviewAPI already shows it to the student themselves -- this was the one
confirmed gap between the two (2026-09-22).
"""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, ClassStream, GradeLevel
from apps.identity.models import ParentExtra, StudentExtra
from apps.students.models import NationalExamRecord


class ParentDashboardGraduationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.grade = GradeLevel.objects.create(name='Grade 9 Parent Test', numeric_order=9)
        cls.stream = ClassStream.objects.create(name='Alpha', grade=cls.grade)
        cls.year = AcademicYear.objects.create(year='2107')

        parent_user = User.objects.create_user(username='pd_parent', password='x')
        cls.parent = ParentExtra.objects.create(user=parent_user, mobile='0700000000', status=True)

        active_user = User.objects.create_user(username='pd_active_child', password='x', first_name='Ann')
        cls.active_child = StudentExtra.objects.create(
            user=active_user, roll='PDAC1', cl=cls.stream, status=True, enrollment_state='Active')

        grad_user = User.objects.create_user(username='pd_grad_child', password='x', first_name='Ben')
        cls.grad_child = StudentExtra.objects.create(
            user=grad_user, roll='PDGC1', cl=cls.stream, status=True, enrollment_state='Graduated')
        NationalExamRecord.objects.create(
            student=cls.grad_child, exam_code='KJSEA', academic_year=cls.year, destination='Nyeri Boys High School')

        no_dest_user = User.objects.create_user(username='pd_grad_no_dest', password='x', first_name='Cam')
        cls.grad_child_no_destination = StudentExtra.objects.create(
            user=no_dest_user, roll='PDGC2', cl=cls.stream, status=True, enrollment_state='Graduated')

        cls.parent.students.add(cls.active_child, cls.grad_child, cls.grad_child_no_destination)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.parent.user)

    def _children_by_id(self):
        resp = self.client.get('/api/parent/dashboard-overview/')
        self.assertEqual(resp.status_code, 200, resp.data)
        return {c['id']: c for c in resp.data['data']['children']}

    def test_an_active_child_has_no_graduation_destination(self):
        child = self._children_by_id()[self.active_child.id]
        self.assertEqual(child['enrollment_state'], 'Active')
        self.assertIsNone(child['graduation_destination'])

    def test_a_graduated_child_shows_their_recorded_destination(self):
        child = self._children_by_id()[self.grad_child.id]
        self.assertEqual(child['enrollment_state'], 'Graduated')
        self.assertEqual(child['graduation_destination'], 'Nyeri Boys High School')

    def test_a_graduated_child_with_no_recorded_destination_is_null_not_missing(self):
        child = self._children_by_id()[self.grad_child_no_destination.id]
        self.assertEqual(child['enrollment_state'], 'Graduated')
        self.assertIsNone(child['graduation_destination'])

    def test_lookup_is_batched_not_one_query_per_child(self):
        # Regression guard for the N+1 shape: however many children this parent has, the
        # destination lookup must be a single extra query, not one per child.
        from django.db import connection, reset_queries
        from django.test import override_settings

        with override_settings(DEBUG=True):
            reset_queries()
            self.client.get('/api/parent/dashboard-overview/')
            nationalexam_queries = [q for q in connection.queries if 'nationalexamrecord' in q['sql'].lower()]
        self.assertEqual(len(nationalexam_queries), 1, nationalexam_queries)
