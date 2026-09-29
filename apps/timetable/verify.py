"""Read-only verification of one timetable, for the timetable's own gated publish (mirrors
apps/allocations/publish_gate.py, which does the same job for an allocation publish scope).

No writes. Composition with allocations (audit, event, atomic publish) happens one level up in
orchestration/timetable_publish.py, never here.
"""
import hashlib
from dataclasses import dataclass
from itertools import combinations
from typing import Tuple

# Direct apps.allocations.models import, not a services.py reexport: verify_timetable needs real
# model instances (AllocationPublishState/SubjectAllocation/GlobalAllocationPolicy) for its own
# .objects.filter(...)/.values_list(...) queries across timetable, allocation and staff data in
# one verification pass -- a full DTO-ification of that cross-app read is future work, the same
# class of deferred tech debt as apps.timetable.services's own existing exception for
# apps.academics.models (see ignore_imports under no-model-import-timetable in .importlinter).
# Flagged there with a matching ignore_imports entry for this module rather than routed through
# apps.allocations.services, since every other real "needs a raw model instance" precedent in
# this codebase is a documented .importlinter exception importing straight from .models, not a
# reexport through another app's services.py namespace.
from apps.allocations.models import AllocationPublishState, GlobalAllocationPolicy, SubjectAllocation
from apps.allocations.validation import BlockerDTO
from apps.timetable.models import LessonAllocation, Timetable, TimetablePedagogyPolicy


@dataclass(frozen=True)
class VerificationReportDTO:
    timetable_id: int
    fingerprint: str
    blockers: Tuple[BlockerDTO, ...]

    @property
    def hard_blockers(self) -> Tuple[BlockerDTO, ...]:
        return tuple(b for b in self.blockers if b.severity == 'HARD')

    @property
    def soft_blockers(self) -> Tuple[BlockerDTO, ...]:
        return tuple(b for b in self.blockers if b.severity == 'SOFT')


def _published_contract_map(term_id: int, year_id: int) -> dict:
    """(classroom_id, subject_id) -> teacher_id, for PUBLISHED allocations only -- the same source
    Task 1 made generate_lessons_for_scope use, so verify checks a timetable against the same
    reality generation is built from."""
    published_ids = AllocationPublishState.objects.filter(
        term_id=term_id, academic_year_id=year_id, is_published=True,
    ).values_list('classroom_id', flat=True)
    rows = SubjectAllocation.objects.filter(
        term_id=term_id, academic_year_id=year_id, is_active=True, classroom_id__in=published_ids,
    ).values_list('classroom_id', 'subject_id', 'teacher_id')
    return {(c_id, s_id): t_id for c_id, s_id, t_id in rows}


def compute_timetable_fingerprint(*, timetable_id: int) -> str:
    """Hash of every lesson's placement -- same content, same fingerprint; any real change (moved,
    added, removed, retaught, relocked) makes a stale review detectable."""
    rows = sorted(LessonAllocation.objects.filter(timetable_id=timetable_id).values_list(
        'id', 'time_slot_id', 'class_stream_id', 'subject_id', 'teacher_id', 'is_double_period', 'is_locked',
    ))
    return hashlib.sha256(repr(rows).encode('utf-8')).hexdigest()


def verify_timetable(*, timetable_id: int) -> VerificationReportDTO:
    timetable = Timetable.objects.select_related('term', 'academic_year').get(id=timetable_id)
    policy = TimetablePedagogyPolicy.load()
    global_policy = GlobalAllocationPolicy.load()
    contract_map = _published_contract_map(timetable.term_id, timetable.academic_year_id)

    from school.utils import build_grade_subject_block_map, compute_school_allocation_gaps, get_subject_block_names
    # Same rationale as the module-level apps.allocations.models import above: verify_timetable
    # needs a real TeacherStructuralAvailability model instance for its own
    # .objects.values_list(...) query, not a DTO -- same class of deferred tech debt as
    # apps.timetable.services's existing apps.academics.models exception, flagged with a matching
    # ignore_imports entry in .importlinter rather than routed through apps.staff.services. This
    # is the real, lint-clean form of the brief's placeholder import.
    from apps.staff.models import TeacherStructuralAvailability

    lessons = list(LessonAllocation.objects.filter(timetable_id=timetable_id).select_related(
        'time_slot', 'class_stream', 'class_stream__grade', 'subject', 'teacher',
    ))
    block_map = build_grade_subject_block_map()
    block_names = get_subject_block_names(block_map.values())

    blockers = []

    def hard(code, message, **kw):
        blockers.append(BlockerDTO(code=code, severity='HARD', message=message, rule_ref=f'timetable.{code.lower()}', **kw))

    def soft(code, message, **kw):
        blockers.append(BlockerDTO(code=code, severity='SOFT', message=message, rule_ref=f'timetable.{code.lower()}', **kw))

    # --- Hard conflicts ---
    # Deliberately NOT a same-time_slot-id groupby: LessonAllocation.Meta.unique_together already
    # makes an identical (timetable, time_slot, teacher) row impossible at the DB level ("THE
    # COLLISION ENGINE"), so grouping by time_slot id alone could never catch a real teacher
    # conflict -- it's keyed on the FK id, not on actual wall-clock time. Two DIFFERENT TimeSlot
    # rows (e.g. edited after lessons were already placed) can still overlap in day/start/end and
    # sail straight past that constraint, so double-booking is checked by real interval overlap
    # instead. This also still catches the identical-slot case (trivially overlapping), so
    # CLASS_DOUBLE_BOOKED -- which the DB does NOT block, since class_stream+subject differ -- is
    # unaffected.
    def _overlapping(group):
        hit = set()
        for a, b in combinations(group, 2):
            if (a.time_slot.day == b.time_slot.day
                    and a.time_slot.start_time < b.time_slot.end_time
                    and b.time_slot.start_time < a.time_slot.end_time):
                hit.add(a)
                hit.add(b)
        return hit

    by_teacher = {}
    for l in lessons:
        by_teacher.setdefault(l.teacher_id, []).append(l)
    for teacher_id, group in sorted(by_teacher.items()):
        hit = _overlapping(group)
        if hit:
            names = ', '.join(sorted({l.class_stream.name for l in hit}))
            hard('TEACHER_DOUBLE_BOOKED', f"{group[0].teacher.get_name} is scheduled in two places at once: {names}.",
                 teacher_id=teacher_id)

    by_class = {}
    for l in lessons:
        by_class.setdefault(l.class_stream_id, []).append(l)
    for class_id, group in sorted(by_class.items()):
        hit = _overlapping(group)
        if hit:
            subjects = ', '.join(sorted({l.subject.name for l in hit}))
            hard('CLASS_DOUBLE_BOOKED', f"{group[0].class_stream.name} has two lessons in one slot: {subjects}.",
                 classroom_id=class_id)

    blackout = set(TeacherStructuralAvailability.objects.values_list('teacher_id', 'time_slot_id'))

    for l in lessons:
        if (l.teacher_id, l.time_slot_id) in blackout:
            hard('TEACHER_STRUCTURALLY_UNAVAILABLE',
                 f"{l.teacher.get_name} is marked permanently unavailable for this slot ({l.class_stream.name}, {l.subject.name}).",
                 teacher_id=l.teacher_id, classroom_id=l.class_stream_id)
        if l.time_slot.is_global:
            hard('LESSON_IN_GLOBAL_SLOT',
                 f"{l.class_stream.name} has {l.subject.name} scheduled during {l.time_slot.global_label or 'a global block'}.",
                 classroom_id=l.class_stream_id)
        key = (l.class_stream_id, l.subject_id)
        expected_teacher = contract_map.get(key)
        if expected_teacher is None or expected_teacher != l.teacher_id:
            hard('LESSON_NOT_PUBLISHED',
                 f"{l.class_stream.name}'s {l.subject.name} lesson (taught by {l.teacher.get_name}) no longer "
                 f"matches a published allocation.", classroom_id=l.class_stream_id, teacher_id=l.teacher_id,
                 suggested_fix='Regenerate this class, or publish the allocation that matches it.')

    # Block synchronization: every member subject of a grade's block must land in the SAME slot
    # (block_map is grade-scoped -- each SubjectBlock row belongs to exactly one grade level --
    # so block_id alone already pins the grade; grouping by block_id is sufficient).
    by_block = {}
    for l in lessons:
        block_id = block_map.get((l.class_stream.grade_id, l.subject_id))
        if block_id is not None:
            by_block.setdefault(block_id, set()).add(l.time_slot_id)
    for block_id, slot_ids in by_block.items():
        if len(slot_ids) > 1:
            hard('BLOCK_NOT_SYNCHRONIZED',
                 f"The '{block_names.get(block_id, 'shared')}' block is scheduled in different slots across its classes.")

    # --- Completeness ---
    gaps = compute_school_allocation_gaps(timetable.term_id, timetable.academic_year_id)
    scheduled_pairs = {(l.class_stream_id, l.subject_id) for l in lessons}
    published_class_ids = {c_id for (c_id, _s_id) in contract_map.keys()}
    for gap in sorted(gaps, key=lambda g: g['class_id']):
        if gap['class_id'] not in published_class_ids:
            continue  # an unpublished class's incompleteness isn't this timetable's problem yet
        soft('INCOMPLETE_CLASS', f"{gap['class_name']} still has no teacher for: {', '.join(gap['missing_subjects'])}.",
             classroom_id=gap['class_id'])
    for (class_id, subject_id) in sorted(contract_map.keys()):
        if (class_id, subject_id) not in scheduled_pairs:
            soft('UNSCHEDULED_SUBJECT', 'A published subject has no lesson placed on this timetable yet.',
                 classroom_id=class_id, subject_id=subject_id, suggested_fix='Regenerate this class.')

    # --- Pedagogy rules ---
    severity_fn = hard if policy.enforcement_mode == 'STRICT' else soft
    weekly_counts = {}
    daily_counts = {}
    for l in lessons:
        weekly_counts[l.teacher_id] = weekly_counts.get(l.teacher_id, 0) + 1
        key = (l.teacher_id, l.time_slot.day)
        daily_counts[key] = daily_counts.get(key, 0) + 1
    for teacher_id, count in sorted(weekly_counts.items()):
        if count > global_policy.max_weekly_lessons:
            severity_fn('TEACHER_WEEKLY_CAP', f"A teacher has {count} lessons this week, above the "
                        f"{global_policy.max_weekly_lessons}-lesson cap.", teacher_id=teacher_id)
    for (teacher_id, day), count in sorted(daily_counts.items()):
        if count > policy.heavy_day_threshold:
            severity_fn('HEAVY_DAY', f"A teacher has {count} lessons on {day}, above the "
                        f"{policy.heavy_day_threshold}-lesson heavy-day threshold.", teacher_id=teacher_id)

    return VerificationReportDTO(
        timetable_id=timetable_id,
        fingerprint=compute_timetable_fingerprint(timetable_id=timetable_id),
        blockers=tuple(blockers),
    )
