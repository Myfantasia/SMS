from datetime import datetime, timezone

from django.contrib.auth.models import User
from django.test import TestCase

from apps.messaging.models import Notification
from shared.events.timetable_events import TimetablePublishedEvent
from shared.events.bus import bus


class TimetablePublishedReceiverTests(TestCase):
    def setUp(self):
        self.t1 = User.objects.create_user(username='t1', password='x')
        self.t2 = User.objects.create_user(username='t2', password='x')
        self.admin = User.objects.create_user(username='admin1', password='x')

    def event(self, **overrides):
        data = dict(
            timetable_id=1, timetable_name='Term 1', term_id=1, year_id=1,
            teacher_user_ids=(self.t1.id, self.t2.id, self.t1.id),
            published_by_id=self.admin.id, occurred_at=datetime.now(timezone.utc),
        )
        data.update(overrides)
        return TimetablePublishedEvent(**data)

    def test_each_distinct_teacher_is_notified_once(self):
        bus.publish(self.event())
        self.assertEqual(Notification.objects.filter(recipient=self.t1).count(), 1)
        self.assertEqual(Notification.objects.filter(recipient=self.t2).count(), 1)

    def test_operator_gets_a_summary(self):
        bus.publish(self.event())
        note = Notification.objects.get(recipient=self.admin)
        self.assertIn('Term 1', note.message)

    def test_no_recipients_creates_nothing(self):
        bus.publish(self.event(teacher_user_ids=(), published_by_id=None))
        self.assertEqual(Notification.objects.count(), 0)
