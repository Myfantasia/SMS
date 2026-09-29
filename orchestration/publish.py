"""Composition root for publishing teacher allocations.

The ONE place allocations, the timetable, audit logging, identity and the event bus meet for a
publish -- exactly like orchestration/tasks.py does for rollover and bulk allocation (apps never
import each other; this package is the documented exception). Nothing here is a Celery task: a
publish is one bounded transaction the admin waits on, so it runs synchronously.

Flow of publish_scope: lock every class's publish-state row (in id order, so two publishes cannot
deadlock) -> prove the review is still fresh (fingerprint) -> re-validate -> apply to the DRAFT
timetable only -> mark published -> audit -> notify after commit. A live (Published) timetable is
never written to.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Sequence, Tuple

from django.db import transaction

from apps.allocations import publish_gate
from apps.allocations import services as allocation_services
from apps.core import services as core_services
from apps.identity import services as identity_services
from apps.timetable import services as timetable_services
from shared.events.allocation_events import AllocationsPublishedEvent
from shared.events.bus import bus


class PublishError(Exception):
    code = 'PUBLISH_ERROR'


class StaleReviewError(PublishError):
    code = 'STALE_REVIEW'


class PublishBlockedError(PublishError):
    code = 'BLOCKED'

    def __init__(self, blockers):
        super().__init__("This draft has problems that must be fixed before it can be published.")
        self.blockers = tuple(blockers)


class AcknowledgementRequiredError(PublishError):
    code = 'ACK_REQUIRED'

    def __init__(self, blockers):
        super().__init__("This draft has warnings. Acknowledge them to publish anyway.")
        self.blockers = tuple(blockers)


@dataclass(frozen=True)
class SyncSummaryDTO:
    target_timetable_id: Optional[int]
    target_timetable_name: Optional[str]
    target_is_live: bool
    synced: bool
    ejected_count: int = 0
    swapped_count: int = 0
    locked_skipped_count: int = 0
    regenerated_subject_count: int = 0


@dataclass(frozen=True)
class PublishPreviewDTO:
    class_ids: Tuple[int, ...]
    fingerprint: str
    blockers: tuple
    sync: SyncSummaryDTO

    @property
    def can_publish(self) -> bool:
        return not any(b.severity == 'HARD' for b in self.blockers)

    @property
    def requires_acknowledgement(self) -> bool:
        return any(b.severity == 'SOFT' for b in self.blockers)


@dataclass(frozen=True)
class PublishResultDTO:
    class_ids: Tuple[int, ...]
    sync: SyncSummaryDTO
    warnings_acknowledged: int


def _no_sync(target) -> SyncSummaryDTO:
    return SyncSummaryDTO(
        target_timetable_id=target.timetable_id if target else None,
        target_timetable_name=target.name if target else None,
        target_is_live=bool(target and target.is_live),
        synced=False,
    )


def _sync_summary(target, result) -> SyncSummaryDTO:
    return SyncSummaryDTO(
        target_timetable_id=target.timetable_id, target_timetable_name=target.name, target_is_live=False,
        synced=True, ejected_count=result.ejected_count, swapped_count=result.swapped_count,
        locked_skipped_count=result.locked_skipped_count,
        regenerated_subject_count=sum(len(v) for v in result.needs_regeneration.values()),
    )


def _sync_inputs(term_id, year_id, class_ids, lock: bool = False):
    # lock=True (publish only): row-lock the target so it cannot be flipped to Published mid-publish.
    resolve = timetable_services.lock_sync_target if lock else timetable_services.get_sync_target
    target = resolve(term_id=term_id, year_id=year_id)
    if target is None or target.is_live:
        return target, frozenset(), frozenset()
    prior = timetable_services.get_lesson_triples(timetable_id=target.timetable_id, class_ids=class_ids)
    new = publish_gate.get_scope_triples(term_id=term_id, year_id=year_id, class_ids=class_ids)
    return target, prior, new


def preview_publish(*, term_id: int, year_id: int, class_ids: Sequence[int]) -> PublishPreviewDTO:
    """Read-only: what would publishing this scope do? Validates, fingerprints, and dry-runs the
    timetable sync (skipped when there are hard blockers -- the numbers would be meaningless)."""
    review = publish_gate.review_scope(term_id=term_id, year_id=year_id, class_ids=class_ids)
    target, prior, new = _sync_inputs(term_id, year_id, review.class_ids)
    if review.hard_blockers or target is None or target.is_live:
        sync = _no_sync(target)
    else:
        result = timetable_services.preview_sync_with_allocation_changes(
            active_timetable_id=target.timetable_id, prior_triples=prior, new_triples=new,
        )
        sync = _sync_summary(target, result)
    return PublishPreviewDTO(class_ids=review.class_ids, fingerprint=review.fingerprint,
                             blockers=review.blockers, sync=sync)


def publish_scope(
    *, term_id: int, year_id: int, class_ids: Sequence[int], review_fingerprint: str,
    acknowledge_soft: bool, operator_id: Optional[int],
) -> PublishResultDTO:
    ids = tuple(sorted(set(int(c) for c in class_ids)))
    with transaction.atomic():
        for classroom_id in ids:  # sorted -> consistent lock order across concurrent publishes
            allocation_services.lock_publish_state(
                classroom_id=classroom_id, term_id=term_id, academic_year_id=year_id)

        current = publish_gate.compute_scope_fingerprint(term_id=term_id, year_id=year_id, class_ids=ids)
        if current != review_fingerprint:
            raise StaleReviewError("This draft changed after you reviewed it. Review it again before publishing.")

        review = publish_gate.review_scope(term_id=term_id, year_id=year_id, class_ids=ids)

        target, prior, new = _sync_inputs(term_id, year_id, ids, lock=True)

        # A class with no current allocations is normally a hard NOTHING_TO_PUBLISH blocker (it was
        # never allocated). But if it currently HAS lessons on the sync target, that combination
        # means the admin intentionally cleared its draft -- the correct publish outcome is to eject
        # those lessons, not to refuse forever. Only suppress the blocker for classes where that's
        # true; a genuinely never-allocated class (no lessons either) still stays hard-blocked.
        classes_with_target_lessons = {c_id for (c_id, _t_id, _s_id) in prior}
        hard_blockers = tuple(
            b for b in review.hard_blockers
            if not (b.code == 'NOTHING_TO_PUBLISH' and b.classroom_id in classes_with_target_lessons)
        )
        if hard_blockers:
            raise PublishBlockedError(hard_blockers)
        if review.soft_blockers and not acknowledge_soft:
            raise AcknowledgementRequiredError(review.soft_blockers)

        if target is None or target.is_live:
            sync = _no_sync(target)
        else:
            result = timetable_services.sync_with_allocation_changes(
                active_timetable_id=target.timetable_id, prior_triples=prior, new_triples=new)
            sync = _sync_summary(target, result)

        for classroom_id in ids:
            allocation_services.publish_allocation(classroom_id, term_id, year_id, operator_id)

        acknowledged = len(review.soft_blockers)
        core_services.write_audit_log(
            operator_id=operator_id, action_type='UPDATE', module='AllocationPublish',
            description=(
                f"Published allocations for {len(ids)} class(es) (term {term_id}, year {year_id}). "
                + (f"Timetable '{sync.target_timetable_name}' updated: {sync.ejected_count} lesson(s) ejected, "
                   f"{sync.swapped_count} swapped in place, {sync.regenerated_subject_count} regenerated, "
                   f"{sync.locked_skipped_count} locked left untouched. " if sync.synced
                   else ("No timetable was changed (the active timetable is live). " if sync.target_is_live
                         else "No active timetable to update. "))
                + f"{acknowledged} warning(s) acknowledged"
                + (": " + ", ".join(sorted({b.code for b in review.soft_blockers})) if acknowledged else "")
                + "."
            ),
        )

        teacher_ids = {
            teacher_id for (_, teacher_id, _) in
            publish_gate.get_scope_triples(term_id=term_id, year_id=year_id, class_ids=ids)
        }
        event = AllocationsPublishedEvent(
            term_id=term_id, year_id=year_id, class_ids=ids,
            teacher_user_ids=identity_services.get_teacher_user_ids(teacher_ids),
            published_by_id=operator_id, timetable_synced=sync.synced,
            occurred_at=datetime.now(timezone.utc),
        )
        # robust=True: a notification failure must never turn an already-committed publish into an
        # error for the caller -- Django logs the exception and carries on.
        transaction.on_commit(lambda: bus.publish(event), robust=True)

    return PublishResultDTO(class_ids=ids, sync=sync, warnings_acknowledged=acknowledged)
