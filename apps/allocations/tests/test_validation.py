from django.test import SimpleTestCase

from apps.allocations.validation import BlockerDTO, validate_row


class _FakeTeacher:
    def __init__(self, id):
        self.id = id


class _FakeSubject:
    def __init__(self, id):
        self.id = id


class _FakeClass:
    def __init__(self, id):
        self.id = id


class _StubValidator:
    """Returns a canned (hard_error, warnings) pair, matching the real
    AllocationValidator.validate_and_record signature, without needing any database fixtures."""

    def __init__(self, hard_error=None, warnings=None):
        self._hard_error = hard_error
        self._warnings = warnings or []
        self.calls = []

    def validate_and_record(self, *, teacher, subject, target_class, term_id, year_id, dry_run=False):
        self.calls.append((teacher.id, subject.id, target_class.id, dry_run))
        return self._hard_error, list(self._warnings)


class ValidateRowTests(SimpleTestCase):
    def test_hard_error_becomes_hard_blocker_dto(self):
        validator = _StubValidator(
            hard_error=(
                "Block Clash: Jane is already teaching Biology in the Science block and "
                "cannot also teach Chemistry at the same synchronized time."
            )
        )
        hard, soft = validate_row(
            validator, teacher=_FakeTeacher(1), subject=_FakeSubject(2), target_class=_FakeClass(3),
            term_id=10, year_id=20,
        )
        self.assertIsInstance(hard, BlockerDTO)
        self.assertEqual(hard.severity, "HARD")
        self.assertEqual(hard.code, "BLOCK_CLASH")
        self.assertEqual(hard.rule_ref, "policy.block_synchronization")
        self.assertEqual(hard.teacher_id, 1)
        self.assertEqual(hard.subject_id, 2)
        self.assertEqual(hard.classroom_id, 3)
        self.assertEqual(soft, [])

    def test_warnings_become_soft_blocker_dtos(self):
        validator = _StubValidator(warnings=[
            "Optimization Notice: Jane will only be teaching 1 stream(s) of Biology, which "
            "misses your 2-stream preparation target.",
        ])
        hard, soft = validate_row(
            validator, teacher=_FakeTeacher(1), subject=_FakeSubject(2), target_class=_FakeClass(3),
            term_id=10, year_id=20,
        )
        self.assertIsNone(hard)
        self.assertEqual(len(soft), 1)
        self.assertEqual(soft[0].severity, "SOFT")
        self.assertEqual(soft[0].code, "PREP_CONSOLIDATION_MISS")

    def test_unrecognized_message_falls_back_to_generic_code(self):
        validator = _StubValidator(hard_error="Some brand-new rule failure text.")
        hard, _soft = validate_row(
            validator, teacher=_FakeTeacher(1), subject=_FakeSubject(2), target_class=_FakeClass(3),
            term_id=10, year_id=20,
        )
        self.assertEqual(hard.code, "POLICY_VIOLATION")
        self.assertEqual(hard.rule_ref, "policy")

    def test_burnout_warning_becomes_soft_blocker_dto(self):
        validator = _StubValidator(warnings=[
            "Burnout Warning: Jane Doe exceeds the max 28 weekly lessons limit.",
        ])
        hard, soft = validate_row(
            validator, teacher=_FakeTeacher(1), subject=_FakeSubject(2), target_class=_FakeClass(3),
            term_id=10, year_id=20,
        )
        self.assertIsNone(hard)
        self.assertEqual(len(soft), 1)
        self.assertEqual(soft[0].severity, "SOFT")
        self.assertEqual(soft[0].code, "WEEKLY_CAP_EXCEEDED")
        self.assertEqual(soft[0].rule_ref, "policy.max_weekly_lessons")

    def test_preparation_warning_becomes_soft_blocker_dto(self):
        validator = _StubValidator(warnings=[
            "Preparation Warning: Jane Doe exceeds the max 6 unique class groups limit.",
        ])
        hard, soft = validate_row(
            validator, teacher=_FakeTeacher(1), subject=_FakeSubject(2), target_class=_FakeClass(3),
            term_id=10, year_id=20,
        )
        self.assertIsNone(hard)
        self.assertEqual(len(soft), 1)
        self.assertEqual(soft[0].severity, "SOFT")
        self.assertEqual(soft[0].code, "MAX_CLASS_GROUPS_EXCEEDED")
        self.assertEqual(soft[0].rule_ref, "policy.max_total_class_groups")

    def test_dry_run_flag_is_forwarded_and_no_state_mutation_is_hidden(self):
        validator = _StubValidator()
        validate_row(
            validator, teacher=_FakeTeacher(1), subject=_FakeSubject(2), target_class=_FakeClass(3),
            term_id=10, year_id=20, dry_run=True,
        )
        self.assertEqual(validator.calls, [(1, 2, 3, True)])

    def test_blocker_dto_to_dict_shape(self):
        blocker = BlockerDTO(
            code="MAX_SUBJECTS_PER_CLASS", severity="HARD", message="msg",
            teacher_id=1, subject_id=2, classroom_id=3,
            rule_ref="policy.max_subjects_per_class", suggested_fix="Remove a subject first.",
        )
        self.assertEqual(blocker.to_dict(), {
            "code": "MAX_SUBJECTS_PER_CLASS", "severity": "HARD", "message": "msg",
            "teacher_id": 1, "subject_id": 2, "classroom_id": 3,
            "rule_ref": "policy.max_subjects_per_class", "suggested_fix": "Remove a subject first.",
        })
