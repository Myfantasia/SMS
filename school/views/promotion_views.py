"""
Grade promotion: plain (internal-results-gated), same-institution exam-gated (KPSEA), and
exit (cross-institution or terminal, KJSEA/KCSE) transitions. See
docs/superpowers/specs/2026-08-12-sss-core-math-and-promotion-design.md.
"""
from apps.academics.models import ExamTerm, next_grade_level, get_or_create_class_stream, tier_requires_pathway_choice
from apps.students.models import NationalExamRecord, StudentPathwaySelection
from apps.core.services import write_audit_log
from school.views.subject_views import _approve_combo_subjects, _ensure_core_mathematics


def _determine_transition(grade):
    """
    Classifies the promotion edge leaving `grade`:
      - ('plain', None, next_grade) — no national exam gates this exit.
      - ('exam_gated', exam_code, next_grade) — same-institution, gated on that exam being recorded.
      - ('exit', exam_code, None) — cross-institution or terminal; no cl reassignment.
    Driven entirely by the admin-configured Tier.exit_exam_code/exit_is_terminal fields — never
    hardcoded grade numbers, matching tier_requires_pathway_choice's own convention.
    """
    tier = grade.tier
    next_grade = next_grade_level(grade)
    if tier is None or not tier.exit_exam_code:
        return ('plain', None, next_grade)
    if tier.exit_is_terminal:
        return ('exit', tier.exit_exam_code, None)
    return ('exam_gated', tier.exit_exam_code, next_grade)


def results_finalized_for_year(academic_year):
    """True once every ExamTerm under `academic_year` has been admin-finalized (Task 2)."""
    terms = ExamTerm.objects.filter(academic_year=academic_year)
    return terms.exists() and not terms.filter(results_finalized=False).exists()


def _carry_forward_pathway_selection(student, academic_year):
    """
    Clones the student's most recent Approved StudentPathwaySelection into the new academic_year
    (an SSS student's pathway/track/combo doesn't change on promotion, only their grade does),
    then re-approves the combo's subjects and re-runs the core-math guarantee for the new year.
    """
    previous = StudentPathwaySelection.objects.filter(
        student=student, status='Approved',
    ).exclude(academic_year=academic_year).order_by('-academic_year_id').first()
    if previous is None:
        return

    new_selection, _ = StudentPathwaySelection.objects.update_or_create(
        student=student, academic_year=academic_year,
        defaults={
            'pathway': previous.pathway, 'track': previous.track,
            'preset_combination': previous.preset_combination, 'status': 'Approved',
        },
    )
    if new_selection.preset_combination_id:
        _approve_combo_subjects(student, new_selection.preset_combination, academic_year)
        _ensure_core_mathematics(student, new_selection.preset_combination, academic_year)


def _move_student_to_grade(student, next_grade, academic_year):
    """Reassigns cl to the same-named stream in next_grade, creating it if needed, and carries
    forward the pathway selection for SSS grades."""
    current_stream_name = student.cl.name
    new_stream = get_or_create_class_stream(next_grade, current_stream_name)
    student.cl = new_stream
    student.save(update_fields=['cl'])

    if tier_requires_pathway_choice(next_grade.tier):
        _carry_forward_pathway_selection(student, academic_year)


def _promote_student(student, academic_year):
    """
    Attempts to promote one student for `academic_year`.
    Returns {'student_id', 'outcome': 'promoted'|'graduated'|'held', 'detail': str}.
    Never raises for a normal "not ready yet" case — those are 'held', not errors.
    """
    grade = student.cl.grade if student.cl_id else None
    if grade is None:
        return {'student_id': student.id, 'outcome': 'held', 'detail': 'No current class assigned.'}

    transition_type, exam_code, next_grade = _determine_transition(grade)

    if transition_type == 'plain':
        if not results_finalized_for_year(academic_year):
            return {'student_id': student.id, 'outcome': 'held', 'detail': 'Results not yet finalized for this academic year.'}
        if next_grade is None:
            return {'student_id': student.id, 'outcome': 'held', 'detail': 'No next grade configured after this one.'}
        _move_student_to_grade(student, next_grade, academic_year)
        return {'student_id': student.id, 'outcome': 'promoted', 'detail': f'Promoted to {next_grade.name}.'}

    record = NationalExamRecord.objects.filter(student=student, exam_code=exam_code, academic_year=academic_year).first()
    if record is None:
        return {'student_id': student.id, 'outcome': 'held', 'detail': f'{exam_code} not yet recorded.'}

    if transition_type == 'exam_gated':
        if next_grade is None:
            return {'student_id': student.id, 'outcome': 'held', 'detail': 'No next grade configured after this one.'}
        _move_student_to_grade(student, next_grade, academic_year)
        return {'student_id': student.id, 'outcome': 'promoted', 'detail': f'Promoted to {next_grade.name} ({exam_code} recorded).'}

    # transition_type == 'exit'
    student.enrollment_state = 'Graduated'
    student.save(update_fields=['enrollment_state'])
    destination = record.destination or 'not yet recorded'
    return {'student_id': student.id, 'outcome': 'graduated', 'detail': f'Graduated ({exam_code} recorded). Destination: {destination}.'}
