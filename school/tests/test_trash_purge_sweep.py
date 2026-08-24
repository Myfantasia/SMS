from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from apps.academics.models import Subject
from apps.identity.models import Role


class AutoPurgeSweepTests(TestCase):
    def setUp(self):
        self.operator = User.objects.create_user(username='super2', password='x', is_superuser=True)

    def test_expired_auto_purgeable_item_is_deleted(self):
        role = Role.objects.create(name='ExpiredRole')
        role.is_deleted = True
        role.deleted_at = timezone.now() - timedelta(days=21)
        role.save()

        from apps.core.trash import purge_expired_trash
        purged = purge_expired_trash(entity_type='roles')

        self.assertEqual(purged, 1)
        self.assertFalse(Role.objects.filter(id=role.id).exists())

    def test_not_yet_expired_item_survives(self):
        role = Role.objects.create(name='FreshRole')
        role.is_deleted = True
        role.deleted_at = timezone.now() - timedelta(days=5)
        role.save()

        from apps.core.trash import purge_expired_trash
        purge_expired_trash(entity_type='roles')

        self.assertTrue(Role.objects.filter(id=role.id).exists())

    def test_class_stream_and_subject_never_auto_purge(self):
        subject = Subject.objects.create(code='HIST101', name='History')
        subject.is_deleted = True
        subject.deleted_at = timezone.now() - timedelta(days=100)
        subject.save()

        from apps.core.trash import purge_expired_trash
        purge_expired_trash()

        self.assertTrue(Subject.objects.filter(id=subject.id).exists())

    def test_management_command_runs(self):
        call_command('purge_expired_trash')
