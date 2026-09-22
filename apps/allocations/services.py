"""Public service surface for the `allocations` app.

Subject-to-teacher-to-class allocation engine: quotas, blocks, contracts,
splitting rules, global policy.

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet.

This app may import services from:
    - apps.identity.services
    - apps.academics.services

Notably this app does NOT import apps.timetable.services, even though
tasks.py's rollover/bulk-allocate jobs need timetable's sync logic to run
inside the same transaction as an allocations change. Per the plan's
"allocations <-> timetable problem" section: that composition happens one
level up, in orchestration/tasks.py, which is the one place allowed to call
both apps.allocations.services and apps.timetable.services in the same
function body. Do not add a services-level import here to "simplify" that --
it would create a real dependency cycle with `timetable` (which needs an
upward read from `allocations`).

Track B step 6: SubjectQuota/SubjectAllocation/AllocationPublishState/
GlobalAllocationPolicy (and the rest of this app's models) physically
relocated to apps/allocations/models.py -- function bodies below now import
from there directly.
"""
from dataclasses import dataclass
from typing import Optional, Sequence

from django.db import transaction

from apps.allocations.models import SubjectQuota, SubjectAllocation, AllocationPublishState, GlobalAllocationPolicy, SubjectBlock


@dataclass(frozen=True)
class SubjectQuotaDTO:
    id: int
    grade_id: int
    subject_id: int
    total_lessons: int
    double_lessons_required: int
    remedial_lessons_required: int


@dataclass(frozen=True)
class AllocationDTO:
    id: int
    classroom_id: int
    subject_id: int
    teacher_id: int
    academic_year_id: int
    term_id: int
    is_active: bool


@dataclass(frozen=True)
class RolloverResultDTO:
    """Consumed by orchestration/tasks.py's rollover_allocations_task -- pairs
    with apps.timetable.services.sync_with_allocation_changes's
    TimetableSyncResultDTO, per the plan's allocations<->timetable design."""
    blocks_cloned: int
    prior_triples: frozenset
    new_triples: frozenset
    new_allocation_count: int
    skipped_published_classroom_ids: tuple
    warnings: tuple
    scoped_classroom_id: Optional[int]
    scoped_classroom_name: Optional[str]
    scoped_classroom_label: Optional[str]


@dataclass(frozen=True)
class BulkAutoAllocateResultDTO:
    """Consumed by orchestration/tasks.py's bulk_auto_allocate_task -- pairs
    with apps.timetable.services.sync_with_allocation_changes's
    TimetableSyncResultDTO, same as RolloverResultDTO above."""
    total_saved: int
    target_class_ids: tuple
    target_class_names: tuple
    prior_triples: frozenset
    new_triples: frozenset
    per_class_summary: tuple
    classes_with_gaps: tuple
    teachers_near_cap: tuple
    skipped_published: tuple


class AllocationValidationError(Exception):
    """Raised to force-abort a rollover or bulk-auto-allocate run on a hard
    policy violation or an empty/fully-published scope. Relocated from
    school/views/teacherAllocation_view.py's `_RolloverValidationError` --
    orchestration/tasks.py catches this and marks the BackgroundJob FAILURE
    with the message, same as before."""
    pass


def get_quota_map(*, grade_ids: Optional[Sequence[int]] = None) -> dict:
    """Returns {(grade_id, subject_id): total_lessons} -- the exact shape
    tasks.py's rollover/bulk-allocate jobs already build inline today."""
    qs = SubjectQuota.objects.all()
    if grade_ids is not None:
        qs = qs.filter(grade_id__in=grade_ids)
    return {(q.grade_id, q.subject_id): q.total_lessons for q in qs}


def list_quotas(*, grade_id: int) -> Sequence[SubjectQuotaDTO]:
    return tuple(
        SubjectQuotaDTO(
            id=q.id, grade_id=q.grade_id, subject_id=q.subject_id, total_lessons=q.total_lessons,
            double_lessons_required=q.double_lessons_required,
            remedial_lessons_required=q.remedial_lessons_required,
        )
        for q in SubjectQuota.objects.filter(grade_id=grade_id).select_related('subject')
    )


def get_published_classroom_ids(classroom_ids: Sequence[int], term_id: int, year_id: int) -> frozenset:
    """Relocated from school/utils.py's get_published_classroom_ids -- same
    query, DTO-free since it already returns plain IDs."""
    return frozenset(
        AllocationPublishState.objects.filter(
            classroom_id__in=classroom_ids, term_id=term_id, academic_year_id=year_id, is_published=True,
        ).values_list('classroom_id', flat=True)
    )


def publish_allocation(classroom_id: int, term_id: int, year_id: int, operator_id: Optional[int]) -> None:
    """Relocated from school/utils.py's publish_allocation."""
    from django.utils import timezone
    AllocationPublishState.objects.update_or_create(
        classroom_id=classroom_id, term_id=term_id, academic_year_id=year_id,
        defaults={'is_published': True, 'published_at': timezone.now(), 'published_by_id': operator_id},
    )


def lock_publish_state(*, classroom_id: int, academic_year_id: int, term_id: int) -> AllocationPublishState:
    """
    Serializes concurrent allocation mutations for one (classroom, term, year) scope by
    acquiring a row lock on its AllocationPublishState row -- creating it first, as an
    unpublished placeholder, if this is the scope's first-ever mutation. Two concurrent
    requests for the same scope now block on this lock instead of interleaving their
    SubjectAllocation delete+recreate.

    MUST be called from inside an already-open transaction.atomic() block -- the lock is
    released when that transaction commits or rolls back, same as any other
    select_for_update() usage.
    """
    from django.db import IntegrityError

    try:
        with transaction.atomic():
            AllocationPublishState.objects.get_or_create(
                classroom_id=classroom_id, term_id=term_id, academic_year_id=academic_year_id,
                defaults={'is_published': False},
            )
    except IntegrityError:
        pass  # a concurrent caller created it first -- fine, the row exists either way

    return AllocationPublishState.objects.select_for_update().get(
        classroom_id=classroom_id, term_id=term_id, academic_year_id=academic_year_id,
    )


def list_active_allocations(*, classroom_id: Optional[int] = None, term_id: Optional[int] = None, year_id: Optional[int] = None) -> Sequence[AllocationDTO]:
    qs = SubjectAllocation.objects.filter(is_active=True)
    if classroom_id is not None:
        qs = qs.filter(classroom_id=classroom_id)
    if term_id is not None:
        qs = qs.filter(term_id=term_id)
    if year_id is not None:
        qs = qs.filter(academic_year_id=year_id)
    return tuple(
        AllocationDTO(
            id=a.id, classroom_id=a.classroom_id, subject_id=a.subject_id, teacher_id=a.teacher_id,
            academic_year_id=a.academic_year_id, term_id=a.term_id, is_active=a.is_active,
        )
        for a in qs
    )


def get_allocated_teacher_name(*, classroom_id: int, subject_id: int, term_id: int) -> Optional[str]:
    """Returns the display name of the teacher actively allocated to teach
    `subject_id` in `classroom_id` for `term_id`, or None if nobody is.
    Used by apps.analytics.views (SchoolAnalyticsAPIView/
    StudentPerformanceAnalyticsAPIView) so it doesn't need to import
    apps.allocations.models directly -- import-linter forbids that."""
    alloc = SubjectAllocation.objects.filter(
        classroom_id=classroom_id, subject_id=subject_id, term_id=term_id, is_active=True,
    ).select_related('teacher').first()
    return alloc.teacher.get_name if (alloc and alloc.teacher) else None


def rollover_allocations(
    *, source_term_id: int, target_term_id: int, year_id: int, source_year_id: int,
    class_id: Optional[int], operator_id: Optional[int],
) -> RolloverResultDTO:
    """Extracted from school/tasks.py's rollover_allocations_task (the
    orchestration/tasks.py composition-root extraction). Clones SubjectBlocks
    and carries SubjectAllocation rows forward from the source term/year to
    the target term/year, publishing each affected classroom.

    Deliberately does NOT touch the timetable: the caller
    (orchestration/tasks.py) is responsible for feeding this result's
    prior_triples/new_triples into
    apps.timetable.services.sync_with_allocation_changes, in the same
    transaction.atomic() block, per the plan's allocations<->timetable
    composition-root design -- this function must never import
    apps.timetable.services itself (see this module's docstring).

    Raises AllocationValidationError on a hard policy violation (e.g. the
    scoped classroom is already published) -- the caller should catch this
    and mark the job FAILURE with str(e), same behavior as the original
    inline `_RolloverValidationError` handling.
    """
    from apps.academics.models import ClassStream
    from school.utils import build_grade_subject_block_map, get_subject_block_names, AllocationValidator

    scoped_classroom = None
    if class_id:
        scoped_classroom = ClassStream.objects.select_related('grade').get(id=class_id)
        if get_published_classroom_ids([class_id], target_term_id, year_id):
            raise AllocationValidationError(
                "This class's allocation has been published and is locked. "
                "Unpublish it first to roll it over."
            )

    source_blocks = SubjectBlock.objects.filter(
        term_id=source_term_id, academic_year_id=source_year_id
    ).select_related('grade_level')
    if scoped_classroom:
        source_blocks = source_blocks.filter(grade_level=scoped_classroom.grade)
    blocks_cloned = 0
    for old_block in source_blocks:
        new_block, created = SubjectBlock.objects.get_or_create(
            name=old_block.name, grade_level=old_block.grade_level,
            academic_year_id=year_id, term_id=target_term_id,
            defaults={'period_structure': old_block.period_structure}
        )
        if not created and new_block.period_structure != old_block.period_structure:
            new_block.period_structure = old_block.period_structure
            new_block.save(update_fields=['period_structure'])
        new_block.subjects.set(old_block.subjects.all())
        if created:
            blocks_cloned += 1

    target_query = SubjectAllocation.objects.filter(term_id=target_term_id, academic_year_id=year_id)
    if scoped_classroom:
        target_query = target_query.filter(classroom_id=class_id)

    # Whole-term rollover: a class already published in the TARGET term/year is left
    # completely untouched (not deleted, not overwritten) -- the scoped case above
    # already hard-blocks the single-class rollover the same way.
    published_target_ids = set()
    if not scoped_classroom:
        all_target_classroom_ids = set(target_query.values_list('classroom_id', flat=True)) | set(
            SubjectAllocation.objects.filter(
                term_id=source_term_id, academic_year_id=source_year_id, is_active=True
            ).values_list('classroom_id', flat=True)
        )
        published_target_ids = set(get_published_classroom_ids(all_target_classroom_ids, target_term_id, year_id))
        if published_target_ids:
            target_query = target_query.exclude(classroom_id__in=published_target_ids)

    prior_triples = set(target_query.values_list('classroom_id', 'teacher_id', 'subject_id'))
    target_query.delete()

    old_allocations = SubjectAllocation.objects.filter(
        term_id=source_term_id, academic_year_id=source_year_id, is_active=True
    )
    if scoped_classroom:
        old_allocations = old_allocations.filter(classroom_id=class_id)
    elif published_target_ids:
        old_allocations = old_allocations.exclude(classroom_id__in=published_target_ids)
    old_allocations = old_allocations.select_related('classroom__grade', 'subject', 'teacher')

    block_map = build_grade_subject_block_map()
    block_names = get_subject_block_names(block_map.values())
    quota_map = get_quota_map()
    policy = GlobalAllocationPolicy.load()
    validator = AllocationValidator(policy, block_map, block_names, quota_map)

    new_allocations = []
    rollover_warnings = []
    for alloc in old_allocations:
        hard_error, row_warnings = validator.validate_and_record(
            teacher=alloc.teacher, subject=alloc.subject, target_class=alloc.classroom,
            term_id=target_term_id, year_id=year_id
        )
        if hard_error:
            raise AllocationValidationError(hard_error)
        rollover_warnings.extend(row_warnings)
        new_allocations.append(SubjectAllocation(
            classroom_id=alloc.classroom_id,
            subject_id=alloc.subject_id,
            teacher_id=alloc.teacher_id,
            academic_year_id=year_id,
            term_id=target_term_id,
            is_active=True,
        ))

    SubjectAllocation.objects.bulk_create(new_allocations)

    # Rollover writes real, live contracts the same as any other allocation-save path --
    # each affected class is published immediately, consistent with the Matrix save and
    # Bulk Allocate.
    for classroom_id in {a.classroom_id for a in new_allocations}:
        publish_allocation(classroom_id, target_term_id, year_id, operator_id)

    new_triples = {(a.classroom_id, a.teacher_id, a.subject_id) for a in new_allocations}

    return RolloverResultDTO(
        blocks_cloned=blocks_cloned,
        prior_triples=frozenset(prior_triples),
        new_triples=frozenset(new_triples),
        new_allocation_count=len(new_allocations),
        skipped_published_classroom_ids=tuple(published_target_ids),
        warnings=tuple(set(rollover_warnings)),
        scoped_classroom_id=scoped_classroom.id if scoped_classroom else None,
        scoped_classroom_name=scoped_classroom.name if scoped_classroom else None,
        scoped_classroom_label=f"{scoped_classroom.grade.name} {scoped_classroom.name}" if scoped_classroom else None,
    )


def bulk_auto_allocate(
    *, grade_id: Optional[int], term_id: int, year_id: int,
    explicit_class_ids: Optional[Sequence[int]], operator_id: Optional[int],
) -> BulkAutoAllocateResultDTO:
    """Extracted from school/tasks.py's bulk_auto_allocate_task (the
    orchestration/tasks.py composition-root extraction). Auto-drafts
    teacher-subject-class contracts for every class in scope, leaving each
    class in DRAFT (never auto-published -- an admin reviews/adjusts in the
    Matrix and publishes explicitly via Save Grid, same as the manual
    single-class flow).

    Deliberately does NOT touch the timetable, same reasoning as
    rollover_allocations above -- returns prior_triples/new_triples for the
    caller to feed into apps.timetable.services.sync_with_allocation_changes.

    Raises AllocationValidationError if the scope resolves to zero classes,
    or every class in scope is already published -- the caller should catch
    this and mark the job FAILURE with str(e).
    """
    from apps.identity.models import TeacherExtra
    from apps.academics.models import ClassStream
    from school.utils import (
        build_grade_subject_block_map, get_subject_block_names, AllocationValidator,
        reserve_class_teacher_slot, fill_remaining_subjects,
        get_subjects_with_active_virtual_groups, get_virtual_stream_subject,
    )

    if explicit_class_ids:
        target_classes = list(
            ClassStream.live.filter(id__in=explicit_class_ids).select_related('grade', 'class_teacher')
        )
    else:
        # Includes both physical streams AND this grade's virtual elective split
        # groups -- a virtual group is a real teaching unit with its own contract to
        # fill, not something Bulk Allocate should skip.
        target_classes = list(
            ClassStream.live.filter(grade_id=grade_id).select_related('grade', 'class_teacher')
        )

    if not target_classes:
        raise AllocationValidationError("No class streams found for the given scope.")

    # A class already published for this term/year is finalized -- skip it rather than
    # aborting the whole grade/selection, and report it back so the admin knows it was
    # left untouched on purpose, not forgotten.
    published_ids = get_published_classroom_ids([c.id for c in target_classes], term_id, year_id)
    skipped_published = [c for c in target_classes if c.id in published_ids]
    target_classes = [c for c in target_classes if c.id not in published_ids]

    if not target_classes:
        raise AllocationValidationError(
            "Every class in this scope is already published. Unpublish at least one to run this."
        )

    target_class_ids = [c.id for c in target_classes]

    policy = GlobalAllocationPolicy.load()
    quota_map = get_quota_map()

    required_subjects_by_class = {}
    all_subject_ids = set()
    split_subject_ids_by_grade = {}
    for c in target_classes:
        if c.is_virtual:
            # A virtual group only ever needs its own one subject (see
            # get_virtual_stream_subject) -- it has no SubjectQuota row of its own.
            subject = get_virtual_stream_subject(c)
            subs = [subject] if subject else []
        else:
            quotas = SubjectQuota.objects.filter(grade=c.grade).select_related('subject') \
                .order_by('subject__display_order', 'subject__name')
            split_subject_ids = split_subject_ids_by_grade.setdefault(
                c.grade_id, get_subjects_with_active_virtual_groups(c.grade_id))
            subs = [q.subject for q in quotas if q.subject_id not in split_subject_ids]
        required_subjects_by_class[c.id] = subs
        all_subject_ids.update(s.id for s in subs)

    active_teachers = list(TeacherExtra.objects.filter(status=True))
    teacher_qualified_map = {}
    for row in TeacherExtra.objects.filter(
            status=True, qualified_subjects__id__in=all_subject_ids
    ).values('id', 'qualified_subjects__id'):
        teacher_qualified_map.setdefault(row['id'], set()).add(row['qualified_subjects__id'])

    grade_ids = list({c.grade_id for c in target_classes})
    block_map = build_grade_subject_block_map(grade_ids=grade_ids)
    block_names = get_subject_block_names(block_map.values())

    baseline_allocations = list(SubjectAllocation.objects.filter(
        term_id=term_id, academic_year_id=year_id, is_active=True
    ).exclude(classroom_id__in=target_class_ids).select_related('classroom', 'subject', 'classroom__grade'))

    validator = AllocationValidator(policy, block_map, block_names, quota_map)
    validator.seed_from_existing(baseline_allocations)

    teacher_subject_classes = {}
    for alloc in baseline_allocations:
        teacher_subject_classes.setdefault(alloc.teacher_id, {}).setdefault(
            alloc.subject_id, []).append(alloc.classroom)

    reserved_by_class = {}
    for c in target_classes:
        reserved_subject_id, entry = reserve_class_teacher_slot(
            validator=validator, target_class=c, required_subjects=required_subjects_by_class[c.id],
            teacher_qualified_map=teacher_qualified_map, teacher_subject_classes=teacher_subject_classes,
            term_id=term_id, year_id=year_id
        )
        reserved_by_class[c.id] = (reserved_subject_id, entry)

    class_drafts = {}
    for c in target_classes:
        reserved_subject_id, entry = reserved_by_class[c.id]
        entries = ([entry] if entry else []) + fill_remaining_subjects(
            validator=validator, target_class=c, required_subjects=required_subjects_by_class[c.id],
            reserved_subject_id=reserved_subject_id, teacher_qualified_map=teacher_qualified_map,
            active_teachers=active_teachers, teacher_subject_classes=teacher_subject_classes,
            policy=policy, term_id=term_id, year_id=year_id
        )
        class_drafts[c.id] = entries

    per_class_summary = []
    total_saved = 0
    batch_prior_triples = set()
    batch_new_triples = set()
    for c in target_classes:
        entries = class_drafts[c.id]
        new_pairs = [(e['subject_id'], e['teacher_id']) for e in entries if e.get('teacher_id')]
        unresolved_count = sum(1 for e in entries if not e.get('teacher_id'))

        prior_pairs = set(SubjectAllocation.objects.filter(
            classroom=c, term_id=term_id, academic_year_id=year_id, is_active=True
        ).values_list('teacher_id', 'subject_id'))
        batch_prior_triples.update((c.id, t_id, s_id) for t_id, s_id in prior_pairs)
        batch_new_triples.update((c.id, t_id, s_id) for s_id, t_id in new_pairs)

        SubjectAllocation.objects.filter(
            classroom=c, term_id=term_id, academic_year_id=year_id
        ).delete()
        SubjectAllocation.objects.bulk_create([
            SubjectAllocation(classroom=c, subject_id=s_id, teacher_id=t_id,
                              academic_year_id=year_id, term_id=term_id, is_active=True)
            for s_id, t_id in new_pairs
        ])

        # Bulk Allocate writes real contracts but leaves the class in DRAFT -- an admin
        # reviews/adjusts each class in the Matrix and only publishing happens on that
        # explicit Save Grid click, same as the manual single-class flow. Auto-publishing
        # here (the old behavior) meant a one-click grade-wide sweep could lock in
        # mistakes before anyone reviewed them.

        total_saved += len(new_pairs)
        per_class_summary.append({
            "class_id": c.id,
            "class_name": f"{c.grade.name} {c.name}",
            "assigned": len(new_pairs),
            "unresolved": unresolved_count,
            "class_teacher_assigned": (
                reserved_by_class[c.id][0] is not None or not c.class_teacher_id
            ),
        })

    teacher_by_id = {t.id: t for t in active_teachers}
    load_report = []
    for t_id, load in validator.teacher_weekly_lessons.items():
        if policy.max_weekly_lessons and load >= policy.max_weekly_lessons * 0.8:
            teacher = teacher_by_id.get(t_id)
            load_report.append({
                "teacher_name": teacher.get_name if teacher else f"Teacher {t_id}",
                "weekly_lessons": load,
                "cap": policy.max_weekly_lessons,
            })
    load_report.sort(key=lambda x: -x['weekly_lessons'])

    classes_with_gaps = [c for c in per_class_summary if c['unresolved'] or not c['class_teacher_assigned']]

    return BulkAutoAllocateResultDTO(
        total_saved=total_saved,
        target_class_ids=tuple(target_class_ids),
        target_class_names=tuple(c.name for c in target_classes),
        prior_triples=frozenset(batch_prior_triples),
        new_triples=frozenset(batch_new_triples),
        per_class_summary=tuple(per_class_summary),
        classes_with_gaps=tuple(classes_with_gaps),
        teachers_near_cap=tuple(load_report),
        skipped_published=tuple(
            {"class_id": c.id, "class_name": f"{c.grade.name} {c.name}"} for c in skipped_published
        ),
    )


def get_global_policy() -> dict:
    """Returns the singleton GlobalAllocationPolicy's fields as a plain dict
    -- kept loose (not a frozen dataclass) since AllocationValidator
    (school/utils.py) currently consumes many of its fields directly and a
    full 1:1 DTO isn't needed until that validator itself moves here in
    Track B."""
    policy = GlobalAllocationPolicy.load()
    return {
        'max_subjects_per_class': policy.max_subjects_per_class,
        'max_classes_per_subject': policy.max_classes_per_subject,
        'min_classes_per_subject': policy.min_classes_per_subject,
        'enforce_prep_consolidation': policy.enforce_prep_consolidation,
    }
