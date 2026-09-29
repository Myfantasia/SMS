"""Composition root for publishing a timetable (mirrors orchestration/publish.py for allocations).

Flow: lock the timetable row -> prove the review is still fresh (fingerprint) -> re-verify ->
hard/soft gates -> flip status to Published (and is_active, singleton, if requested) -> audit ->
notify after commit.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from django.db import transaction

from apps.core import services as core_services
from apps.identity import services as identity_services
from apps.timetable import verify as timetable_verify
from apps.timetable.models import LessonAllocation, Timetable
from shared.events.bus import bus
from shared.events.timetable_events import TimetablePublishedEvent


class PublishError(Exception):
    code = 'PUBLISH_ERROR'


class StaleReviewError(PublishError):
    code = 'STALE_REVIEW'


class TimetableBlockedError(PublishError):
    code = 'BLOCKED'

    def __init__(self, blockers):
        super().__init__("This timetable has problems that must be fixed before it can be published.")
        self.blockers = tuple(blockers)


class AcknowledgementRequiredError(PublishError):
    code = 'ACK_REQUIRED'

    def __init__(self, blockers):
        super().__init__("This timetable has warnings. Acknowledge them to publish anyway.")
        self.blockers = tuple(blockers)


@dataclass(frozen=True)
class TimetablePublishResultDTO:
    timetable_id: int
    warnings_acknowledged: int


def preview_timetable_publish(*, timetable_id: int) -> timetable_verify.VerificationReportDTO:
    return timetable_verify.verify_timetable(timetable_id=timetable_id)


def publish_timetable(
    *, timetable_id: int, review_fingerprint: str, acknowledge_soft: bool,
    operator_id: Optional[int], make_active: bool = False,
) -> TimetablePublishResultDTO:
    with transaction.atomic():
        timetable = Timetable.objects.select_for_update().get(id=timetable_id)

        current = timetable_verify.compute_timetable_fingerprint(timetable_id=timetable_id)
        if current != review_fingerprint:
            raise StaleReviewError("This timetable changed after you reviewed it. Review it again before publishing.")

        report = timetable_verify.verify_timetable(timetable_id=timetable_id)
        if report.hard_blockers:
            raise TimetableBlockedError(report.hard_blockers)
        if report.soft_blockers and not acknowledge_soft:
            raise AcknowledgementRequiredError(report.soft_blockers)

        prior_status = timetable.status
        timetable.status = 'Published'
        if make_active:
            Timetable.objects.exclude(id=timetable.id).update(is_active=False)
            timetable.is_active = True
        timetable.save()

        acknowledged = len(report.soft_blockers)
        core_services.write_audit_log(
            operator_id=operator_id, action_type='UPDATE', module='TimetablePublish',
            description=(
                f"Published timetable '{timetable.name}' ({prior_status} -> Published)."
                + (f" {acknowledged} warning(s) acknowledged: "
                   + ", ".join(sorted({b.code for b in report.soft_blockers})) if acknowledged else "")
                + (" Set as the active timetable." if make_active else "")
            ),
        )

        teacher_ids = set(LessonAllocation.objects.filter(timetable_id=timetable_id).values_list('teacher_id', flat=True))
        event = TimetablePublishedEvent(
            timetable_id=timetable.id, timetable_name=timetable.name,
            term_id=timetable.term_id, year_id=timetable.academic_year_id,
            teacher_user_ids=identity_services.get_teacher_user_ids(teacher_ids),
            published_by_id=operator_id, occurred_at=datetime.now(timezone.utc),
        )
        # robust=True: a notification failure must never turn an already-committed publish into an
        # error for the caller -- Django logs the exception and carries on (same rationale as
        # orchestration/publish.py's identical call).
        transaction.on_commit(lambda: bus.publish(event), robust=True)

    return TimetablePublishResultDTO(timetable_id=timetable.id, warnings_acknowledged=acknowledged)
