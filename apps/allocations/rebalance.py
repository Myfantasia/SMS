"""Read-only rebalance proposal: find a scope's current blockers (reusing publish_gate.review_scope,
the exact same check a publish would run) and, for each HARD blocker that names a specific
(classroom, subject, teacher), search for a qualified alternative teacher using the same scorer
Auto-Allocate uses (school.utils.rank_candidates) -- propose the best alternative that would
actually resolve the blocker, or leave it listed as unresolved if nobody qualifies.

propose_rebalance itself never writes anything. confirm_rebalance (below, in this same module) is
the only thing that applies a proposal, and only after re-checking the same fingerprint
propose_rebalance computes -- see that function's own docstring for why.

school.utils names are imported lazily inside propose_rebalance, matching the existing precedent
in apps.allocations.publish_gate.review_scope and apps.allocations.services.
"""
from dataclasses import dataclass
from typing import Optional, Sequence, Tuple

from apps.allocations import publish_gate
from apps.allocations.models import GlobalAllocationPolicy, SubjectAllocation
from apps.allocations.services import get_quota_map
from apps.allocations.validation import BlockerDTO


@dataclass(frozen=True)
class RebalanceMoveDTO:
    classroom_id: int
    subject_id: int
    from_teacher_id: Optional[int]
    to_teacher_id: int
    reason: str
    resolves_blocker_code: str


@dataclass(frozen=True)
class RebalanceProposalDTO:
    class_ids: Tuple[int, ...]
    fingerprint: str
    moves: Tuple[RebalanceMoveDTO, ...]
    unresolved_blockers: Tuple[BlockerDTO, ...]
    blockers_before: Tuple[BlockerDTO, ...]


# Blocker codes that name one (classroom, subject, teacher) triple directly caused by who's
# currently assigned -- these are the only ones a teacher swap can plausibly fix. Codes like
# NOTHING_TO_PUBLISH or ALREADY_PUBLISHED describe the scope itself, not a bad teacher pick, and
# are deliberately left alone.
_FIXABLE_CODES = frozenset({
    'MAX_SUBJECTS_PER_CLASS', 'MAX_CLASSES_PER_SUBJECT', 'WEEKLY_CAP_EXCEEDED',
    'MAX_CLASS_GROUPS_EXCEEDED', 'BLOCK_CLASH', 'CROSS_GRADE_NOT_ALLOWED',
})


def propose_rebalance(*, term_id: int, year_id: int, class_ids: Sequence[int]) -> RebalanceProposalDTO:
    # NOTE: TeacherExtra is imported lazily here (not just for the school.utils precedent, but
    # because it's a genuine new need) -- see apps/allocations/rebalance's ignore_imports entry
    # in .importlinter, added alongside this module for the same reason apps.allocations.services
    # already has one: finding an ALTERNATIVE teacher (one not already on any in-scope row) needs
    # a fresh query across every active teacher, not just the ones already loaded off existing
    # SubjectAllocation rows, so it can't be satisfied from already-select_related() instances the
    # way the target classroom below is.
    from apps.identity.models import TeacherExtra
    from school.utils import (
        AllocationValidator, build_grade_subject_block_map, get_subject_block_names, rank_candidates,
    )

    review = publish_gate.review_scope(term_id=term_id, year_id=year_id, class_ids=class_ids)
    ids = review.class_ids

    fixable = [
        b for b in review.blockers
        if b.severity == 'HARD' and b.code in _FIXABLE_CODES
        and b.classroom_id is not None and b.subject_id is not None and b.teacher_id is not None
    ]
    unresolved = list(review.blockers)

    if not fixable:
        return RebalanceProposalDTO(
            class_ids=ids, fingerprint=review.fingerprint, moves=(),
            unresolved_blockers=tuple(unresolved), blockers_before=review.blockers,
        )

    in_scope_rows = list(
        SubjectAllocation.objects.filter(term_id=term_id, academic_year_id=year_id, is_active=True,
                                         classroom_id__in=ids)
        .select_related('teacher', 'subject', 'classroom', 'classroom__grade')
    )
    outside_scope_rows = list(
        SubjectAllocation.objects.filter(term_id=term_id, academic_year_id=year_id, is_active=True)
        .exclude(classroom_id__in=ids)
        .select_related('teacher', 'subject', 'classroom', 'classroom__grade')
    )

    policy = GlobalAllocationPolicy.load()
    block_map = build_grade_subject_block_map()
    validator = AllocationValidator(
        policy, block_map, get_subject_block_names(block_map.values()), get_quota_map(),
    )
    validator.seed_from_existing(outside_scope_rows)
    # Seed in-scope rows too, EXCLUDING the specific (classroom, subject) pairs being rebalanced,
    # so the validator's running totals reflect everything else in the scope while still letting
    # us evaluate a fresh pick for the pairs actually being fixed.
    fixable_pairs = {(b.classroom_id, b.subject_id) for b in fixable}
    validator.seed_from_existing(
        r for r in in_scope_rows if (r.classroom_id, r.subject_id) not in fixable_pairs
    )

    qualified_subject_ids = {b.subject_id for b in fixable}
    teacher_qualified_map = {}
    for row in TeacherExtra.objects.filter(
        status=True, qualified_subjects__id__in=qualified_subject_ids,
    ).values('id', 'qualified_subjects__id'):
        teacher_qualified_map.setdefault(row['id'], set()).add(row['qualified_subjects__id'])
    active_teachers = list(TeacherExtra.objects.filter(status=True))

    teacher_subject_classes = {}
    for r in list(outside_scope_rows) + [
        r for r in in_scope_rows if (r.classroom_id, r.subject_id) not in fixable_pairs
    ]:
        teacher_subject_classes.setdefault(r.teacher_id, {}).setdefault(r.subject_id, []).append(r.classroom)

    moves = []
    for blocker in fixable:
        subject_row = next(
            (r for r in in_scope_rows if r.classroom_id == blocker.classroom_id
             and r.subject_id == blocker.subject_id), None)
        if subject_row is None:
            continue
        classroom = subject_row.classroom

        candidates = rank_candidates(
            validator=validator, subject=subject_row.subject, target_class=classroom,
            teacher_qualified_map=teacher_qualified_map, active_teachers=active_teachers,
            teacher_subject_classes=teacher_subject_classes, policy=policy,
            term_id=term_id, year_id=year_id,
        )
        winner = next((teacher for _priority, teacher, _warnings in candidates
                       if teacher.id != blocker.teacher_id), None)
        if winner is None:
            continue

        moves.append(RebalanceMoveDTO(
            classroom_id=blocker.classroom_id, subject_id=blocker.subject_id,
            from_teacher_id=blocker.teacher_id, to_teacher_id=winner.id,
            reason=f"Moves {subject_row.subject.name} in {classroom.name} to a teacher with headroom, "
                   f"resolving: {blocker.message}",
            resolves_blocker_code=blocker.code,
        ))
        teacher_subject_classes.setdefault(winner.id, {}).setdefault(blocker.subject_id, []).append(classroom)
        # Commit the winner into the validator's LOCAL running state (dry_run=False) -- the exact
        # same pattern fill_remaining_subjects uses for sequential picks within one call -- so the
        # NEXT blocker's rank_candidates call correctly sees this proposed-but-uncommitted move as
        # consumed capacity. Without this, two different blockers that both naturally resolve to
        # the same best-ranked teacher could each independently look free, letting the proposal
        # recommend a pair of moves that together breach policy (e.g. both push the same teacher
        # over max_subjects_per_class or their weekly cap) even though neither looked bad alone.
        # validator is local to this function call and never persisted or returned, so this only
        # advances in-memory ranking/hard-check state -- nothing is written to the database, and
        # propose_rebalance stays genuinely read-only.
        validator.validate_and_record(
            teacher=winner, subject=subject_row.subject, target_class=classroom,
            term_id=term_id, year_id=year_id, dry_run=False,
        )
        unresolved = [b for b in unresolved if b is not blocker]

    return RebalanceProposalDTO(
        class_ids=ids, fingerprint=review.fingerprint, moves=tuple(moves),
        unresolved_blockers=tuple(unresolved), blockers_before=review.blockers,
    )


class StaleProposalError(Exception):
    pass


@dataclass(frozen=True)
class RebalanceResultDTO:
    class_ids: Tuple[int, ...]
    moves_applied: int


def confirm_rebalance(
    *, term_id: int, year_id: int, class_ids: Sequence[int], proposal_fingerprint: str,
    operator_id: Optional[int],
) -> RebalanceResultDTO:
    """Applies a previously-proposed rebalance to the DRAFT only -- no timetable sync, no publish
    state change (Publish, not Rebalance, is what finalizes a draft -- see publish_gate/orchestration.publish).
    Re-runs propose_rebalance under lock and compares its fresh fingerprint against the one the
    admin actually reviewed; a mismatch means the draft changed in between, so this refuses rather
    than silently applying a stale plan."""
    from django.db import transaction

    from apps.allocations.services import lock_publish_state
    from apps.core import services as core_services

    ids = tuple(sorted(set(int(c) for c in class_ids)))
    with transaction.atomic():
        for classroom_id in ids:
            lock_publish_state(classroom_id=classroom_id, term_id=term_id, academic_year_id=year_id)

        fresh = propose_rebalance(term_id=term_id, year_id=year_id, class_ids=ids)
        if fresh.fingerprint != proposal_fingerprint:
            raise StaleProposalError(
                "This draft changed since the rebalance was proposed. Propose it again before confirming."
            )

        for move in fresh.moves:
            SubjectAllocation.objects.filter(
                classroom_id=move.classroom_id, subject_id=move.subject_id,
                term_id=term_id, academic_year_id=year_id, is_active=True,
            ).update(teacher_id=move.to_teacher_id)

        core_services.write_audit_log(
            operator_id=operator_id, action_type='UPDATE', module='AllocationRebalance',
            description=(
                f"Rebalanced {len(fresh.moves)} contract(s) across {len(ids)} class(es) "
                f"(term {term_id}, year {year_id}): "
                + "; ".join(f"{m.subject_id}@{m.classroom_id} -> teacher {m.to_teacher_id}" for m in fresh.moves)
                + "."
            ),
        )

        from datetime import datetime, timezone

        from apps.identity import services as identity_services
        from shared.events.allocation_rebalance_events import AllocationRebalancedEvent
        from shared.events.bus import bus

        teacher_ids = {m.to_teacher_id for m in fresh.moves}
        event = AllocationRebalancedEvent(
            term_id=term_id, year_id=year_id, class_ids=ids, moves_applied=len(fresh.moves),
            teacher_user_ids=identity_services.get_teacher_user_ids(teacher_ids),
            operator_id=operator_id, occurred_at=datetime.now(timezone.utc),
        )
        transaction.on_commit(lambda: bus.publish(event), robust=True)

    return RebalanceResultDTO(class_ids=ids, moves_applied=len(fresh.moves))
