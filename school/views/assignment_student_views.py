import json
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.db import transaction
from django.utils import timezone
from django.db.models import Q

from django.shortcuts import get_object_or_404

from school.models.models import StudentExtra
from school.models.assignments_models import Assignment, StudentSubmission, StudentAnswer, AssignmentGroup
from school.views.assignment_common import (
    get_student_profile, build_review_payload, review_error_response, sync_group_submission_content
)


class StudentAssignmentDetailAPIView(APIView):
    """
    Endpoint: GET /api/assignments/student/<assignment_id>/
    Returns everything a student needs to take an assignment: the question set
    (without answer keys), any in-progress/returned answers to resume, and the
    submission-rules context (attempts left, group). Enforces the same
    targeting/eligibility rules as the board.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, assignment_id):
        student_id = request.query_params.get('student_id')

        try:
            student = get_student_profile(request.user, student_id)
            assignment = get_object_or_404(
                Assignment.objects.prefetch_related('questions__options'), id=assignment_id
            )

            eligible_stream = assignment.class_stream_id == student.cl_id or \
                assignment.additional_class_streams.filter(id=student.cl_id).exists()
            eligible_student = not assignment.assigned_students.exists() or \
                assignment.assigned_students.filter(id=student.id).exists()

            if assignment.status != 'Published' or not eligible_stream or not eligible_student:
                return Response({"error": "This assignment is not available to you."}, status=status.HTTP_404_NOT_FOUND)

            current_time = timezone.now()
            if assignment.cutoff_date and current_time > assignment.cutoff_date:
                return Response({"error": "The submission window for this assignment has closed."}, status=status.HTTP_403_FORBIDDEN)

            submission = StudentSubmission.objects.filter(assignment=assignment, student=student).first()
            existing_answers = []
            if submission:
                answers = StudentAnswer.objects.filter(submission=submission).prefetch_related('selected_options')
                existing_answers = [
                    {
                        "question_id": ans.question_id,
                        "text_answer": ans.text_answer,
                        "selected_options": list(ans.selected_options.values_list('id', flat=True)),
                    } for ans in answers
                ]

            group = AssignmentGroup.objects.filter(assignment=assignment, members=student).first()

            questions_data = []
            for q in assignment.questions.all():
                q_dict = {
                    "id": q.id,
                    "question_text": q.question_text,
                    "question_type": q.question_type,
                    "max_score": float(q.max_score),
                    "required_answers": q.required_answers,
                    "options": [{"id": opt.id, "option_text": opt.option_text} for opt in q.options.all()],
                }
                questions_data.append(q_dict)

            data = {
                "id": assignment.id,
                "title": assignment.title,
                "subject": assignment.subject.name,
                "teacher_attachment": assignment.teacher_attachment.url if assignment.teacher_attachment else None,
                "reference_notes": assignment.reference_notes,
                "reference_links": assignment.reference_links or [],
                "is_quiz": assignment.is_quiz,
                "duration_minutes": assignment.duration_minutes,
                "due_date": assignment.due_date.isoformat() if assignment.due_date else None,
                "cutoff_date": assignment.cutoff_date.isoformat() if assignment.cutoff_date else None,
                "allow_resubmission": assignment.allow_resubmission,
                "max_attempts": assignment.max_attempts,
                "attempt_number": submission.attempt_number if submission else 0,
                "already_submitted": bool(submission and submission.submitted_at),
                "grading_status": submission.grading_status if submission else None,
                "started_at": submission.started_at.isoformat() if submission and submission.started_at else None,
                "student_attachment": submission.student_attachment.url if submission and submission.student_attachment else None,
                "is_group_assignment": assignment.is_group_assignment,
                "group_name": group.name if group else None,
                "questions": questions_data,
                "existing_answers": existing_answers,
            }

            return Response({"assignment": data}, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class StudentAssignmentBoardAPIView(APIView):
    """
    Feeds the Student Dashboard. Only shows published assignments past the publish_date,
    respecting multi-stream and specific-student targeting.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        student_id = request.query_params.get('student_id')

        try:
            student = get_student_profile(request.user, student_id)
            current_time = timezone.now()

            assignments = Assignment.objects.filter(
                Q(class_stream=student.cl) | Q(additional_class_streams=student.cl),
                status='Published',
                publish_date__lte=current_time
            ).filter(
                Q(assigned_students__isnull=True) | Q(assigned_students=student)
            ).distinct().order_by('due_date')

            submissions = StudentSubmission.objects.filter(student=student)
            sub_map = {sub.assignment_id: sub for sub in submissions}

            data = []
            for assign in assignments:
                sub = sub_map.get(assign.id)
                is_locked = bool(assign.cutoff_date and current_time > assign.cutoff_date)

                # "Graded"/"Pending" are internal draft states — hide them (and the score)
                # from the student until the teacher explicitly Publishes. "Returned" is
                # actionable feedback so it stays visible.
                if not sub:
                    display_status = "Not Started"
                    display_score = 0
                elif sub.grading_status in ('Published', 'Returned'):
                    display_status = sub.grading_status
                    display_score = float(sub.total_awarded_score) if sub.grading_status == 'Published' else 0
                else:
                    display_status = "Pending"
                    display_score = 0

                data.append({
                    "id": assign.id,
                    "title": assign.title,
                    "subject": assign.subject.name,
                    "due_date": assign.due_date.isoformat() if assign.due_date else None,
                    "is_quiz": assign.is_quiz,
                    "duration_minutes": assign.duration_minutes,
                    "is_locked": is_locked,
                    "student_status": display_status,
                    "awarded_score": display_score,
                    "total_score": float(assign.total_max_score),
                    "teacher_attachment": assign.teacher_attachment.url if assign.teacher_attachment else None,
                    "allow_resubmission": assign.allow_resubmission,
                    "max_attempts": assign.max_attempts,
                    "attempt_number": sub.attempt_number if sub else 0,
                    "is_submitted": bool(sub and sub.submitted_at),
                    "is_group_assignment": assign.is_group_assignment,
                    "reference_notes": assign.reference_notes,
                    "reference_links": assign.reference_links or [],
                })

            return Response({"board": data}, status=status.HTTP_200_OK)

        except StudentExtra.DoesNotExist:
            return Response({"error": "Student not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class QuizStartAPIView(APIView):
    """
    Triggers the timer for a strict Quiz.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        student_id = request.data.get('student_id')
        assignment_id = request.data.get('assignment_id')

        try:
            student = get_student_profile(request.user, student_id)
            assignment = Assignment.objects.get(id=assignment_id)
            if assignment.cutoff_date and timezone.now() > assignment.cutoff_date:
                return Response({"error": "The strict cutoff time for this assessment has passed."},
                                status=status.HTTP_403_FORBIDDEN)

            submission, created = StudentSubmission.objects.get_or_create(
                student=student,
                assignment_id=assignment_id,
                defaults={'started_at': timezone.now()}
            )

            return Response({
                "message": "Timer started.",
                "started_at": submission.started_at.isoformat()
            }, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class SubmitAssignmentAPIView(APIView):
    """
    The Engine. Receives answers, auto-grades MCQs, applies late penalties, enforces
    resubmission/attempt rules, and checks Late Policies. Supports Student File Uploads
    and group-assignment content sync.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'submissions'

    def post(self, request):
        data = request.data
        student_id = data.get('student_id')
        assignment_id = data.get('assignment_id')
        student_file = request.FILES.get('student_attachment')

        answers_raw = data.get('answers', '[]')
        if isinstance(answers_raw, str):
            answers_data = json.loads(answers_raw)
        else:
            answers_data = answers_raw

        try:
            student = get_student_profile(request.user, student_id)
            assignment = Assignment.objects.prefetch_related('questions__options').get(id=assignment_id)
            current_time = timezone.now()

            if assignment.cutoff_date and current_time > assignment.cutoff_date:
                return Response({"error": "Submission rejected. Cutoff date passed."}, status=status.HTTP_403_FORBIDDEN)

            with transaction.atomic():
                submission, created = StudentSubmission.objects.get_or_create(
                    student=student,
                    assignment_id=assignment_id
                )

                if not created and submission.submitted_at:
                    if submission.grading_status != 'Returned' and not assignment.allow_resubmission:
                        return Response({"error": "Resubmission is not allowed for this assignment."},
                                        status=status.HTTP_403_FORBIDDEN)
                    if submission.attempt_number >= assignment.max_attempts:
                        return Response({"error": "Maximum submission attempts reached."},
                                        status=status.HTTP_403_FORBIDDEN)
                    submission.attempt_number += 1

                is_late = True if assignment.due_date and current_time > assignment.due_date else False

                submission.submitted_at = current_time
                submission.is_late = is_late

                if student_file:
                    submission.student_attachment = student_file

                total_awarded = 0
                requires_manual_grading = False

                question_map = {q.id: q for q in assignment.questions.all()}

                for ans in answers_data:
                    q_id = ans.get('question_id')
                    question = question_map.get(q_id)
                    if not question:
                        continue

                    awarded_score = 0

                    selected_opts = ans.get('selected_options', [])
                    if not isinstance(selected_opts, list):
                        selected_opts = [selected_opts] if selected_opts else []

                    if not selected_opts and ans.get('selected_option_id'):
                        selected_opts = [ans.get('selected_option_id')]

                    if question.is_auto_graded:
                        if question.question_type == 'MCQ':
                            if selected_opts:
                                opt = question.options.filter(id=selected_opts[0]).first()
                                if opt and opt.is_correct:
                                    awarded_score = question.max_score

                        elif question.question_type == 'CHECKBOX':
                            if selected_opts:
                                correct_options_ids = question.options.filter(is_correct=True).values_list('id', flat=True)
                                correct_matches = sum(1 for opt_id in selected_opts if opt_id in correct_options_ids)
                                awarded_score = min(correct_matches, question.max_score)

                        elif question.question_type == 'SHORT_ANSWER':
                            student_text = str(ans.get('text_answer', '')).strip().lower()
                            correct_text = str(question.exact_match_answer).strip().lower()
                            if student_text == correct_text:
                                awarded_score = question.max_score
                    else:
                        requires_manual_grading = True

                    total_awarded += awarded_score

                    answer_obj, _ = StudentAnswer.objects.update_or_create(
                        submission=submission,
                        question=question,
                        defaults={
                            'text_answer': ans.get('text_answer'),
                            'awarded_score': awarded_score
                        }
                    )

                    answer_obj.selected_options.set(selected_opts)

                if is_late and assignment.late_penalty_percent:
                    total_awarded = float(total_awarded) * (1 - float(assignment.late_penalty_percent) / 100)

                submission.total_awarded_score = total_awarded

                if requires_manual_grading or student_file:
                    submission.grading_status = 'Pending'
                else:
                    submission.grading_status = 'Graded'

                submission.save()

                if assignment.is_group_assignment:
                    sync_group_submission_content(assignment, submission, student)

            return Response({"message": "Assignment submitted successfully!", "status": submission.grading_status},
                            status=status.HTTP_201_CREATED)

        except Exception as e:
            return Response({"error": f"Submission Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class StudentSubmissionReviewAPIView(APIView):
    """
    Allows a student to review a graded (Published) assignment/quiz: their answers
    side-by-side with the correct answers and teacher feedback.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        student_id = request.query_params.get('student_id')
        assignment_id = request.query_params.get('assignment_id')

        if not assignment_id:
            return Response({"error": "Missing assignment_id."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            student = get_student_profile(request.user, student_id)

            submission = StudentSubmission.objects.select_related('assignment').get(
                student=student, assignment_id=assignment_id
            )

            if submission.grading_status != 'Published':
                return Response({
                    "error": "This assignment is still pending. Review will be unlocked once grades are published."
                }, status=status.HTTP_403_FORBIDDEN)

            return Response({"review": build_review_payload(submission)}, status=status.HTTP_200_OK)

        except StudentSubmission.DoesNotExist:
            return Response({"error": "Submission not found. This student has not taken this assignment."},
                            status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return review_error_response(e)
