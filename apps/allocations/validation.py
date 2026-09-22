"""
Shared BlockerDTO shape for every allocation mutation path (manual Matrix save, rollover, and
future callers), wrapping the existing school.utils.AllocationValidator so every caller reports
violations in one consistent shape instead of hand-rolling its own error/warning list.

This module does NOT change AllocationValidator's rules or its message text -- only how a
caller reports the result. See docs/superpowers/specs/2026-09-21-teacher-allocation-timetable-
settings-design.md section 4 ("One validator, every mutation path").

AllocationValidator itself still lives in school.utils (not yet relocated into apps/) -- callers
of validate_row() construct it themselves (see school.utils.AllocationValidator's own
constructor) and pass the instance in here; this module never imports school.utils itself, so it
carries no import-linter risk.
"""
from dataclasses import dataclass
from typing import List, Optional, Tuple


@dataclass(frozen=True)
class BlockerDTO:
    code: str
    severity: str  # "HARD" or "SOFT"
    message: str
    teacher_id: Optional[int] = None
    subject_id: Optional[int] = None
    classroom_id: Optional[int] = None
    rule_ref: str = ""
    suggested_fix: str = ""

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "severity": self.severity,
            "message": self.message,
            "teacher_id": self.teacher_id,
            "subject_id": self.subject_id,
            "classroom_id": self.classroom_id,
            "rule_ref": self.rule_ref,
            "suggested_fix": self.suggested_fix,
        }


# Maps a distinctive prefix/substring already present in AllocationValidator's existing message
# strings to a stable machine-readable code + rule_ref, without changing any of that wording (so
# every existing test/caller that asserts on the message text is unaffected).
_MESSAGE_CODE_MAP: Tuple[Tuple[str, str, str], ...] = (
    ("Block Clash:", "BLOCK_CLASH", "policy.block_synchronization"),
    ("Class Teacher Violation:", "CLASS_TEACHER_UNASSIGNED", "policy.class_teacher_required"),
    ("Grade Violation:", "CROSS_GRADE_NOT_ALLOWED", "policy.allow_cross_grade_teaching"),
    ("Optimization Notice:", "PREP_CONSOLIDATION_MISS", "policy.min_classes_per_subject"),
    ("Consolidation Notice:", "PREP_CONSOLIDATION_DROP", "policy.min_classes_per_subject"),
    ("exceeded max subjects", "MAX_SUBJECTS_PER_CLASS", "policy.max_subjects_per_class"),
    ("exceeded max streams", "MAX_CLASSES_PER_SUBJECT", "policy.max_classes_per_subject"),
    ("Burnout Warning:", "WEEKLY_CAP_EXCEEDED", "policy.max_weekly_lessons"),
    ("Preparation Warning:", "MAX_CLASS_GROUPS_EXCEEDED", "policy.max_total_class_groups"),
)


def _code_and_rule_ref(message: str) -> Tuple[str, str]:
    for needle, code, rule_ref in _MESSAGE_CODE_MAP:
        if needle in message:
            return code, rule_ref
    return "POLICY_VIOLATION", "policy"


def validate_row(
    validator, *, teacher, subject, target_class, term_id, year_id, dry_run: bool = False
) -> Tuple[Optional[BlockerDTO], List[BlockerDTO]]:
    """
    Wraps AllocationValidator.validate_and_record with the same signature and the same running-
    state side effects (a returned hard blocker means the row was NOT committed into the
    validator's running state, exactly as validate_and_record already behaves), converting its
    (str | None, list[str]) result into (BlockerDTO | None, list[BlockerDTO]).
    """
    hard_error, warnings = validator.validate_and_record(
        teacher=teacher, subject=subject, target_class=target_class,
        term_id=term_id, year_id=year_id, dry_run=dry_run,
    )
    hard_blocker = None
    if hard_error:
        code, rule_ref = _code_and_rule_ref(hard_error)
        hard_blocker = BlockerDTO(
            code=code, severity="HARD", message=hard_error,
            teacher_id=teacher.id, subject_id=subject.id, classroom_id=target_class.id,
            rule_ref=rule_ref,
        )
    soft_blockers = []
    for msg in warnings:
        code, rule_ref = _code_and_rule_ref(msg)
        soft_blockers.append(BlockerDTO(
            code=code, severity="SOFT", message=msg,
            teacher_id=teacher.id, subject_id=subject.id, classroom_id=target_class.id,
            rule_ref=rule_ref,
        ))
    return hard_blocker, soft_blockers
