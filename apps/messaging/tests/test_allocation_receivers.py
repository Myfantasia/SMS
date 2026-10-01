from datetime import datetime, timezone

from django.contrib.auth.models import User
from django.test import TestCase

from apps.messaging.models import Notification
from shared.events.allocation_events import AllocationsPublishedEvent
from shared.events.allocation_rebalance_events import AllocationRebalancedEvent
from shared.events.bus import bus


class AllocationsPublishedReceiverTests(TestCase):
    def setUp(self):
        self.t1 = User.objects.create_user(username='t1', password='x')
        self.t2 = User.objects.create_user(username='t2', password='x')
        self.admin = User.objects.create_user(username='admin1', password='x')

    def event(self, **overrides):
        data = dict(
            term_id=1, year_id=1, class_ids=(10, 11), teacher_user_ids=(self.t1.id, self.t2.id, self.t1.id),
            published_by_id=self.admin.id, timetable_synced=True, occurred_at=datetime.now(timezone.utc),
        )
        data.update(overrides)
        return AllocationsPublishedEvent(**data)

    def test_each_distinct_teacher_is_notified_once(self):
        bus.publish(self.event())
        self.assertEqual(Notification.objects.filter(recipient=self.t1).count(), 1)
        self.assertEqual(Notification.objects.filter(recipient=self.t2).count(), 1)

    def test_operator_gets_a_summary_notification(self):
        bus.publish(self.event())
        note = Notification.objects.get(recipient=self.admin)
        self.assertIn('2 class', note.message)

    def test_operator_who_is_also_a_teacher_is_not_notified_twice(self):
        bus.publish(self.event(published_by_id=self.t1.id))
        self.assertEqual(Notification.objects.filter(recipient=self.t1).count(), 2)  # teacher note + operator note

    def test_no_teachers_and_no_operator_creates_nothing(self):
        bus.publish(self.event(teacher_user_ids=(), published_by_id=None))
        self.assertEqual(Notification.objects.count(), 0)


class AllocationRebalancedReceiverTests(TestCase):
    def setUp(self):
        self.t1 = User.objects.create_user(username='rb_t1', password='x')
        self.admin = User.objects.create_user(username='rb_admin', password='x')

    def test_rebalanced_teachers_and_operator_are_notified(self):
        event = AllocationRebalancedEvent(
            term_id=1, year_id=1, class_ids=(5,), moves_applied=2,
            teacher_user_ids=(self.t1.id,), operator_id=self.admin.id,
            occurred_at=datetime.now(timezone.utc),
        )
        bus.publish(event)

        self.assertEqual(Notification.objects.filter(recipient=self.t1).count(), 1)
        note = Notification.objects.get(recipient=self.admin)
        self.assertIn('2', note.message)
