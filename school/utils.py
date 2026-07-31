import random
from datetime import timedelta

from school.models.classSubjects_models import SubjectAllocation, ClassStream, SubjectBlock, SubjectQuota, Subject
from school.models.chat_models import ThreadParticipant
from school.models.models import AttendanceRecord, GradingRule, ExamEvent, ExamResult
from school.models.timetable_models import TimeSlot, LessonAllocation, Timetable
from school.models.teachers_model import TeacherStructuralAvailability
from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Avg, Count, F, Q
from django.core.cache import cache
from django.utils import timezone

DASHBOARD_ATTENDANCE_WINDOW_DAYS = 30


def is_tech_subject(subject, grade):
    """
    Identifies if a subject is part of a Technical Block (Shared Lecture Hall) — i.e.
    whether it's routed through the shared/synchronized elective-splitting engine.
    Ensures the allocation engine speaks the same language as the timetable generator.
    Moved here (from teacherAllocation_view.py) so AllocationValidator below can share it
    without a circular import.

    Config-driven: this reads Subject.requires_synchronized_grade_blocking (set per subject
    from Curriculum Hub) instead of matching on the subject's name or department string, so
    adding a new subject or department never requires touching this function. The optional
    Subject.synchronized_blocking_min_grade lets a subject opt in only from a given grade
    upward (e.g. a subject only offered from a certain grade shouldn't force shared-block
    scheduling below it).
    """
    if not subject or not grade or not subject.requires_synchronized_grade_blocking:
        return False

    min_grade = subject.synchronized_blocking_min_grade
    if min_grade is not None and grade.numeric_order < min_grade:
        return False

    return True


def get_attendance_summary(student):
    """Rolling attendance percentage for a student, shared by the student/parent dashboard-overview APIs."""
    cutoff = timezone.now().date() - timedelta(days=DASHBOARD_ATTENDANCE_WINDOW_DAYS)
    records = AttendanceRecord.objects.filter(student=student, session__date__gte=cutoff)
    total = records.count()
    present = records.filter(status__in=['Present', 'Late']).count()
    return {
        "present": present,
        "total": total,
        "percentage": round((present / total) * 100, 1) if total else None,
    }


def get_unread_message_count(user):
    return ThreadParticipant.objects.filter(
        user=user, thread__is_active=True
    ).filter(
        Q(last_read_timestamp__isnull=True) | Q(last_read_timestamp__lt=F('thread__updated_at'))
    ).count()


def get_class_stream_name(class_stream):
    return f"{class_stream.grade.name} {class_stream.name}" if class_stream else "Unassigned"


def build_grade_subject_block_map(grade_ids=None):
    """
    Returns {(grade_id, subject_id): block_id} so callers can resolve which
    SubjectBlock (if any) a subject belongs to for a SPECIFIC grade, instead of
    the old global Subject.subject_block_id (which ignored grade entirely and
    let one grade's block assignment silently steal a subject from another
    grade's block).
    """
    qs = SubjectBlock.objects.all()
    if grade_ids is not None:
        qs = qs.filter(grade_level_id__in=grade_ids)

    result = {}
    for row in qs.values('id', 'grade_level_id', 'subjects__id'):
        if row['subjects__id'] is not None:
            result[(row['grade_level_id'], row['subjects__id'])] = row['id']
    return result


def get_subject_block_names(block_ids):
    """Bulk id->name lookup for SubjectBlock, to pair with build_grade_subject_block_map."""
    return dict(SubjectBlock.objects.filter(id__in=[b for b in block_ids if b]).values_list('id', 'name'))


def get_block_period_structures(block_ids):
    """
    Bulk id->period_structure lookup ('ALL_DOUBLE' | 'ALL_SINGLE' | 'MIXED'), to pair with
    build_grade_subject_block_map. Lets the quota and timetable generators decide whether a
    blocked subject's lessons should be forced fully-double, fully-single, or left to each
    subject's own quota split.
    """
    return dict(SubjectBlock.objects.filter(id__in=[b for b in block_ids if b]).values_list('id', 'period_structure'))


def get_subjects_with_active_virtual_groups(grade_id):
    """
    Subject ids in this grade that already have at least one live virtual split group (see
    api_execute_allocation_splits). Once a subject is routed through virtual groups, THOSE
    groups are the sole real teaching unit for it — a physical stream's own SubjectQuota entry
    for the same subject must not also demand its own separate teacher contract, since that
    would need its own simultaneous timetable slot for the same shared teacher and collide with
    the virtual group's slot (LessonAllocation only allows one (timetable, time_slot) per
    teacher). Callers should exclude these subject ids from a PHYSICAL stream's required-subject
    list; virtual streams are unaffected (they only ever require their own one subject anyway).
    """
    from school.models.classSubjects_models import ClassStream, Subject

    names = ClassStream.live.filter(grade_id=grade_id, is_virtual=True).values_list('name', flat=True)
    subject_names = {n.split(' - Group')[0].strip() for n in names}
    if not subject_names:
        return set()
    return set(Subject.objects.filter(name__in=subject_names).values_list('id', flat=True))


def get_virtual_stream_subject(stream):
    """
    The single subject a virtual elective split group (e.g. "Agriculture - Group 1") was
    created for. Virtual streams are never given a SubjectQuota row of their own — they exist
    purely to hold the split-out enrollment for one subject — so anything that needs "what
    subject does this class need a teacher for" has to derive it from the naming convention
    instead of a quota lookup. Returns None if the name doesn't match any real Subject.
    """
    from school.models.classSubjects_models import Subject

    subject_name = stream.name.split(' - ')[0].strip()
    return Subject.objects.filter(name__iexact=subject_name).first()


def get_published_classroom_ids(classroom_ids, term_id, year_id):
    """
    Which of these classrooms already have a PUBLISHED allocation for this term/year — every
    allocation-mutating path (Matrix save, Auto-Allocate, Bulk Allocate, Rollover, Clear Grid)
    calls this first so a finalized, published schedule can't be silently overwritten by a
    later run. A class with no AllocationPublishState row at all is still in draft (freely
    editable) — that model only ever gets a row once a class has been published at least once.
    """
    from school.models.classSubjects_models import AllocationPublishState

    return set(AllocationPublishState.objects.filter(
        classroom_id__in=classroom_ids, term_id=term_id, academic_year_id=year_id, is_published=True
    ).values_list('classroom_id', flat=True))


def publish_allocation(classroom_id, term_id, year_id, user):
    """
    Marks one class's allocation as published for this term/year — called right after any
    endpoint successfully commits real SubjectAllocation rows (matching the user's own framing:
    "it is changed from draft to published when hit saved"). Idempotent: publishing an
    already-published class just refreshes who/when.
    """
    from school.models.classSubjects_models import AllocationPublishState

    AllocationPublishState.objects.update_or_create(
        classroom_id=classroom_id, term_id=term_id, academic_year_id=year_id,
        defaults={
            'is_published': True,
            'published_at': timezone.now(),
            'published_by': user if (user and getattr(user, 'is_authenticated', False)) else None,
        }
    )


def unpublish_allocation(classroom_id, term_id, year_id):
    """Reverts one class's allocation back to draft, re-opening it for edits."""
    from school.models.classSubjects_models import AllocationPublishState

    AllocationPublishState.objects.filter(
        classroom_id=classroom_id, term_id=term_id, academic_year_id=year_id
    ).update(is_published=False, published_at=None, published_by=None)


class AllocationValidator:
    """
    Shared workload/eligibility/block-clash validation for teacher-subject-class contracts.
    Used by both the manual Allocation Matrix save and Rollover so the two paths can never
    drift apart — previously Rollover skipped almost every check the Matrix enforced, and the
    Matrix's own block-clash check only looked within the single class being saved, missing
    clashes against other classes in the same grade.

    Usage: construct once per "session" (one Matrix POST, or one whole-grade Rollover run),
    optionally seed it with existing allocations that should count toward running totals via
    seed_from_existing(), then call validate_and_record() once per (teacher, subject, class)
    row being proposed. Each call mutates internal running state as it goes — like committing
    rows one at a time — so later calls correctly see earlier ones' impact.
    """

    def __init__(self, policy, block_map, block_names, quota_map):
        self.policy = policy
        self.block_map = block_map
        self.block_names = block_names
        self.quota_map = quota_map
        self.teacher_weekly_lessons = {}      # teacher_id -> int
        self.teacher_total_groups = {}        # teacher_id -> set(class_ids)
        self.teacher_shared_blocks = {}        # teacher_id -> set((grade_id, subject_id))
        # block_id -> {teacher_id: (subject_id, subject_name)} — grade-wide. Same teacher
        # appearing for the SAME subject across multiple streams is the normal, expected way a
        # synchronized block gets recorded (one teacher, one lesson, one row per home stream) —
        # only a DIFFERENT subject for the same teacher in the same block is a real clash
        # (physically can't teach two different block subjects at the same synchronized time).
        self.block_teacher_tracker = {}
        self.teacher_subject_count_per_class = {}  # (class_id, teacher_id) -> count
        # (teacher_id, subject_id) -> {classroom_id: grade_id}. In-memory mirror of "who else is
        # already teaching this subject, and where" so validate_and_record can answer the
        # cross-grade/other-class checks below without a fresh DB query on every single candidate
        # it's asked to score — with dozens of teachers x subjects x classes in a bulk run, that
        # query-per-candidate pattern was the actual scalability ceiling (thousands of queries for
        # one run), not any of the ranking logic itself.
        self.teacher_subject_classrooms = {}
        self._grade_stream_count_cache = {}  # grade_id -> count of real (non-virtual) streams
        # (grade_id, subject_id) -> teacher_id. A shared-block (or PE/allows_multiclass)
        # subject is physically ONE synchronized session every home stream attends together —
        # "one teacher, one lesson, one row per home stream" (see _is_shared_block below) — so
        # once a teacher is on record for it in a grade, they're the only correct pick for
        # every other stream needing it, independent of prep-consolidation/reshuffling, which
        # is a separate concern about ordinary (non-synchronized) subjects.
        self.shared_subject_teacher = {}
        # Real-capacity awareness: the timetable generator (views_timetable.py) can only ever fit a
        # teacher into a slot that physically exists and isn't structurally blacked out for them —
        # policy.max_weekly_lessons alone doesn't know that, so a "policy-legal" allocation can still
        # be impossible to actually schedule. Loaded once per validator session (one query each),
        # not per candidate, matching teacher_subject_classrooms' no-query-per-candidate pattern above.
        self._total_capacity_slots = TimeSlot.objects.filter(is_global=False).count()
        self._teacher_blackout_counts = dict(
            TeacherStructuralAvailability.objects.values_list('teacher_id').annotate(c=Count('id')).values_list('teacher_id', 'c')
        )

    def _effective_weekly_cap(self, teacher_id):
        """
        The real ceiling for one teacher: total time slots in the week minus their personal
        structural blackouts, minus a configurable safety buffer (GlobalAllocationPolicy.
        timetable_capacity_buffer_percent) to account for fatigue rules (consecutive-period caps,
        heavy-day thresholds, subject spacing) that this validator doesn't model precisely — modeling
        those exactly would mean re-running the timetable generator's own placement logic during
        allocation, which is a much bigger undertaking (see Phase B in the allocation/timetable
        integration plan). Whichever of this or the flat policy cap is lower wins, so admins can still
        set a stricter policy number if they want to.
        """
        blackout = self._teacher_blackout_counts.get(teacher_id, 0)
        real_ceiling = max(0, self._total_capacity_slots - blackout)
        buffer_pct = getattr(self.policy, 'timetable_capacity_buffer_percent', 0)
        buffered_ceiling = int(real_ceiling * (100 - buffer_pct) / 100)
        return min(self.policy.max_weekly_lessons, buffered_ceiling)

    def _grade_stream_count(self, grade_id):
        if grade_id not in self._grade_stream_count_cache:
            self._grade_stream_count_cache[grade_id] = ClassStream.live.filter(
                grade_id=grade_id, is_virtual=False
            ).count()
        return self._grade_stream_count_cache[grade_id]

    def _is_shared_block(self, subject, grade):
        # The REAL, authoritative signal is whether this (grade, subject) pair is actually
        # registered in a SubjectBlock — matching the same source of truth the timetable
        # generator uses. is_tech_subject() alone only reflects the subject-level
        # requires_synchronized_grade_blocking config flag, regardless of whether THIS grade
        # has an actual block configured — treating a second, unsynchronized stream's lesson
        # as "free" (zero added weekly-lesson cost) purely because of that flag, which
        # silently under-counts a teacher's real load and lets them slip past the weekly cap.
        # PE / an explicit allows_multiclass flag are still honored even without a formal
        # block, since those are genuinely meant to be co-taught (one teacher, one shared
        # session).
        if self.block_map.get((grade.id, subject.id)) is not None:
            return True
        sub_name_lower = subject.name.lower() if subject else ""
        is_pe = sub_name_lower in ('physical education', 'pe', 'p.e.') or 'physical education' in sub_name_lower
        return getattr(subject, 'allows_multiclass', False) or is_pe

    def seed_from_existing(self, allocations_qs):
        """
        Pre-load running totals from a queryset of existing SubjectAllocation rows
        (expects select_related('subject', 'classroom__grade')) so subsequent
        validate_and_record() calls correctly treat them as already-committed load.
        """
        for alloc in allocations_qs:
            t_id, s_id, c_id = alloc.teacher_id, alloc.subject_id, alloc.classroom_id
            grade = alloc.classroom.grade
            g_id = grade.id
            lessons = self.quota_map.get((g_id, s_id), 0)
            is_shared = self._is_shared_block(alloc.subject, grade)

            self.teacher_total_groups.setdefault(t_id, set()).add(c_id)

            if is_shared:
                block_key = (g_id, s_id)
                t_memory = self.teacher_shared_blocks.setdefault(t_id, set())
                if block_key not in t_memory:
                    self.teacher_weekly_lessons[t_id] = self.teacher_weekly_lessons.get(t_id, 0) + lessons
                    t_memory.add(block_key)
                # Only real streams count toward "the" incumbent teacher — a virtual split
                # group (see api_execute_allocation_splits) exists specifically BECAUSE one
                # shared teacher/timeslot no longer covers every enrolled student, so each
                # split group is meant to get its own teacher, not be locked to this one.
                if not alloc.classroom.is_virtual:
                    self.shared_subject_teacher.setdefault(block_key, t_id)
            else:
                self.teacher_weekly_lessons[t_id] = self.teacher_weekly_lessons.get(t_id, 0) + lessons

            block_id = self.block_map.get((g_id, s_id))
            if block_id is not None:
                self.block_teacher_tracker.setdefault(block_id, {})[t_id] = (s_id, alloc.subject.name)

            self.teacher_subject_classrooms.setdefault((t_id, s_id), {})[c_id] = g_id

            key = (c_id, t_id)
            self.teacher_subject_count_per_class[key] = self.teacher_subject_count_per_class.get(key, 0) + 1

    def validate_and_record(self, *, teacher, subject, target_class, term_id, year_id, dry_run=False):
        """
        Validates one proposed (teacher, subject, target_class) contract row against every
        policy rule. If not hard-rejected, commits it into running state so the NEXT row's
        checks see it. Returns (hard_error_message_or_None, [warning_message, ...]). A hard
        error means the caller should abort/reject the whole save in STRICT mode — the row is
        NOT recorded into running state when a hard error is returned.

        dry_run=True evaluates the row (including grade-wide block clash and load caps against
        CURRENT running state) without committing it — lets a caller like the auto-draft
        algorithm score several candidate teachers for the same subject before actually picking
        and committing a winner, while still reusing the exact same rules the manual save uses.
        """
        warnings = []
        t_id, s_id, c_id = teacher.id, subject.id, target_class.id
        grade = target_class.grade
        g_id = grade.id
        teacher_name = teacher.get_name

        is_shared_block = self._is_shared_block(subject, grade)
        block_id = self.block_map.get((g_id, s_id))

        # Max subjects per class
        count_key = (c_id, t_id)
        already_this_row = self.teacher_subject_count_per_class.get(count_key, 0)
        prospective_count = already_this_row + 1
        if prospective_count > self.policy.max_subjects_per_class:
            msg = f"{teacher_name} exceeded max subjects ({self.policy.max_subjects_per_class}) per class."
            if self.policy.enforcement_mode == 'STRICT':
                return msg, warnings
            warnings.append(msg)

        # Grade-wide block clash (block_map is already grade-scoped, so block_id only
        # resolves for the target grade's own blocks — cross-grade collisions can't occur).
        # Only a DIFFERENT subject within the same block is a real clash — the same teacher
        # teaching the SAME subject across multiple streams is the normal way a synchronized
        # block gets recorded (one teacher, one lesson, one row per home stream).
        if block_id is not None:
            existing = self.block_teacher_tracker.get(block_id, {}).get(t_id)
            if existing is not None and existing[0] != s_id:
                return (f"Block Clash: {teacher_name} is already teaching {existing[1]} in the "
                        f"{self.block_names.get(block_id, 'shared')} block and cannot also teach "
                        f"{subject.name} at the same synchronized time."), warnings

        # In-memory instead of a DB query: teacher_subject_classrooms is seeded up front from
        # every existing allocation for this term/year (see seed_from_existing) and kept in sync
        # as this validator commits each new pick, so it's always an accurate live picture without
        # re-querying the database for every candidate this function is asked to score.
        existing_classrooms = self.teacher_subject_classrooms.get((t_id, s_id), {})
        other_classroom_grades = {cid: gid for cid, gid in existing_classrooms.items() if cid != c_id}
        other_count = len(other_classroom_grades)
        # max_classes_per_subject ("at most N streams of the same subject") is a PER-GRADE rule,
        # not a school-wide total — a teacher covering 2 streams of Biology in Grade 7 and 2 more
        # in Grade 8 hasn't over-concentrated on Biology anywhere, they're just teaching it in two
        # grades (exactly what allow_cross_grade_teaching exists to permit). Counting `other_count`
        # globally used to let a teacher's Grade 8 load silently block them from Grade 7 streams of
        # the same subject once cross-grade teaching was allowed, since the raw total hit the cap
        # before either grade individually did.
        other_count_same_grade = sum(1 for gid in other_classroom_grades.values() if gid == g_id)

        target_min = getattr(self.policy, 'min_classes_per_subject', 2)
        # Same "only pays off with a genuine extra stream to spare" gate as fill_remaining_subjects
        # below — a grade with at most target_min streams total can't hit the target without
        # collapsing every stream onto one teacher, so the notice would just nag on every pick.
        if (getattr(self.policy, 'enforce_prep_consolidation', True)
                and self._grade_stream_count(g_id) > target_min):
            total_streams_assigned = other_count_same_grade + 1
            if total_streams_assigned < target_min:
                warnings.append(
                    f"Optimization Notice: {teacher_name} will only be teaching {total_streams_assigned} "
                    f"stream(s) of {subject.name}, which misses your {target_min}-stream preparation target."
                )

        if not is_shared_block and other_count_same_grade >= self.policy.max_classes_per_subject:
            msg = (f"{teacher_name} exceeded max streams ({self.policy.max_classes_per_subject}) "
                   f"of {subject.name} in {grade.name}.")
            if self.policy.enforcement_mode == 'STRICT':
                return msg, warnings
            warnings.append(msg)

        if not self.policy.allow_cross_grade_teaching and other_count:
            for o_grade_id in other_classroom_grades.values():
                if o_grade_id != g_id:
                    msg = f"Grade Violation: {teacher_name} is teaching {subject.name} across different grades."
                    if self.policy.enforcement_mode == 'STRICT':
                        return msg, warnings
                    warnings.append(msg)
                    break

        base_new_lessons = self.quota_map.get((g_id, s_id), 0)
        current_lessons = self.teacher_weekly_lessons.get(t_id, 0)
        t_shared_blocks = self.teacher_shared_blocks.setdefault(t_id, set())
        block_key = (g_id, s_id)
        actual_new_lessons = 0 if (is_shared_block and block_key in t_shared_blocks) else base_new_lessons

        effective_cap = self._effective_weekly_cap(t_id)
        if current_lessons + actual_new_lessons > effective_cap:
            if effective_cap < self.policy.max_weekly_lessons:
                msg = (f"Burnout Warning: {teacher_name} exceeds their real timetable capacity of "
                       f"{effective_cap} weekly lessons (limited by structural availability/buffer, "
                       f"below the {self.policy.max_weekly_lessons}-lesson policy cap).")
            else:
                msg = f"Burnout Warning: {teacher_name} exceeds the max {effective_cap} weekly lessons limit."
            if self.policy.enforcement_mode == 'STRICT':
                return msg, warnings
            warnings.append(msg)

        t_groups_set = self.teacher_total_groups.setdefault(t_id, set())
        if c_id not in t_groups_set:
            if not is_shared_block and len(t_groups_set) + 1 > self.policy.max_total_class_groups:
                msg = (f"Preparation Warning: {teacher_name} exceeds the max "
                       f"{self.policy.max_total_class_groups} unique class groups limit.")
                if self.policy.enforcement_mode == 'STRICT':
                    return msg, warnings
                warnings.append(msg)

        if dry_run:
            return None, warnings

        # Commit to running state
        self.teacher_weekly_lessons[t_id] = current_lessons + actual_new_lessons
        t_groups_set.add(c_id)
        if is_shared_block:
            t_shared_blocks.add(block_key)
            if not target_class.is_virtual:
                self.shared_subject_teacher.setdefault(block_key, t_id)
        if block_id is not None:
            self.block_teacher_tracker.setdefault(block_id, {})[t_id] = (s_id, subject.name)
        self.teacher_subject_classrooms.setdefault((t_id, s_id), {})[c_id] = g_id
        self.teacher_subject_count_per_class[count_key] = prospective_count

        return None, warnings


def reserve_class_teacher_slot(*, validator, target_class, required_subjects, teacher_qualified_map,
                                teacher_subject_classes, term_id, year_id):
    """
    Tries to commit the class's designated class teacher onto one of its own required
    subjects, BEFORE any general per-subject filling runs. A class teacher left unassigned in
    their own homeroom fails a hard "Class Teacher Violation" check at save time — giving them
    only a ranking priority BOOST (the old approach) doesn't guarantee they actually win a slot,
    so the whole class's draft could end up unsavable even though every other subject was fine.

    Returns (reserved_subject_id_or_None, draft_entry_or_None). Call this for every class in a
    batch BEFORE calling fill_remaining_subjects for any of them — reserving every class
    teacher's slot first prevents an unrelated class's ordinary subject need (e.g. "we need
    someone for English") from consuming a class teacher's weekly-lesson capacity before their
    own homeroom gets a turn, which is exactly what starves them out in a single-class-at-a-time
    or badly-ordered batch run.
    """
    designated_class_teacher = target_class.class_teacher
    if not designated_class_teacher:
        return None, None

    for subject in required_subjects:
        if subject.id not in teacher_qualified_map.get(designated_class_teacher.id, set()):
            continue
        hard_error, warnings = validator.validate_and_record(
            teacher=designated_class_teacher, subject=subject, target_class=target_class,
            term_id=term_id, year_id=year_id, dry_run=True
        )
        if hard_error:
            continue
        validator.validate_and_record(
            teacher=designated_class_teacher, subject=subject, target_class=target_class,
            term_id=term_id, year_id=year_id, dry_run=False
        )
        teacher_subject_classes.setdefault(designated_class_teacher.id, {}).setdefault(
            subject.id, []).append(target_class)
        return subject.id, {
            "subject_id": subject.id,
            "teacher_id": designated_class_teacher.id,
            "status": "Success",
            "warnings": warnings,
        }

    return None, None


def fill_remaining_subjects(*, validator, target_class, required_subjects, reserved_subject_id,
                             teacher_qualified_map, active_teachers, teacher_subject_classes,
                             policy, term_id, year_id):
    """
    Greedy candidate-ranking pass for every required subject NOT already reserved (see
    reserve_class_teacher_slot). Every candidate is scored via a tiered priority tuple —
    prep-consolidation magnet, fewest soft-policy warnings, grade-stream penalty, then overall
    workload — and the winner is committed for real into `validator` so later subjects in this
    same call (and any later classes sharing the same validator, in a bulk run) see the updated
    state. Returns the list of draft entries for this class's non-reserved subjects.
    """
    target_grade_id = target_class.grade_id
    target_min = getattr(policy, 'min_classes_per_subject', 2)
    # Prep consolidation only pays for itself when the grade has MORE streams than the
    # target — e.g. concentrating one teacher onto 2 of 3 streams genuinely spares them a
    # third prep. When the grade has AT MOST target_min streams, one teacher covering all of
    # them costs the same number of distinct preps as splitting the streams across several
    # qualified teachers, so forcing consolidation here only blocks reshuffling for no benefit.
    enforce_prep = (getattr(policy, 'enforce_prep_consolidation', True)
                     and validator._grade_stream_count(target_grade_id) > target_min)
    draft_allocations = []

    for subject in required_subjects:
        if subject.id == reserved_subject_id:
            continue
        candidates = []  # [(priority_tuple, teacher, dry_run_warnings)]

        for teacher in active_teachers:
            if subject.id not in teacher_qualified_map.get(teacher.id, set()):
                continue

            hard_error, warnings = validator.validate_and_record(
                teacher=teacher, subject=subject, target_class=target_class,
                term_id=term_id, year_id=year_id, dry_run=True
            )
            if hard_error:
                continue

            # The "Optimization Notice" (prep-consolidation) warning restates the exact same
            # signal prep_consolidation_priority already scores further down this tuple — counting
            # it here too let it sneak back in at a much higher tier than intended. Concretely: a
            # teacher who happens to already teach this subject in ANOTHER grade (from baseline
            # data) never trips the notice, while every genuinely fresh candidate does, so ranking
            # by raw warning count silently favored whoever's cross-grade history cleared the
            # notice — the exact repetition reshuffling is supposed to catch — regardless of how
            # many streams of THIS grade's subject they already hold. Real rule warnings (burnout,
            # cross-grade violation, max-subjects) still count; only this one optimization hint is
            # excluded from ranking (it's still shown to the admin via `warnings` below).
            rankable_warning_count = sum(1 for w in warnings if not w.startswith('Optimization Notice'))

            classes_taught_this_subject = teacher_subject_classes.get(teacher.id, {}).get(subject.id, [])
            grade_streams_count = len([c for c in classes_taught_this_subject if c.grade_id == target_grade_id])
            # A virtual split group (see api_execute_allocation_splits) is deliberately NOT
            # part of the shared synchronized session anymore — it exists precisely because one
            # shared teacher/timeslot stopped covering everyone, so it doesn't get the shared-
            # block treatment even though its subject is registered in the grade's block.
            # Reuses validator._is_shared_block (not just a block_map lookup) so PE and any other
            # allows_multiclass subject rank the same way here as they're actually scored in
            # validate_and_record — a block_map-only check here previously missed PE (which has
            # no formal SubjectBlock row), so shared_block_priority never locked it onto one
            # incumbent teacher for ranking purposes, even though validate_and_record already
            # treated it as a zero-extra-cost shared session.
            is_shared_block = (not target_class.is_virtual
                                and validator._is_shared_block(subject, target_class.grade))

            total_streams_assigned = len(classes_taught_this_subject)
            prep_consolidation_priority = 1
            if enforce_prep and 0 < total_streams_assigned < target_min:
                prep_consolidation_priority = 0

            grade_stream_penalty = 0 if is_shared_block else grade_streams_count
            # Reshuffle strength: how many streams of THIS subject the teacher already holds in
            # OTHER grades (e.g. already the Biology teacher for 7N, now being scored for 8N).
            # grade_stream_penalty above only looks within the target grade (intentionally, since
            # it cooperates with prep-consolidation there) — this is the separate, always-on
            # signal that discourages the same teacher becoming "the" pick for a subject across
            # every grade in the school by default, so reshuffling spreads work across the
            # qualified pool instead of converging on whoever ranked best once.
            other_grade_repeat_penalty = 0 if is_shared_block else (total_streams_assigned - grade_streams_count)
            # Real workload, not just a class-group count: teacher_weekly_lessons already reflects
            # this teacher's full existing load across every OTHER subject they teach (seeded from
            # real allocations), so preferring the lower figure here actively spreads the load
            # across the staff instead of piling more periods onto whoever already ranks best on
            # the tiers above — this is what keeps one teacher from being quietly overloaded while
            # others sit idle, which is also what starves the downstream timetable generator of
            # free slots and forces it into clashes it can't resolve.
            current_workload = validator.teacher_weekly_lessons.get(teacher.id, 0)
            # Capacity-aware refinement of current_workload: two teachers can carry the same raw
            # lesson count but have very different REAL headroom left — e.g. one has structural
            # blackouts eating into their usable slots. Preferring more remaining headroom (a more
            # negative value here) spreads load by what a teacher can actually still absorb on the
            # real timetable grid, not just by a raw count, which is also what keeps the downstream
            # timetable generator from being handed a teacher who's nominally "light" but has no
            # real slots left to give.
            remaining_capacity_penalty = current_workload - validator._effective_weekly_cap(teacher.id)
            global_workload = len(validator.teacher_total_groups.get(teacher.id, set()))

            # Shared-block continuity: a technical/synchronized-block subject is ONE lesson
            # every stream in the grade attends together at the same timeslot, so whoever
            # already has it in this grade is the only physically correct pick for the next
            # stream too — this is independent of (and takes priority over) prep-consolidation/
            # reshuffling, which only concerns ordinary, non-synchronized subjects.
            shared_block_incumbent = validator.shared_subject_teacher.get((target_grade_id, subject.id))
            shared_block_priority = 0 if (is_shared_block and teacher.id == shared_block_incumbent) else 1

            # No class-teacher boost here on purpose: reserve_class_teacher_slot (called
            # before this function) already guarantees the class teacher gets one subject in
            # their own homeroom. Giving them a further priority tier for every OTHER subject
            # too would stack extra subjects onto them just for being the class teacher, which
            # isn't a requirement — they should compete for anything beyond their guaranteed
            # slot on the same footing as everyone else.
            # Reshuffle signals (grade_stream_penalty, other_grade_repeat_penalty) rank ahead of
            # raw workload/capacity, not behind it — a lexicographic tuple lets an EARLIER tier
            # completely override a LATER one, so putting workload first (a prior version of this
            # code did) let a subject "specialist" who teaches nothing else keep winning every
            # stream of their one subject on workload alone, since a light OVERALL load doesn't
            # mean they aren't already repeated on THIS subject — e.g. a teacher already covering
            # 4 of 5 Biology streams still looks "available" by raw weekly lessons if Biology is
            # literally the only thing they teach, so nothing ever pushed the picker off them.
            # Repetition-avoidance has to be checked before availability, not after, for
            # reshuffling to mean anything. prep_consolidation_priority stays demoted at the
            # bottom (a soft nudge for otherwise-tied candidates, not a magnet).
            priority = (
                shared_block_priority,
                rankable_warning_count,
                grade_stream_penalty,
                other_grade_repeat_penalty,
                remaining_capacity_penalty,
                current_workload,
                prep_consolidation_priority,
                global_workload,
            )
            candidates.append((priority, teacher, warnings))

        if candidates:
            random.shuffle(candidates)
            candidates.sort(key=lambda c: c[0])
            _, chosen_teacher, chosen_warnings = candidates[0]

            validator.validate_and_record(
                teacher=chosen_teacher, subject=subject, target_class=target_class,
                term_id=term_id, year_id=year_id, dry_run=False
            )
            teacher_subject_classes.setdefault(chosen_teacher.id, {}).setdefault(
                subject.id, []).append(target_class)

            draft_allocations.append({
                "subject_id": subject.id,
                "teacher_id": chosen_teacher.id,
                "status": "Success",
                "warnings": chosen_warnings,
            })
        else:
            draft_allocations.append({
                "subject_id": subject.id,
                "teacher_id": "",
                "status": "Limits Reached"
            })

    return draft_allocations


def max_consecutive_run(occupied_positions, candidate_positions):
    """
    Given a set of period-positions (0-based, in a single day's schedule order) already
    occupied and a set of candidate positions about to be added, returns the length of the
    longest unbroken run of consecutive positions that would result. Shared by the manual
    single-lesson save path and the bulk auto-generator so both apply the same fatigue rule.
    """
    combined = sorted(set(occupied_positions) | set(candidate_positions))
    if not combined:
        return 0
    longest = current = 1
    for i in range(1, len(combined)):
        if combined[i] == combined[i - 1] + 1:
            current += 1
            longest = max(longest, current)
        else:
            current = 1
    return longest


def get_scaled_score(marks_obtained, exam):
    """
    Converts a raw mark into a percentage of the exam's own configured total_marks.
    Exams aren't always out of 100 (a CAT might be set up out of 30 or 50) — this is the
    single source of truth for that conversion. It replaces the old per-view pattern of
    checking `'cat 1' in exam.name.lower()` and multiplying by a hardcoded 2, which only
    scaled exams literally named "cat 1", assumed (without checking) that they were always
    out of exactly 50, and silently left every other non-100 exam completely unscaled.
    """
    if marks_obtained is None:
        return None

    total = exam.total_marks or 100
    if total <= 0:
        total = 100

    percentage = (Decimal(str(marks_obtained)) / Decimal(str(total))) * Decimal('100')
    return percentage.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def get_applicable_students(subject, classroom, academic_year):
    """
    Resolves the roster a subject actually applies to, instead of assuming every student
    in a classroom takes every subject (only true for core subjects). Electives only narrow
    down to students with an Approved StudentSubjectEnrollment for that subject/year — but
    ONLY once the school has actually started recording choices for that subject in that
    grade. If nobody has ever been enrolled in it there, the school isn't using per-student
    choice tracking for it yet (it's still being taught to the whole class the old way), so
    falling back to zero students would look like a system outage rather than a real "nobody
    takes this" state. Once real enrollment rows exist for a subject/grade, this correctly
    narrows the roster to just the students who chose it.

    By design, when `classroom` is a virtual elective stream (e.g. "French - Group 1"), the
    roster resolves to every approved enrollee for the subject across the WHOLE grade, not just
    that one teaching group — Group 1/Group 2/etc are a scheduling/capacity split for the
    timetable engine only; for exams and results the school wants "French" treated as a single
    subject, not fragmented per group.
    """
    from school.models.models import StudentExtra
    from school.models.classSubjects_models import StudentSubjectEnrollment, get_effective_is_core

    if classroom.is_virtual:
        base_students = StudentExtra.objects.filter(cl__grade=classroom.grade, status=True)
    else:
        base_students = StudentExtra.objects.filter(cl=classroom, status=True)

    if get_effective_is_core(subject, classroom.grade.curriculum, classroom.grade.tier):
        return base_students

    grade_enrollments = StudentSubjectEnrollment.objects.filter(
        subject=subject, academic_year=academic_year, student__cl__grade=classroom.grade
    )
    if not grade_enrollments.exists():
        return base_students

    approved_ids = grade_enrollments.filter(status='Approved').values_list('student_id', flat=True)
    return base_students.filter(id__in=approved_ids)


def resolve_classroom_students(classroom, academic_year=None):
    """
    "Which students are in this classroom", for views that need a roster without already
    knowing a specific subject (Broadsheet, Missing Marks Verification). For a real homeroom
    class this is just its active students. For a virtual elective stream (e.g. "French -
    Group 1"), naively filtering StudentExtra.cl == classroom returns nothing — no student's
    `cl` is ever set to a virtual stream, since those exist only to attach a teacher/timeslot
    for the timetable engine, split into groups purely for teaching capacity. This resolves the
    stream back to its real Subject (same "name before ' - Group N'" convention used by
    AllocationMatrixAPIView) and defers to get_applicable_students, which already treats every
    group of that subject in the grade as one — so it doesn't matter which specific group's
    ClassStream row was passed in, the roster is always the whole grade's real "French" class.
    """
    from school.models.models import StudentExtra, AcademicYear
    from school.models.classSubjects_models import Subject

    if not classroom.is_virtual:
        return StudentExtra.objects.filter(cl=classroom, status=True)

    subject_name = classroom.name.split(' - Group')[0].strip()
    subject = Subject.objects.filter(name__iexact=subject_name).first()
    if not subject:
        return StudentExtra.objects.none()

    if academic_year is None:
        academic_year = AcademicYear.objects.filter(is_active=True).first()

    return get_applicable_students(subject, classroom, academic_year)


def calculate_dynamic_grade(score, curriculum_type='8-4-4'):
    """
    Evaluates a numeric score against the database GradingRules.
    Falls back to a standard 8-4-4 scale if the database is empty.
    """
    if score is None:
        return "-"

    # Attempt to fetch dynamic rules from the database
    rules = GradingRule.objects.filter(curriculum=curriculum_type).order_by('-min_score')

    if rules.exists():
        for rule in rules:
            if rule.min_score <= score <= rule.max_score:
                return rule.grade_label

    # Fallback if no rules are configured in the admin panel yet
    if score >= 80:
        return 'A'
    elif score >= 75:
        return 'A-'
    elif score >= 70:
        return 'B+'
    elif score >= 65:
        return 'B'
    elif score >= 60:
        return 'B-'
    elif score >= 50:
        return 'C+'
    elif score >= 40:
        return 'C'
    else:
        return 'E'

def get_teacher_exam_clearance(user, class_id, subject_id=None, exam_id=None):
    """
    Evaluates a user's access level for a specific class/subject.
    Automatically tightens security as the school's data matures.
    """
    # 1. System Admins always get a master pass
    if user.is_staff or user.is_superuser:
        return True, "Admin"

    # Safely get the teacher profile
    teacher_profile = getattr(user, 'teacherextra', None)
    if not teacher_profile:
        return False, "Unauthorized"

    try:
        class_stream = ClassStream.objects.get(id=class_id)
    except ClassStream.DoesNotExist:
        return False, "Class Not Found"

    # 2. FALLBACK LEVEL: Is this the Class Teacher?
    if class_stream.class_teacher == teacher_profile:
        return True, "Class_Teacher"

    # 3. STRICT LEVEL: Is this the officially allocated Subject Teacher? When a specific
    # subject_id is given, clearance is scoped to that one subject (marks entry). When it's
    # omitted — viewing a whole-class report card/roster isn't pinned to one subject — clearance
    # is granted if the teacher has ANY active allocation in this class for the exam's term.
    # Previously a caller with no subject_id (e.g. the Report Cards roster fetch) always fell
    # through to "Denied" here regardless of a real allocation, so a legitimately allocated
    # subject teacher could never even view a class's report cards, only its actual Class
    # Teacher could — even though the class was correctly listed as theirs to work with
    # everywhere else (ExamSelectionDataView's own class dropdown already includes it).
    term_filter = {}
    if exam_id:
        try:
            exam = ExamEvent.objects.select_related('term').get(id=exam_id)
            term_filter['term'] = exam.term
        except ExamEvent.DoesNotExist:
            pass

    allocation_qs = SubjectAllocation.objects.filter(
        classroom=class_stream, teacher=teacher_profile, is_active=True, **term_filter
    )
    if subject_id:
        allocation_qs = allocation_qs.filter(subject_id=subject_id)

    if allocation_qs.exists():
        return True, "Subject_Teacher"

    return False, "Denied"


# =========================================================================================
# ✨ STEP 4 ADDITION: Subject Performance Telemetry Builder
# =========================================================================================
def calculate_subject_metrics(class_stream, subject, exam, multiplier=Decimal('1.0')):
    """
    Calculates the precise class stream average for a specific subject and exam event.
    Enables side-by-side UX comparisons (Student Mark vs Class Average).
    """
    # Query the database for the average mark of active students in this specific class stream
    raw_avg = ExamResult.objects.filter(
        exam=exam,
        subject=subject,
        student__cl=class_stream,
        student__status=True
    ).aggregate(avg_score=Avg('marks_obtained'))['avg_score']

    if raw_avg is None:
        return {"class_average": 0.0}

    # Apply scaling multiplier (e.g., doubling a CAT 1 that was entered out of 50)
    scaled_avg = Decimal(str(raw_avg)) * multiplier
    final_avg = scaled_avg.quantize(Decimal('0.00'), rounding=ROUND_HALF_UP)

    return {"class_average": float(final_avg)}


def compute_student_telemetry(student, current_exam, current_mean):
    """
    Scans the historical timeline of a student's results to compute their velocity
    (Are they improving, dropping, or stable compared to their last report card?).
    """
    # Grab the student's most recently published exam result prior to the current one
    previous_result_stamp = ExamResult.objects.filter(
        student=student
    ).exclude(exam=current_exam).order_by('-exam__published_at').first()

    if not previous_result_stamp:
        # First term/exam for this student, no historical velocity can be calculated yet
        return {"historical_velocity": 0.0, "trajectory": "Stable"}

    previous_exam = previous_result_stamp.exam

    # Gather all marks from that historical exam event to reconstruct the old mean
    past_results = ExamResult.objects.filter(student=student, exam=previous_exam)

    total_past_marks = Decimal('0.00')
    past_subjects_count = 0

    for res in past_results:
        scaled = get_scaled_score(res.marks_obtained, previous_exam)
        if scaled is not None:
            total_past_marks += scaled
            past_subjects_count += 1

    if past_subjects_count == 0:
        return {"historical_velocity": 0.0, "trajectory": "Stable"}

    past_mean = (total_past_marks / past_subjects_count).quantize(Decimal('0.00'), rounding=ROUND_HALF_UP)

    # Calculate Velocity: Current Term Mean minus Previous Term Mean
    velocity = Decimal(str(current_mean)) - past_mean
    velocity_float = float(velocity.quantize(Decimal('0.00'), rounding=ROUND_HALF_UP))

    if velocity_float > 0:
        trajectory = "Improving"
    elif velocity_float < 0:
        trajectory = "Declining"
    else:
        trajectory = "Stable"

    return {
        "historical_velocity": velocity_float,
        "trajectory": trajectory
    }


def calculate_dynamic_grade_details(score, curriculum_type='8-4-4'):
    """
    Companion to calculate_dynamic_grade. Returns a detailed dictionary containing
    both the Grade Label and the Admin's configured remarks for that threshold.
    """
    if score is None:
        return {"label": "-", "remarks": ""}

    rules = GradingRule.objects.filter(curriculum=curriculum_type).order_by('-min_score')

    if rules.exists():
        for rule in rules:
            if rule.min_score <= score <= rule.max_score:
                return {
                    "label": rule.grade_label,
                    "remarks": rule.remarks or "Satisfactory performance."
                }

    # Dynamic fallback mapping if the Admin hasn't seeded grading rules yet
    default_label = calculate_dynamic_grade(score, curriculum_type)
    default_remarks = "Excellent results." if score >= 75 else ("Good effort." if score >= 50 else "Requires revision.")

    return {"label": default_label, "remarks": default_remarks}


def cache_unscheduled_basket_errors(timetable_id, error_list):
    """
    PURPOSE: Injects or flushes allocation failures inside Django's high-speed memory architecture.
    USE: Internal helper tool that replaces persistent database notification table mutations.
    """
    cache_key = f"timetable_errors_{timetable_id}"
    if error_list:
        # Retention window locked to 48 hours (172800 seconds) to prevent stale server clutter
        cache.set(cache_key, error_list, timeout=172800)
    else:
        # Explicitly purge keys if the engine achieves a zero-error clean run
        cache.delete(cache_key)


def get_cached_unscheduled_errors(timetable_id, stream_names=None):
    """
    Reads back whatever the timetable generator last cached via cache_unscheduled_basket_errors, so
    an allocation-saving endpoint can tell an admin "this class/subject failed to schedule last run"
    right when they're deciding how to fix it, instead of that only surfacing inside the Timetable
    module after the fact with no link back to the allocation decision that caused it.

    Messages are free text built for a human to read (e.g. "North: 2 lesson period(s) could not be
    scheduled..."), not structured records — so when stream_names is given this is a best-effort
    substring filter, not an exact lookup. Good enough for "does anything here look relevant", not
    meant to be precise across two different grades that happen to share a stream name.
    """
    errors = cache.get(f"timetable_errors_{timetable_id}") or []
    if not stream_names:
        return errors
    return [msg for msg in errors if any(name in msg for name in stream_names)]


def compute_school_allocation_gaps(term_id, year_id):
    """
    School-wide "is every class fully staffed" check, generalizing the exact unresolved/gap
    logic BulkAutoAllocateAPIView already proves out per-batch (teacherAllocation_view.py) —
    but run across every ClassStream in the term/year, not just a submitted batch. Used to gate
    Timetable generation/publish: a schedule built on an incomplete allocation is guaranteed to
    have holes, so the Timetable refuses to run until this returns an empty list.

    Real streams require every subject in their grade's SubjectQuota. Virtual (split-group)
    streams only ever legitimately need the one subject they were split for — checking them
    against their grade's full quota list would flag every core subject they were never meant
    to have, exactly the false-positive noise generate_lessons_for_scope already guards against
    for virtual streams elsewhere.

    Returns a list of {class_id, class_name, missing_subjects: [str, ...]} — empty means the
    whole school is fully allocated for this term/year.
    """
    real_streams = list(ClassStream.live.filter(is_virtual=False).select_related('grade', 'class_teacher'))
    virtual_streams = list(ClassStream.live.filter(is_virtual=True).select_related('grade'))

    # Once a subject is routed through virtual split groups, those groups are the sole real
    # teaching unit for it (see get_subjects_with_active_virtual_groups) — a physical stream's
    # SubjectQuota entry for the same subject must not also be treated as a gap here, matching
    # the same exclusion BulkAutoAllocateAPIView and AutoAllocateDraftAPIView already apply when
    # actually assigning teachers. Without this, this gate would demand every physical stream get
    # its own separate contract for a subject it was never meant to have one for.
    split_subject_ids_by_grade = {
        grade_id: get_subjects_with_active_virtual_groups(grade_id)
        for grade_id in {s.grade_id for s in real_streams}
    }

    quotas_by_grade = {}
    for q in SubjectQuota.objects.filter(grade_id__in={s.grade_id for s in real_streams}).select_related('subject'):
        if q.subject_id in split_subject_ids_by_grade.get(q.grade_id, set()):
            continue
        quotas_by_grade.setdefault(q.grade_id, []).append(q.subject)

    allocated_pairs = set()
    allocated_classroom_teachers = set()
    for classroom_id, subject_id, teacher_id in SubjectAllocation.objects.filter(
        term_id=term_id, academic_year_id=year_id, is_active=True
    ).values_list('classroom_id', 'subject_id', 'teacher_id'):
        allocated_pairs.add((classroom_id, subject_id))
        allocated_classroom_teachers.add((classroom_id, teacher_id))

    gaps = []

    for stream in real_streams:
        missing = [
            subject.name for subject in quotas_by_grade.get(stream.grade_id, [])
            if (stream.id, subject.id) not in allocated_pairs
        ]
        class_teacher_missing = (
            stream.class_teacher_id is not None
            and (stream.id, stream.class_teacher_id) not in allocated_classroom_teachers
        )
        if missing or class_teacher_missing:
            reasons = list(missing)
            if class_teacher_missing:
                reasons.append(f"class teacher ({stream.class_teacher.get_name}) not assigned to any subject")
            gaps.append({
                "class_id": stream.id,
                "class_name": f"{stream.grade.name} {stream.name}",
                "missing_subjects": reasons,
            })

    for stream in virtual_streams:
        subject_name = stream.name.split(' - ')[0].strip()
        target_subject = Subject.objects.filter(name__iexact=subject_name).first()
        if target_subject and (stream.id, target_subject.id) not in allocated_pairs:
            gaps.append({
                "class_id": stream.id,
                "class_name": stream.name,
                "missing_subjects": [target_subject.name],
            })

    return gaps