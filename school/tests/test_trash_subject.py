import json
from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import Subject
from apps.identity.models import Permission


class SubjectTrashTests(TestCase):
    def setUp(self):
        # Ensure the curriculum.edit permission exists for the endpoint
        Permission.objects.get_or_create(code='curriculum.edit', defaults={'label': 'curriculum.edit', 'module': 'curriculum'})
        self.operator = User.objects.create_user(username='admin2', password='x')
        self.subject = Subject.objects.create(code='MAT101', name='Mathematics')

    def test_soft_delete_hides_from_live_manager(self):
        self.assertIn(self.subject, Subject.live.all())
        self.subject.soft_delete(operator_user=self.operator)
        self.assertNotIn(self.subject, Subject.live.all())
        self.assertIn(self.subject, Subject.objects.all())

    def test_restore_brings_it_back(self):
        self.subject.soft_delete(operator_user=self.operator)
        self.subject.restore(operator_user=self.operator)
        self.subject.refresh_from_db()
        self.assertFalse(self.subject.is_deleted)
        self.assertIn(self.subject, Subject.live.all())

    def test_delete_endpoint_soft_deletes(self):
        # Grant superuser permission to allow curriculum.edit access
        self.operator.is_superuser = True
        self.operator.save()
        self.client.force_login(self.operator)
        response = self.client.post(f'/api/academic-hub/delete-subject/{self.subject.id}/')
        # Check response for debugging
        self.assertEqual(response.status_code, 200, f"API returned {response.status_code}: {response.content}")
        self.subject.refresh_from_db()
        self.assertTrue(self.subject.is_deleted)
