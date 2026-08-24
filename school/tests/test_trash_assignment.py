from django.contrib.auth.models import User, Group
from django.test import TestCase

from apps.academics.models import ClassStream, GradeLevel, Curriculum, Subject
from apps.assignments.models import Assignment
from apps.identity.models import TeacherExtra, Permission


class AssignmentTrashTests(TestCase):
    def setUp(self):
        # HasModulePermission's superuser bypass only grants codes that exist as
        # Permission rows in the DB, so assignments.edit must be seeded for the
        # DELETE test to pass RBAC even for a superuser admin.
        Permission.objects.get_or_create(code='assignments.edit', defaults={'label': 'Edit Assignments', 'module': 'assignments'})
        self.operator = User.objects.create_user(username='teach2', password='x', first_name='Tee', last_name='Cher2')
        self.teacher = TeacherExtra.objects.create(user=self.operator, status=True)
        curriculum = Curriculum.objects.create(name='CBC2', is_active_for_new_grades=True)
        grade = GradeLevel.objects.create(curriculum=curriculum, name='Grade 8', numeric_order=8)
        self.stream = ClassStream.objects.create(name='West', grade=grade)
        self.subject = Subject.objects.create(code='ENG101', name='English')
        self.assignment = Assignment.objects.create(
            title='Essay 1', teacher=self.teacher, subject=self.subject, class_stream=self.stream,
        )

    def test_delete_soft_deletes(self):
        self.client.force_login(self.operator)
        self.client.delete(f'/api/assignments/teacher/{self.assignment.id}/')
        self.assignment.refresh_from_db()
        self.assertTrue(self.assignment.is_deleted)
        self.assertIsNotNone(self.assignment.deleted_at)
        self.assertTrue(Assignment.objects.filter(id=self.assignment.id).exists())
