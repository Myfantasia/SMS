from django.contrib.auth.models import User
from django.test import TestCase

from apps.academics.models import ClassStream, GradeLevel, Curriculum


class ClassStreamTrashTests(TestCase):
    def setUp(self):
        self.operator = User.objects.create_user(username='admin1', password='x')
        curriculum = Curriculum.objects.create(name='CBC', is_active_for_new_grades=True)
        self.grade = GradeLevel.objects.create(curriculum=curriculum, name='Grade 7', numeric_order=7)
        self.stream = ClassStream.objects.create(name='East', grade=self.grade)

    def test_soft_delete_hides_from_live_manager(self):
        self.assertIn(self.stream, ClassStream.live.all())
        self.stream.soft_delete(operator_user=self.operator)
        self.assertNotIn(self.stream, ClassStream.live.all())
        self.assertIn(self.stream, ClassStream.objects.all())

    def test_restore_brings_it_back(self):
        self.stream.soft_delete(operator_user=self.operator)
        self.stream.restore(operator_user=self.operator)
        self.stream.refresh_from_db()
        self.assertFalse(self.stream.is_deleted)
        self.assertIsNone(self.stream.deleted_at)
        self.assertIn(self.stream, ClassStream.live.all())
