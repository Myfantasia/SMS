"""Public service surface for the `timetable` app.

Timetable grid, lesson allocation, substitution/daily cover. (TimeSlot
itself moved to `academics` -- see the plan's implementation-time
correction note: it has zero FK dependencies of its own, so it belongs
alongside AcademicYear/ExamTerm as shared calendar structure, not here.)

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet.

This app may import services from:
    - apps.identity.services
    - apps.academics.services
    - apps.allocations.services
    - apps.staff.services

This app does NOT import apps.allocations.services back (that would create
a cycle with allocations' own upward need in the opposite direction for the
rollover/bulk-allocate jobs). Per the plan's "allocations <-> timetable
problem" section, that composition lives in orchestration/tasks.py, which
is allowed to call both this module and apps.allocations.services in the
same function body -- this file only ever gets called, never calls back.

Track B step 6: Timetable/LessonAllocation (and the rest of this app's
models) physically relocated to apps/timetable/models.py -- function bodies
below now import from there directly.
"""
from dataclasses import dataclass
from typing import Optional, Sequence

from django.db import transaction

from apps.timetable.models import Timetable, LessonAllocation


@dataclass(frozen=True)
class TimetableSyncResultDTO:
    """Return shape for sync_with_allocation_changes -- pairs with
    apps.allocations.services.RolloverResultDTO. Field names match
    school/views/views_timetable.py's sync_timetable_with_allocation_changes
    exactly (that function already returns plain dict/int/set data, not
    model instances -- this wrapper is close to a no-op)."""
    ejected_count: int
    swapped_count: int
    locked_skipped_count: int
    needs_regeneration: dict


@dataclass(frozen=True)
class SyncTargetDTO:
    timetable_id: int
    name: str
    is_live: bool


@dataclass(frozen=True)
class LessonAllocationDTO:
    id: int
    timetable_id: int
    time_slot_id: int
    class_stream_id: int
    subject_id: int
    teacher_id: int


def get_timetable_name(*, timetable_id: int) -> Optional[str]:
    t = Timetable.objects.filter(id=timetable_id).only('name').first()
    return t.name if t else None


def get_active_timetable_id(*, term_id: Optional[int] = None, year_id: Optional[int] = None) -> Optional[int]:
    qs = Timetable.objects.filter(is_active=True)
    if term_id is not None:
        qs = qs.filter(term_id=term_id)
    if year_id is not None:
        qs = qs.filter(academic_year_id=year_id)
    t = qs.first()
    return t.id if t else None


def sync_with_allocation_changes(
    *, active_timetable_id: Optional[int], prior_triples: frozenset, new_triples: frozenset,
) -> TimetableSyncResultDTO:
    """Wraps school/views/views_timetable.py's
    sync_timetable_with_allocation_changes. Called ONLY from
    orchestration/tasks.py (the composition-root layer) -- never directly
    by apps.allocations, per the plan's dependency-cycle analysis. Must run
    inside the caller's own transaction.atomic() block, exactly as today,
    since a mid-run crash must roll back to the pre-run state.
    """
    from school.views.views_timetable import sync_timetable_with_allocation_changes as _sync

    active_timetable = Timetable.objects.filter(id=active_timetable_id).first() if active_timetable_id else None
    result = _sync(active_timetable=active_timetable, prior_triples=prior_triples, new_triples=new_triples)
    return TimetableSyncResultDTO(
        ejected_count=result["ejected_count"],
        swapped_count=result["swapped_count"],
        locked_skipped_count=result["locked_skipped_count"],
        needs_regeneration=result["needs_regeneration"],
    )


def get_sync_target(*, term_id: int, year_id: int) -> Optional[SyncTargetDTO]:
    """The timetable an allocation publish syncs into: the ACTIVE timetable for this term/year.

    `is_live` is True when that timetable is Published -- callers must never sync into a live
    timetable (a live timetable is only ever changed by an explicit, gated timetable publish)."""
    timetable = Timetable.objects.filter(is_active=True, term_id=term_id, academic_year_id=year_id).first()
    if timetable is None:
        return None
    return SyncTargetDTO(timetable_id=timetable.id, name=timetable.name, is_live=(timetable.status == 'Published'))


def lock_sync_target(*, term_id: int, year_id: int) -> Optional[SyncTargetDTO]:
    """Like get_sync_target, but takes a row lock on the active timetable. MUST be called inside an
    open transaction.atomic(). Holding the lock until commit means the timetable status API cannot
    flip it to Published between this check and the sync's writes (its UPDATE waits for our commit),
    so a live timetable is never written to."""
    timetable = Timetable.objects.select_for_update().filter(
        is_active=True, term_id=term_id, academic_year_id=year_id).first()
    if timetable is None:
        return None
    return SyncTargetDTO(timetable_id=timetable.id, name=timetable.name, is_live=(timetable.status == 'Published'))


def get_lesson_triples(*, timetable_id: int, class_ids: Sequence[int]) -> frozenset:
    """Distinct (class_stream_id, teacher_id, subject_id) triples currently scheduled on a timetable
    for the given classes -- the "before" picture a publish diffs the new allocations against, so a
    republish after an unpublish/edit is compared with what is really on the grid, not with memory."""
    rows = LessonAllocation.objects.filter(
        timetable_id=timetable_id, class_stream_id__in=list(class_ids),
    ).values_list('class_stream_id', 'teacher_id', 'subject_id').distinct()
    return frozenset(rows)


def preview_sync_with_allocation_changes(
    *, active_timetable_id: Optional[int], prior_triples: frozenset, new_triples: frozenset,
) -> TimetableSyncResultDTO:
    """Dry run of sync_with_allocation_changes: runs the real sync inside a savepoint and rolls it
    back, so the returned counts are exactly what a real publish would do and nothing persists.
    (The sync engine has no native dry-run mode; this avoids duplicating its swap/eject logic.)"""
    with transaction.atomic():
        result = sync_with_allocation_changes(
            active_timetable_id=active_timetable_id, prior_triples=prior_triples, new_triples=new_triples,
        )
        transaction.set_rollback(True)
    return result


def generate_lessons_for_scope(*, timetable_id: int, class_stream_ids: Sequence[int]) -> tuple:
    """Wraps school/views/views_timetable.py's generate_lessons_for_scope.
    Called from orchestration/tasks.py's generate_timetable_task -- same-app
    logic today (both live in views_timetable.py), so this wrapper is purely
    about giving the composition-root layer a stable import path once
    tasks.py itself moves to orchestration/.
    Returns (allocations_created: int, unscheduled_basket_errors: list).
    """
    from apps.academics.models import ClassStream
    from school.views.views_timetable import generate_lessons_for_scope as _generate

    timetable = Timetable.objects.get(id=timetable_id)
    streams = list(ClassStream.live.filter(id__in=class_stream_ids).select_related('grade'))
    return _generate(timetable, streams)


def list_lessons(*, timetable_id: int, class_stream_id: Optional[int] = None) -> Sequence[LessonAllocationDTO]:
    qs = LessonAllocation.objects.filter(timetable_id=timetable_id)
    if class_stream_id is not None:
        qs = qs.filter(class_stream_id=class_stream_id)
    return tuple(
        LessonAllocationDTO(
            id=l.id, timetable_id=l.timetable_id, time_slot_id=l.time_slot_id,
            class_stream_id=l.class_stream_id, subject_id=l.subject_id, teacher_id=l.teacher_id,
        )
        for l in qs
    )
