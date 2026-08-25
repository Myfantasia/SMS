"""
Grade promotion: plain (internal-results-gated), same-institution exam-gated (KPSEA), and
exit (cross-institution or terminal, KJSEA/KCSE) transitions. See
docs/superpowers/specs/2026-08-12-sss-core-math-and-promotion-design.md.
"""
from django.utils import timezone
from django.db import transaction
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from apps.academics.models import (
    ExamTerm, next_grade_level, get_or_create_class_stream, tier_requires_pathway_choice, AcademicYear,
)
from apps.identity.models import StudentExtra
from apps.students.models import NationalExamRecord, StudentPathwaySelection
from apps.core.services import write_audit_log
from school.rbac import HasModulePermission
from school.views.subject_views import _approve_combo_subjects, _ensure_core_mathematics
from school.jobs import dispatch_background_job
from orchestration.tasks import promote_students_task


def _determine_transition(grade):
    """
    Classifies the promotion edge leaving `grade`:
      - ('plain', None, next_grade) — no national exam gates this exit.
      - ('exam_gated', exam_code, next_grade) — same-institution, gated on that exam being recorded.
      - ('exit', exam_code, None) — cross-institution or terminal; no cl reassignment.
    Driven entirely by the admin-configured Tier.exit_exam_code/exit_is_terminal fields — never
    hardcoded grade numbers, matching tier_requires_pathway_choice's own convention.

    A Tier spans multiple GradeLevels (e.g. Senior Secondary = Grade 10-12), and
    exit_exam_code/exit_is_terminal describe the exam gating the tier's own exit, not every
    grade inside it. Only the tier's exit grade — the one whose next grade belongs to a
    different tier (or has no next grade at all) — is exam-gated; every other grade inside the
    tier is a plain internal promotion. This mirrors grade_requires_pathway_choice's symmetric
    "entry grade" check (apps/academics/models.py) on the other end of a tier.
    """
    tier = grade.tier
    next_grade = next_grade_level(grade)
    is_tier_exit_grade = tier is not None and (next_grade is None or next_grade.tier_id != tier.id)
    if tier is None or not tier.exit_exam_code or not is_tier_exit_grade:
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


def _readiness_for_student(student, academic_year):
    """
    Non-mutating: computes whether `student` is eligible to promote for `academic_year` right
    now, and why/why not. The single source of truth _promote_student, the readiness-check
    endpoint, and the single-student promote endpoint all share — so what's displayed as a
    requirement can never drift from what's actually enforced.
    """
    grade = student.cl.grade if student.cl_id else None
    if grade is None:
        return {
            'student_id': student.id, 'ready': False, 'transition_type': None,
            'requirement': None, 'reason': 'No current class assigned.', 'next_grade_name': None,
        }

    transition_type, exam_code, next_grade = _determine_transition(grade)

    if transition_type == 'plain':
        requirement = 'Results finalized for the academic year'
        if not results_finalized_for_year(academic_year):
            return {
                'student_id': student.id, 'ready': False, 'transition_type': 'plain',
                'requirement': requirement, 'reason': 'Results not yet finalized for this academic year.',
                'next_grade_name': None,
            }
        if next_grade is None:
            return {
                'student_id': student.id, 'ready': False, 'transition_type': 'plain',
                'requirement': requirement, 'reason': 'No next grade configured after this one.',
                'next_grade_name': None,
            }
        return {
            'student_id': student.id, 'ready': True, 'transition_type': 'plain',
            'requirement': requirement, 'reason': None, 'next_grade_name': next_grade.name,
        }

    requirement = f'{exam_code} recorded'
    record = NationalExamRecord.objects.filter(student=student, exam_code=exam_code, academic_year=academic_year).first()
    if record is None:
        return {
            'student_id': student.id, 'ready': False, 'transition_type': transition_type,
            'requirement': requirement, 'reason': f'{exam_code} not yet recorded.', 'next_grade_name': None,
        }

    if transition_type == 'exam_gated':
        if next_grade is None:
            return {
                'student_id': student.id, 'ready': False, 'transition_type': 'exam_gated',
                'requirement': requirement, 'reason': 'No next grade configured after this one.',
                'next_grade_name': None,
            }
        return {
            'student_id': student.id, 'ready': True, 'transition_type': 'exam_gated',
            'requirement': requirement, 'reason': None, 'next_grade_name': next_grade.name,
        }

    # transition_type == 'exit'
    return {
        'student_id': student.id, 'ready': True, 'transition_type': 'exit',
        'requirement': requirement, 'reason': None, 'next_grade_name': None,
    }


def _promote_student(student, academic_year):
    """
    Attempts to promote one student for `academic_year`.
    Returns {'student_id', 'outcome': 'promoted'|'graduated'|'held', 'detail': str}.
    Never raises for a normal "not ready yet" case — those are 'held', not errors.
    """
    readiness = _readiness_for_student(student, academic_year)
    if not readiness['ready']:
        return {'student_id': student.id, 'outcome': 'held', 'detail': readiness['reason']}

    grade = student.cl.grade
    transition_type, exam_code, next_grade = _determine_transition(grade)

    if transition_type in ('plain', 'exam_gated'):
        _move_student_to_grade(student, next_grade, academic_year)
        detail = f'Promoted to {next_grade.name}.' if transition_type == 'plain' \
            else f'Promoted to {next_grade.name} ({exam_code} recorded).'
        return {'student_id': student.id, 'outcome': 'promoted', 'detail': detail}

    # transition_type == 'exit'
    student.enrollment_state = 'Graduated'
    student.save(update_fields=['enrollment_state'])
    record = NationalExamRecord.objects.filter(student=student, exam_code=exam_code, academic_year=academic_year).first()
    destination = record.destination or 'not yet recorded'
    return {
        'student_id': student.id, 'outcome': 'graduated',
        'detail': f'Graduated ({exam_code} recorded). Destination: {destination}.',
    }


class FinalizeTermAPIView(APIView):
    """Admin toggle for ExamTerm.results_finalized — purely informational, does not block
    result regeneration (see Task 2/spec §2)."""
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_edit_permission = 'results.edit'

    def post(self, request, term_id):
        try:
            term = ExamTerm.objects.get(id=term_id)
        except ExamTerm.DoesNotExist:
            return Response({"error": "Term not found."}, status=status.HTTP_404_NOT_FOUND)

        finalized = bool(request.data.get('finalized', True))
        term.results_finalized = finalized
        term.results_finalized_at = timezone.now() if finalized else None
        term.save(update_fields=['results_finalized', 'results_finalized_at'])

        write_audit_log(
            operator_id=request.user.id, action_type='UPDATE', module='PromotionResultsFinalization',
            description=f"{'Finalized' if finalized else 'Un-finalized'} results for term "
                        f"'{term.name}' ({term.academic_year.year}).",
        )
        return Response({"id": term.id, "results_finalized": term.results_finalized})


class RecordNationalExamAPIView(APIView):
    """Admin records that a student sat KPSEA/KJSEA/KCSE, optionally with a destination
    (placement school for KJSEA, university/institution for KCSE)."""
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_edit_permission = 'results.edit'

    def post(self, request, student_id):
        try:
            student = StudentExtra.objects.get(id=student_id)
        except StudentExtra.DoesNotExist:
            return Response({"error": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

        exam_code = request.data.get('exam_code')
        academic_year_id = request.data.get('academic_year_id')
        if exam_code not in ('KPSEA', 'KJSEA', 'KCSE') or not academic_year_id:
            return Response({"error": "exam_code and academic_year_id are required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            academic_year = AcademicYear.objects.get(id=academic_year_id)
        except AcademicYear.DoesNotExist:
            return Response({"error": "Academic year not found."}, status=status.HTTP_404_NOT_FOUND)

        record, created = NationalExamRecord.objects.update_or_create(
            student=student, exam_code=exam_code, academic_year=academic_year,
            defaults={
                'score': request.data.get('score', ''),
                'destination': request.data.get('destination', ''),
                'recorded_by': request.user,
            },
        )
        write_audit_log(
            operator_id=request.user.id, action_type='UPDATE', module='NationalExamRecord',
            description=f"Recorded {exam_code} for {student.get_name} ({academic_year.year}).",
        )
        return Response(
            {"id": record.id, "exam_code": record.exam_code, "destination": record.destination},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class PromoteStudentsAPIView(APIView):
    """Admin-triggered bulk promotion (see spec §4 — no scheduler infra exists in this repo,
    so this is on-demand, mirroring BulkGenerateTermResultsAPIView's exact pattern)."""
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_edit_permission = 'results.edit'

    def post(self, request):
        academic_year_id = request.data.get('academic_year_id')
        grade_id = request.data.get('grade_id')
        stream_id = request.data.get('stream_id')

        if not academic_year_id:
            return Response({"error": "academic_year_id is mandatory."}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        is_admin = user.is_superuser or user.groups.filter(name='ADMIN').exists()
        if not is_admin:
            return Response({"error": "Only Administrators can run a bulk promotion."}, status=status.HTTP_403_FORBIDDEN)

        students_qs = StudentExtra.objects.filter(status=True)
        if stream_id:
            students_qs = students_qs.filter(cl_id=stream_id)
        elif grade_id:
            students_qs = students_qs.filter(cl__grade_id=grade_id)
        student_ids = list(students_qs.values_list('id', flat=True))

        if not student_ids:
            return Response({"error": "No students found for the given scope."}, status=status.HTTP_404_NOT_FOUND)

        # Scoped per academic year — overlapping promotion runs for the same year (e.g. a
        # double-submit, or a grade-scoped run overlapping a whole-school run) write to the
        # same students' cl/enrollment_state/StudentPathwaySelection, so they share one lock
        # rather than being considered independent just because their student scopes differ.
        lock_key = f"bulk_promotion_lock_year_{academic_year_id}"

        job, error_response = dispatch_background_job(
            job_type='promote_students',
            task=promote_students_task,
            task_args=(academic_year_id, student_ids, request.user.id, lock_key),
            operator=request.user,
        )
        if error_response is not None:
            return error_response

        return Response({"status": "queued", "job_id": str(job.id)}, status=status.HTTP_202_ACCEPTED)


class PromotionReadinessAPIView(APIView):
    """Read-only preview of promotion eligibility for a scope — never mutates anything. The
    same _readiness_for_student call that _promote_student uses to actually promote, so this
    can never show a different picture than what running promotion will do."""
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_view_permission = 'results.view'

    def get(self, request):
        academic_year_id = request.query_params.get('academic_year_id')
        if not academic_year_id:
            return Response({"error": "academic_year_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            academic_year = AcademicYear.objects.get(id=academic_year_id)
        except AcademicYear.DoesNotExist:
            return Response({"error": "Academic year not found."}, status=status.HTTP_404_NOT_FOUND)

        students_qs = StudentExtra.objects.filter(status=True).select_related('user', 'cl__grade')
        student_id = request.query_params.get('student_id')
        stream_id = request.query_params.get('stream_id')
        grade_id = request.query_params.get('grade_id')
        if student_id:
            students_qs = students_qs.filter(id=student_id)
        elif stream_id:
            students_qs = students_qs.filter(cl_id=stream_id)
        elif grade_id:
            students_qs = students_qs.filter(cl__grade_id=grade_id)

        rows = []
        by_reason = {}
        ready_count = 0
        for student in students_qs:
            readiness = _readiness_for_student(student, academic_year)
            rows.append({
                'student_id': student.id,
                'name': student.get_name,
                'grade_name': student.cl.grade.name if student.cl_id else None,
                'transition_type': readiness['transition_type'],
                'requirement': readiness['requirement'],
                'ready': readiness['ready'],
                'reason': readiness['reason'],
            })
            if readiness['ready']:
                ready_count += 1
            else:
                by_reason[readiness['reason']] = by_reason.get(readiness['reason'], 0) + 1

        return Response({
            'summary': {'ready': ready_count, 'blocked': len(rows) - ready_count, 'by_reason': by_reason},
            'students': rows,
        })


class PromoteSingleStudentAPIView(APIView):
    """Synchronous single-student promote — fast enough to answer inline, unlike the bulk
    path which can span a whole school and goes through the background job queue."""
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_edit_permission = 'results.edit'

    def post(self, request, student_id):
        user = request.user
        is_admin = user.is_superuser or user.groups.filter(name='ADMIN').exists()
        if not is_admin:
            return Response({"error": "Only Administrators can promote a student."}, status=status.HTTP_403_FORBIDDEN)

        academic_year_id = request.data.get('academic_year_id')
        if not academic_year_id:
            return Response({"error": "academic_year_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            academic_year = AcademicYear.objects.get(id=academic_year_id)
        except AcademicYear.DoesNotExist:
            return Response({"error": "Academic year not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            student = StudentExtra.objects.select_related('cl__grade__tier').get(id=student_id)
        except StudentExtra.DoesNotExist:
            return Response({"error": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

        with transaction.atomic():
            outcome = _promote_student(student, academic_year)
            if outcome['outcome'] != 'held':
                write_audit_log(
                    operator_id=user.id, action_type='PROMOTE', module='SinglePromoteStudent',
                    description=f"{outcome['outcome'].capitalize()} {student.get_name} for {academic_year.year}: {outcome['detail']}",
                )
        return Response(outcome, status=status.HTTP_200_OK)
