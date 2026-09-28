# apps/allocations/publish_gate.py
"""The review half of "draft -> review -> publish" for teacher allocations.

Pure functions, no writes: work out WHICH classes a publish covers, fingerprint their draft so a
later confirm can prove nothing changed since the admin's review, and validate the whole scope
(including load carried by classes outside it) with the same AllocationValidator every other
allocation path uses. Composition with the timetable (sync, audit, notification) happens one
level up in orchestration/publish.py, never here.

Lives in its own module (not services.py) only because services.py is already large; the public
surface is still DTOs and primitives, never model instances.

AllocationValidator and compute_school_allocation_gaps still live in school.utils, so they are
imported lazily inside the functions that need them -- the same precedent as
apps/allocations/services.py.

Deliberate limit: the fingerprint covers the scope's own saved rows and published flags, not
outside-scope load, policy, quotas or class-teacher assignment, because publish_scope re-runs
review_scope under lock, so any new HARD blocker is always caught at confirm time.
"""
import hashlib
from dataclasses import dataclass
from typing import Optional, Sequence, Tuple

from apps.allocations.models import AllocationPublishState, GlobalAllocationPolicy, SubjectAllocation
from apps.allocations.services import get_quota_map
from apps.allocations.validation import BlockerDTO, validate_row

SCOPE_CLASS = 'class'
SCOPE_GRADE = 'grade'
SCOPE_ALL = 'all'


@dataclass(frozen=True)
class ScopeReviewDTO:
    class_ids: Tuple[int, ...]
    fingerprint: str
    blockers: Tuple[BlockerDTO, ...]

    @property
    def hard_blockers(self) -> Tuple[BlockerDTO, ...]:
        return tuple(b for b in self.blockers if b.severity == 'HARD')

    @property
    def soft_blockers(self) -> Tuple[BlockerDTO, ...]:
        return tuple(b for b in self.blockers if b.severity == 'SOFT')


def _active_allocations(term_id: int, year_id: int):
    return SubjectAllocation.objects.filter(term_id=term_id, academic_year_id=year_id, is_active=True)


def resolve_publish_scope(
    *, term_id: int, year_id: int, scope: str, class_id: int, grade_id: Optional[int] = None,
) -> Tuple[int, ...]:
    """Which classes a publish covers. The class the admin is looking at is always in scope;
    'grade' / 'all' additionally sweep in every other class that has saved (draft) allocations and
    is not already published. Returned sorted so fingerprints and lock order are deterministic."""
    if scope == SCOPE_CLASS:
        return (int(class_id),)
    if scope not in (SCOPE_GRADE, SCOPE_ALL):
        raise ValueError(f"Unknown publish scope '{scope}'.")
    drafted = _active_allocations(term_id, year_id)
    if scope == SCOPE_GRADE:
        if not grade_id:
            raise ValueError("grade_id is required for a grade-wide publish.")
        drafted = drafted.filter(classroom__grade_id=grade_id)
    class_ids = set(drafted.values_list('classroom_id', flat=True))
    published = set(AllocationPublishState.objects.filter(
        term_id=term_id, academic_year_id=year_id, is_published=True, classroom_id__in=class_ids,
    ).values_list('classroom_id', flat=True))
    class_ids -= published
    class_ids.add(int(class_id))
    return tuple(sorted(class_ids))


def compute_scope_fingerprint(*, term_id: int, year_id: int, class_ids: Sequence[int]) -> str:
    """Hash of everything a review depends on: the scope's saved (class, subject, teacher) rows and
    which of its classes are published (deliberately NOT outside-scope load, policy, quotas or
    class-teacher assignment: publish_scope re-runs review_scope under lock, so any new HARD
    blocker is caught anyway). Same content => same fingerprint, so a draft edited and
    then edited back is still fresh; any real change makes a stale review detectable."""
    ids = tuple(sorted(set(int(c) for c in class_ids)))
    rows = sorted(_active_allocations(term_id, year_id).filter(classroom_id__in=ids)
                  .values_list('classroom_id', 'subject_id', 'teacher_id'))
    published = sorted(AllocationPublishState.objects.filter(
        term_id=term_id, academic_year_id=year_id, is_published=True, classroom_id__in=ids,
    ).values_list('classroom_id', flat=True))
    return hashlib.sha256(repr((ids, rows, published)).encode('utf-8')).hexdigest()


def get_scope_triples(*, term_id: int, year_id: int, class_ids: Sequence[int]) -> frozenset:
    """The scope's saved contracts as (class_id, teacher_id, subject_id) -- the "after" picture a
    publish hands to the timetable sync."""
    return frozenset(
        _active_allocations(term_id, year_id).filter(classroom_id__in=list(class_ids))
        .values_list('classroom_id', 'teacher_id', 'subject_id')
    )


def review_scope(*, term_id: int, year_id: int, class_ids: Sequence[int]) -> ScopeReviewDTO:
    """Validate a whole publish scope. Load carried by classes OUTSIDE the scope is seeded into the
    validator first, so cross-class rules (a teacher's total streams/lessons/groups, block clashes)
    are checked against the full picture, not just the scope in isolation.

    HARD blockers stop a publish; SOFT ones need the admin's explicit acknowledgement."""
    from school.utils import (
        AllocationValidator, build_grade_subject_block_map, compute_school_allocation_gaps,
        get_subject_block_names,
    )

    ids = tuple(sorted(set(int(c) for c in class_ids)))
    policy = GlobalAllocationPolicy.load()
    blockers = []

    # Fingerprint first: if the data changes mid-scan, the confirm sees a mismatch and fails safe.
    fingerprint = compute_scope_fingerprint(term_id=term_id, year_id=year_id, class_ids=ids)

    for classroom_id in AllocationPublishState.objects.filter(
        term_id=term_id, academic_year_id=year_id, is_published=True, classroom_id__in=ids,
    ).order_by('classroom_id').values_list('classroom_id', flat=True):
        blockers.append(BlockerDTO(
            code='ALREADY_PUBLISHED', severity='HARD', classroom_id=classroom_id,
            message="This class's allocation is already published.", rule_ref='publish.state',
            suggested_fix='Unpublish it first if you need to change it, then publish again.',
        ))

    block_map = build_grade_subject_block_map()
    validator = AllocationValidator(policy, block_map, get_subject_block_names(block_map.values()),
                                    get_quota_map())
    validator.seed_from_existing(
        _active_allocations(term_id, year_id).exclude(classroom_id__in=ids)
        .select_related('classroom', 'subject', 'classroom__grade')
    )

    in_scope = list(
        _active_allocations(term_id, year_id).filter(classroom_id__in=ids)
        .select_related('teacher', 'teacher__user', 'subject', 'classroom', 'classroom__grade')
        .order_by('classroom_id', 'subject_id')
    )
    for allocation in in_scope:
        hard, soft = validate_row(
            validator, teacher=allocation.teacher, subject=allocation.subject,
            target_class=allocation.classroom, term_id=term_id, year_id=year_id,
        )
        if hard:
            blockers.append(hard)
        blockers.extend(soft)

    # validate_and_record only sees rows already recorded, so on a multi-class scope its prep
    # consolidation notice can claim a teacher teaches fewer streams than they finally do. Re-check
    # against every active allocation (in and out of scope) and drop notices that don't hold.
    final_streams = {}
    for classroom_id, grade_id, subject_id, teacher_id in _active_allocations(term_id, year_id).values_list(
        'classroom_id', 'classroom__grade_id', 'subject_id', 'teacher_id',
    ):
        final_streams.setdefault((teacher_id, subject_id, grade_id), set()).add(classroom_id)
    grade_of = {a.classroom_id: a.classroom.grade_id for a in in_scope}
    min_target = getattr(policy, 'min_classes_per_subject', 2)
    blockers = [
        b for b in blockers
        if not (
            b.code == 'PREP_CONSOLIDATION_MISS'
            and len(final_streams.get((b.teacher_id, b.subject_id, grade_of.get(b.classroom_id)), ())) >= min_target
        )
    ]

    classrooms, teachers_by_class = {}, {}
    for allocation in in_scope:
        classrooms[allocation.classroom_id] = allocation.classroom
        teachers_by_class.setdefault(allocation.classroom_id, set()).add(allocation.teacher_id)

    for classroom_id in ids:
        if classroom_id not in classrooms:
            blockers.append(BlockerDTO(
                code='NOTHING_TO_PUBLISH', severity='HARD', classroom_id=classroom_id,
                message='This class has no saved allocations to publish.', rule_ref='publish.scope',
                suggested_fix='Save at least one subject-teacher assignment first.',
            ))

    for classroom_id, classroom in classrooms.items():
        class_teacher_id = classroom.class_teacher_id
        if class_teacher_id and class_teacher_id not in teachers_by_class.get(classroom_id, set()):
            blockers.append(BlockerDTO(
                code='CLASS_TEACHER_UNASSIGNED',
                severity='HARD' if policy.enforcement_mode == 'STRICT' else 'SOFT',
                classroom_id=classroom_id, teacher_id=class_teacher_id,
                message=(f"Class Teacher Violation: the designated class teacher must be assigned to at "
                         f"least one subject in {classroom.name}."),
                rule_ref='policy.class_teacher_required',
                suggested_fix="Assign the class teacher to one of this class's subjects.",
            ))

    scoped = set(ids)
    for gap in sorted(compute_school_allocation_gaps(term_id, year_id), key=lambda g: g['class_id']):
        if gap['class_id'] not in scoped:
            continue
        # The class-teacher entry is already reported as CLASS_TEACHER_UNASSIGNED above.
        missing = [m for m in gap['missing_subjects'] if not m.startswith('class teacher (')]
        if missing:
            blockers.append(BlockerDTO(
                code='INCOMPLETE_CLASS', severity='SOFT', classroom_id=gap['class_id'],
                message=f"{gap['class_name']} still has no teacher for: {', '.join(missing)}.",
                rule_ref='quota.completeness',
                suggested_fix='Assign the missing subjects, or publish now and finish them later.',
            ))

    return ScopeReviewDTO(
        class_ids=ids,
        fingerprint=fingerprint,
        blockers=tuple(blockers),
    )
