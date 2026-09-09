"""The one piece of the modular-monolith event system Phase 3 swaps wholesale
(Django signals -> Celery -> Kafka/RabbitMQ) without any publisher/subscriber
call site needing to change. Keep this file small and boring on purpose.
"""
from django.dispatch import Signal


class EventBus:
    def __init__(self):
        self._signal = Signal()

    def publish(self, event):
        """Synchronous fan-out to every subscriber of this event's exact type.

        Uses .send(), never .send_robust(): a bug in a subscriber must
        propagate to the publisher (and roll back an enclosing transaction),
        not be silently swallowed. A caller that genuinely wants best-effort,
        non-fatal delivery should wrap this call in its own try/except --
        that's a caller-specific decision, not something the bus should hide.

        Most publish call sites in this codebase happen inside
        transaction.atomic() blocks -- wrap the call in
        `transaction.on_commit(lambda: bus.publish(event))` at those sites so
        subscribers never act on data that later rolls back.
        """
        return self._signal.send(sender=type(event), event=event)

    def subscribe(self, event_type):
        """Decorator for registering a subscriber to one event type.

        Usage (register from the consuming app's apps.py `ready()`, e.g. via
        an app-local receivers.py, so the registration actually runs):

            @bus.subscribe(ExamResultsPublishedEvent)
            def handle_exam_results_published(event: ExamResultsPublishedEvent):
                ...

        weak=False is deliberate: a receiver built from a local closure/
        function reference would otherwise be eligible for garbage collection
        almost immediately (Django signals default to weak references) --
        the classic first mistake when adding signals to a codebase that has
        never used them before (this one hasn't, until now).
        """
        def _register(fn):
            def _receiver(sender, event, **kwargs):
                return fn(event)
            self._signal.connect(_receiver, sender=event_type, weak=False)
            return fn
        return _register


bus = EventBus()
