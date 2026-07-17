from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from rest_framework import status
from rest_framework.response import Response

from django.db.models import Sum

from school.models.models import StudentExtra, ParentExtra, TeacherExtra
from school.models.assignments_models import (
    QuestionOption, StudentAnswer, StudentSubmission, AssignmentGroup
)


# ==========================================
# HELPER FUNCTIONS FOR IDOR PROTECTION
# ==========================================

def get_teacher_profile(user):
    """Safely extracts the teacher profile to enforce strict ownership of data."""
    if user.is_superuser:
        return None
    try:
        return user.teacherextra
    except TeacherExtra.DoesNotExist:
        raise PermissionDenied("You must be a registered teacher to perform this action.")


def get_student_profile(user, requested_student_id=None):
    """
    Resolves the StudentExtra a request should act on.
    - Students: use their own profile. If a student_id was also passed, it must match.
    - Parents: require an explicit student_id, and it must be one of their own children.
    - Superusers: require an explicit student_id (acting on behalf of anyone).
    """
    if user.is_superuser:
        if not requested_student_id:
            raise PermissionDenied("student_id is required.")
        return get_object_or_404(StudentExtra, id=requested_student_id)

    if hasattr(user, 'studentextra'):
        student = user.studentextra
        if requested_student_id and str(student.id) != str(requested_student_id):
            raise PermissionDenied("Access denied. You cannot view or modify another student's data.")
        return student

    if hasattr(user, 'parentextra'):
        if not requested_student_id:
            raise PermissionDenied("student_id is required.")
        parent = user.parentextra
        if not parent.students.filter(id=requested_student_id).exists():
            raise PermissionDenied("You do not have permission to access this student's data.")
        return get_object_or_404(StudentExtra, id=requested_student_id)

    raise PermissionDenied("You must be a registered student to perform this action.")


def get_parent_profile(user, requested_parent_id=None):
    """
    Resolves the ParentExtra a request should act on.
    - Parents: use their own profile. If a parent_id was also passed, it must match.
    - Superusers: require an explicit parent_id.
    """
    if user.is_superuser:
        if not requested_parent_id:
            raise PermissionDenied("parent_id is required.")
        return get_object_or_404(ParentExtra, id=requested_parent_id)

    if hasattr(user, 'parentextra'):
        parent = user.parentextra
        if requested_parent_id and str(parent.id) != str(requested_parent_id):
            raise PermissionDenied("Access denied. You cannot view another parent's data.")
        return parent

    raise PermissionDenied("You must be a registered parent to perform this action.")


def build_review_payload(submission):
    """
    Shared answer-review builder used by both the student and parent review endpoints.
    Zips each answer with its question, the correct answer (where applicable), and
    per-criterion rubric scores if the question has a rubric.
    """
    answers = StudentAnswer.objects.filter(submission=submission).select_related('question').prefetch_related(
        'selected_options', 'criterion_scores__criterion'
    )

    answers_data = []
    for ans in answers:
        q = ans.question

        correct_answer_text = None
        if q.question_type == 'MCQ':
            correct_opt = QuestionOption.objects.filter(question=q, is_correct=True).first()
            correct_answer_text = correct_opt.option_text if correct_opt else "N/A"
        elif q.question_type == 'CHECKBOX':
            correct_opts = QuestionOption.objects.filter(question=q, is_correct=True).values_list('option_text', flat=True)
            correct_answer_text = ", ".join(correct_opts) if correct_opts else "N/A"
        elif q.question_type == 'SHORT_ANSWER':
            correct_answer_text = q.exact_match_answer

        selected_option_texts = [opt.option_text for opt in ans.selected_options.all()]

        criterion_scores = [
            {
                "criterion_text": cs.criterion.criterion_text,
                "max_points": float(cs.criterion.max_points),
                "score": float(cs.score),
            }
            for cs in ans.criterion_scores.all()
        ]

        answers_data.append({
            "question_text": q.question_text,
            "question_type": q.question_type,
            "max_score": float(q.max_score),
            "awarded_score": float(ans.awarded_score),
            "student_text_answer": ans.text_answer,
            "student_selected_options": selected_option_texts,
            "correct_answer": correct_answer_text,
            "teacher_comment": ans.teacher_comment,
            "teacher_corrected_text": ans.teacher_corrected_text,
            "criterion_scores": criterion_scores,
        })

    return {
        "assignment_title": submission.assignment.title,
        "total_awarded_score": float(submission.total_awarded_score),
        "total_max_score": float(submission.assignment.total_max_score),
        "overall_feedback": submission.overall_feedback,
        "is_late": submission.is_late,
        "submitted_at": submission.submitted_at.isoformat() if submission.submitted_at else None,
        "teacher_attachment": submission.assignment.teacher_attachment.url if submission.assignment.teacher_attachment else None,
        "student_attachment": submission.student_attachment.url if submission.student_attachment else None,
        "teacher_returned_file": submission.teacher_returned_file.url if submission.teacher_returned_file else None,
        "detailed_answers": answers_data,
    }


def review_error_response(exc):
    return Response({"error": f"Review Error: {str(exc)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def get_group_for_student(assignment, student):
    """Returns the AssignmentGroup a student belongs to for this assignment, or None."""
    if not assignment.is_group_assignment:
        return None
    return AssignmentGroup.objects.filter(assignment=assignment, members=student).first()


def sync_group_submission_content(assignment, source_submission, source_student):
    """
    When a group member submits, copy their answers/attachment to every other
    member's StudentSubmission so grading only needs to happen once per group.
    """
    group = get_group_for_student(assignment, source_student)
    if not group:
        return

    other_members = group.members.exclude(id=source_student.id)
    source_answers = list(StudentAnswer.objects.filter(submission=source_submission).prefetch_related('selected_options'))

    for member in other_members:
        member_submission, _ = StudentSubmission.objects.get_or_create(
            assignment=assignment, student=member
        )
        member_submission.submitted_at = source_submission.submitted_at
        member_submission.is_late = source_submission.is_late
        member_submission.attempt_number = source_submission.attempt_number
        member_submission.total_awarded_score = source_submission.total_awarded_score
        member_submission.grading_status = source_submission.grading_status
        if source_submission.student_attachment:
            member_submission.student_attachment = source_submission.student_attachment
        member_submission.save()

        for src_ans in source_answers:
            member_ans, _ = StudentAnswer.objects.update_or_create(
                submission=member_submission,
                question=src_ans.question,
                defaults={
                    'text_answer': src_ans.text_answer,
                    'awarded_score': src_ans.awarded_score,
                }
            )
            member_ans.selected_options.set(src_ans.selected_options.all())


def propagate_group_grade(assignment, source_submission, source_student):
    """
    When a teacher grades one group member (with apply_to_group requested),
    copy the resulting score/feedback/status and per-question grades to the rest of the group.
    """
    group = get_group_for_student(assignment, source_student)
    if not group:
        return

    other_members = group.members.exclude(id=source_student.id)
    source_answers = list(StudentAnswer.objects.filter(submission=source_submission))

    for member in other_members:
        member_submission, _ = StudentSubmission.objects.get_or_create(
            assignment=assignment, student=member
        )
        member_submission.total_awarded_score = source_submission.total_awarded_score
        member_submission.overall_feedback = source_submission.overall_feedback
        member_submission.grading_status = source_submission.grading_status
        member_submission.save()

        for src_ans in source_answers:
            StudentAnswer.objects.update_or_create(
                submission=member_submission,
                question=src_ans.question,
                defaults={
                    'awarded_score': src_ans.awarded_score,
                    'teacher_comment': src_ans.teacher_comment,
                    'teacher_corrected_text': src_ans.teacher_corrected_text,
                }
            )
