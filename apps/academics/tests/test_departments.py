from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from apps.academics.models import Curriculum, Department, Subject, SubjectCurriculumProfile, Tier
from apps.academics.services import list_departments


class ListDepartmentsServiceTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(name='CBC', code='CBC')
        self.other_curriculum = Curriculum.objects.create(name='8-4-4', code='844')
        self.junior = Tier.objects.create(curriculum=self.curriculum, name='Junior Secondary', code='JSS', display_order=1)
        self.senior = Tier.objects.create(curriculum=self.curriculum, name='Senior Secondary', code='SSS', display_order=2)

        self.sciences = Department.objects.create(name='Sciences', curriculum=self.curriculum)
        self.humanities = Department.objects.create(name='Humanities', curriculum=self.curriculum)
        self.technical = Department.objects.create(name='Technical', curriculum=self.curriculum)
        Department.objects.create(name='Retired Dept', curriculum=self.curriculum, is_active=False)
        Department.objects.create(name='Sciences', curriculum=self.other_curriculum)

        self.biology = Subject.objects.create(code='BIO', name='Biology', department=self.sciences)
        self.history = Subject.objects.create(code='HIS', name='History', department=self.humanities)
        self.pretech = Subject.objects.create(code='PTC', name='Pre-Technical Studies', department=self.technical)

        # Biology and Pre-Technical are explicitly profiled for Junior only. History has no
        # profile row at all, so it falls back to Subject.department everywhere (see
        # get_effective_department) and must stay visible in every tier.
        SubjectCurriculumProfile.objects.create(
            subject=self.biology, curriculum=self.curriculum, tier=self.junior, department=self.sciences,
        )
        SubjectCurriculumProfile.objects.create(
            subject=self.pretech, curriculum=self.curriculum, tier=self.junior, department=self.technical,
        )

    def test_returns_only_active_departments_for_the_curriculum(self):
        result = list_departments(curriculum_id=self.curriculum.id)
        names = {d.name for d in result}
        self.assertEqual(names, {'Sciences', 'Humanities', 'Technical'})

    def test_tier_scoping_includes_departments_profiled_for_that_tier(self):
        result = list_departments(curriculum_id=self.curriculum.id, tier_id=self.junior.id)
        names = {d.name for d in result}
        self.assertEqual(names, {'Sciences', 'Humanities', 'Technical'})

    def test_department_only_profiled_for_another_tier_is_excluded(self):
        result = list_departments(curriculum_id=self.curriculum.id, tier_id=self.senior.id)
        names = {d.name for d in result}
        self.assertEqual(names, {'Humanities'})


class ListDepartmentsEndpointTests(TestCase):
    def setUp(self):
        self.curriculum = Curriculum.objects.create(name='CBC', code='CBC')
        Department.objects.create(name='Sciences', curriculum=self.curriculum)
        self.user = User.objects.create_user(username='any_user', password='x')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_endpoint_returns_departments_for_curriculum(self):
        response = self.client.get(f'/api/academics/departments/?curriculum={self.curriculum.id}')
        self.assertEqual(response.status_code, 200)
        names = {d['name'] for d in response.data['departments']}
        self.assertEqual(names, {'Sciences'})

    def test_endpoint_requires_curriculum_param(self):
        response = self.client.get('/api/academics/departments/')
        self.assertEqual(response.status_code, 400)
