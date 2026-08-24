import json
from django.utils.dateparse import parse_datetime
from django.utils.timezone import is_aware, make_aware
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.db import transaction
from django.utils import timezone
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied

from apps.identity.models import StudentExtra
from apps.academics.models import ExamTerm
from apps.assignments.models import (
    Assignment, Question, QuestionOption, StudentSubmission, StudentAnswer,
    RubricCriterion, CriterionScore, AssignmentGroup, AssignmentAttachment
)
from school.rbac import HasModulePermission
from school.views.assignment_common import get_teacher_profile, propagate_group_grade


def _parse_json_field(data, key, default):
    raw = data.get(key, default)
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return default
    return raw


def _save_questions(assignment, questions_data):
    """Wipes and recreates questions/options/rubric criteria for an assignment. Returns the new total_max_score."""
    assignment.questions.all().delete()
    total_tally = 0.00

    for q_data in questions_data:
        q_type = q_data.get('question_type')
        is_auto = True if q_type in ['MCQ', 'SHORT_ANSWER', 'CHECKBOX'] else False
        score = float(q_data.get('max_score', 1.00))
        total_tally += score

        question = Question.objects.create(
            assignment=assignment,
            question_text=q_data.get('question_text'),
            question_type=q_type,
            is_auto_graded=is_auto,
            max_score=score,
            exact_match_answer=q_data.get('exact_match_answer')
        )

        if q_type == 'MCQ' or q_type == 'CHECKBOX':
            options_data = q_data.get('options', [])
            QuestionOption.objects.bulk_create([
                QuestionOption(
                    question=question,
                    option_text=opt.get('option_text'),
                    is_correct=opt.get('is_correct', False)
                ) for opt in options_data
            ])

        criteria_data = q_data.get('rubric_criteria', [])
        if criteria_data:
            RubricCriterion.objects.bulk_create([
                RubricCriterion(
                    question=question,
                    criterion_text=c.get('criterion_text'),
                    max_points=float(c.get('max_points', 1.00)),
                    order=idx
                ) for idx, c in enumerate(criteria_data)
            ])

    return total_tally


def _save_groups(assignment, groups_data):
    assignment.groups.all().delete()
    for g_data in groups_data:
        group = AssignmentGroup.objects.create(assignment=assignment, name=g_data.get('name', 'Group'))
        member_ids = g_data.get('member_ids', [])
        if member_ids:
            group.members.set(StudentExtra.objects.filter(id__in=member_ids))


# ==========================================
# 1. TEACHER: CREATOR STUDIO
# ==========================================

class TeacherAssignmentAPIView(APIView):
    """
    Handles creating new assignments and listing all assignments.

    OPINION & BEST PRACTICE:
    Always utilize comprehensive administration flags (superuser, staff, and groups)
    and implement defensive property verification. This protects against structural
    changes in related models (e.g., Grade names vs Class names) from throwing 500 crashes.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'assignments.view'
    rbac_edit_permission = 'assignments.edit'

    def get(self, request):
        user = request.user

        try:
            is_an_admin = user.is_superuser or user.is_staff or user.groups.filter(name='ADMIN').exists()

            if is_an_admin:
                assignments = Assignment.objects.filter(is_deleted=False).select_related(
                    'class_stream__grade', 'subject', 'teacher__user'
                ).order_by('-created_at')
            else:
                teacher_profile = get_teacher_profile(user)
                assignments = Assignment.objects.filter(teacher=teacher_profile, is_deleted=False).select_related(
                    'class_stream__grade', 'subject', 'teacher__user'
                ).order_by('-created_at')

            data = []
            for assign in assignments:
                grade_name = "N/A"
                if assign.class_stream and hasattr(assign.class_stream, 'grade') and assign.class_stream.grade:
                    grade_name = assign.class_stream.grade.name
                elif assign.class_stream and hasattr(assign.class_stream, 'class_name'):
                    grade_name = assign.class_stream.class_name

                data.append({
                    "id": assign.id,
                    "title": assign.title,
                    "grade": grade_name,
                    "stream": assign.class_stream.name if assign.class_stream else "Unknown",
                    "subject": assign.subject.name if assign.subject else "Unknown",
                    "status": assign.status,
                    "is_quiz": assign.is_quiz,
                    "is_group_assignment": assign.is_group_assignment,
                    "due_date": assign.due_date.isoformat() if assign.due_date else None,
                    "publish_date": assign.publish_date.isoformat() if assign.publish_date else None,
                    "teacher_name": assign.teacher.get_name if assign.teacher else "Admin Configuration",
                    "teacher_attachment": assign.teacher_attachment.url if assign.teacher_attachment else None
                })

            return Response({"assignments": data}, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": f"Backend Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def post(self, request):
        """
        Creates an Assignment, its Questions, and Options simultaneously.
        Supports File Attachments via multipart/form-data.
        """
        data = request.data
        teacher_file = request.FILES.get('teacher_attachment')
        extra_files = request.FILES.getlist('additional_attachments')

        def safe_db_val(key):
            val = data.get(key)
            if val == '' or val == 'null' or val is None:
                return None
            return val

        def safe_date_val(key):
            val = data.get(key)
            if val == '' or val == 'null' or val is None:
                return None
            try:
                parsed = parse_datetime(val)
                if parsed and not is_aware(parsed):
                    return make_aware(parsed)
                return parsed
            except Exception:
                return None

        assignment_status = data.get('status', 'Draft')

        if assignment_status == 'Published':
            missing_fields = []
            if not safe_date_val('publish_date'): missing_fields.append("Publish Date")
            if not safe_date_val('due_date'): missing_fields.append("Due Date")
            if not safe_date_val('cutoff_date'): missing_fields.append("Cutoff Date")

            if missing_fields:
                error_msg = f"Cannot publish assignment. The following fields are mandatory: {', '.join(missing_fields)}."
                return Response({"error": error_msg}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                term_id = safe_db_val('term_id')
                if not term_id:
                    active_term = ExamTerm.objects.filter(is_active=True).first()
                    if active_term:
                        term_id = active_term.id

                curriculum_type = data.get('curriculum_type', 'CBC')
                strand_name = safe_db_val('strand_name') if curriculum_type == 'CBC' else None

                assignment = Assignment.objects.create(
                    title=data.get('title'),
                    assignment_type=data.get('assignment_type', 'Holiday'),
                    teacher_attachment=teacher_file,
                    teacher_id=safe_db_val('teacher_id'),
                    subject_id=safe_db_val('subject_id'),
                    class_stream_id=safe_db_val('class_stream_id'),
                    term_id=term_id,
                    curriculum_type=curriculum_type,
                    strand_name=strand_name,
                    publish_date=safe_date_val('publish_date'),
                    due_date=safe_date_val('due_date'),
                    cutoff_date=safe_date_val('cutoff_date'),
                    is_quiz=str(data.get('is_quiz', 'false')).lower() == 'true',
                    duration_minutes=safe_db_val('duration_minutes'),
                    status=assignment_status,
                    total_max_score=0.00,
                    allow_resubmission=str(data.get('allow_resubmission', 'false')).lower() == 'true',
                    max_attempts=int(safe_db_val('max_attempts') or 1),
                    late_penalty_percent=float(safe_db_val('late_penalty_percent') or 0),
                    is_group_assignment=str(data.get('is_group_assignment', 'false')).lower() == 'true',
                    reference_links=_parse_json_field(data, 'reference_links', []),
                    reference_notes=safe_db_val('reference_notes'),
                )

                questions_data = _parse_json_field(data, 'questions', [])
                assignment.total_max_score = _save_questions(assignment, questions_data)

                assigned_student_ids = _parse_json_field(data, 'assigned_student_ids', [])
                if assigned_student_ids:
                    assignment.assigned_students.set(StudentExtra.objects.filter(id__in=assigned_student_ids))

                additional_stream_ids = _parse_json_field(data, 'additional_class_stream_ids', [])
                if additional_stream_ids:
                    assignment.additional_class_streams.set(additional_stream_ids)

                groups_data = _parse_json_field(data, 'groups', [])
                if groups_data:
                    _save_groups(assignment, groups_data)

                for f in extra_files:
                    AssignmentAttachment.objects.create(assignment=assignment, file=f, label=f.name)

                assignment.save()

            return Response({"message": "Assignment created successfully!", "assignment_id": assignment.id},
                            status=status.HTTP_201_CREATED)

        except Exception as e:
            return Response({"error": f"Creation Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class AssignmentClassStreamStudentsAPIView(APIView):
    """
    Endpoint: GET /api/assignments/class-stream/<class_stream_id>/students/
    Lightweight {id, name, roll} roster for a stream, used by the assignment creator's
    "specific students" and "group member" pickers. Any teacher/admin with assignments
    access can call this for any stream (unlike attendance's class-teacher-only roster).
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'assignments.view'

    def get(self, request, class_stream_id):
        students = StudentExtra.objects.filter(cl_id=class_stream_id, status=True).order_by('user__first_name')
        data = [{"id": s.id, "name": s.get_name, "roll": s.roll} for s in students]
        return Response({"students": data}, status=status.HTTP_200_OK)


class TeacherAssignmentDetailAPIView(APIView):
    """
    Handles fetching and updating a SINGLE assignment by its ID.
    Enforces structural safety if an assignment is already Published.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'assignments.view'
    rbac_edit_permission = 'assignments.edit'

    def _get_assignment_safely(self, user, pk):
        if user.is_superuser:
            return get_object_or_404(Assignment, pk=pk)
        return get_object_or_404(Assignment, pk=pk, teacher__user=user)

    def get(self, request, pk):
        try:
            assignment = self._get_assignment_safely(request.user, pk)

            data = {
                "id": assignment.id,
                "title": assignment.title,
                "assignment_type": assignment.assignment_type,
                "teacher_id": assignment.teacher_id,
                "subject_id": assignment.subject_id,
                "class_stream_id": assignment.class_stream_id,
                "term_id": assignment.term_id,
                "curriculum_type": assignment.curriculum_type,
                "strand_name": assignment.strand_name,
                "publish_date": assignment.publish_date.isoformat() if assignment.publish_date else "",
                "due_date": assignment.due_date.isoformat() if assignment.due_date else "",
                "cutoff_date": assignment.cutoff_date.isoformat() if assignment.cutoff_date else "",
                "is_quiz": assignment.is_quiz,
                "duration_minutes": assignment.duration_minutes or "",
                "status": assignment.status,
                "teacher_attachment": assignment.teacher_attachment.url if assignment.teacher_attachment else None,
                "allow_resubmission": assignment.allow_resubmission,
                "max_attempts": assignment.max_attempts,
                "late_penalty_percent": float(assignment.late_penalty_percent),
                "is_group_assignment": assignment.is_group_assignment,
                "assigned_student_ids": list(assignment.assigned_students.values_list('id', flat=True)),
                "additional_class_stream_ids": list(assignment.additional_class_streams.values_list('id', flat=True)),
                "reference_links": assignment.reference_links or [],
                "reference_notes": assignment.reference_notes or "",
                "groups": [
                    {
                        "id": g.id,
                        "name": g.name,
                        "member_ids": list(g.members.values_list('id', flat=True))
                    } for g in assignment.groups.all()
                ],
                "attachments": [
                    {"id": a.id, "label": a.label, "url": a.file.url}
                    for a in assignment.attachments.all()
                ],
            }

            questions_data = []
            for q in assignment.questions.all():
                q_dict = {
                    "question_text": q.question_text,
                    "question_type": q.question_type,
                    "max_score": float(q.max_score),
                    "exact_match_answer": q.exact_match_answer or "",
                    "options": [],
                    "rubric_criteria": [
                        {"criterion_text": c.criterion_text, "max_points": float(c.max_points)}
                        for c in q.rubric_criteria.all()
                    ],
                }

                if q.question_type in ('MCQ', 'CHECKBOX'):
                    for opt in q.options.all():
                        q_dict["options"].append({
                            "option_text": opt.option_text,
                            "is_correct": opt.is_correct
                        })
                questions_data.append(q_dict)

            data["questions"] = questions_data

            return Response({"status": "success", "data": data}, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": f"Fetch Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def put(self, request, pk):
        """
        Updates an existing assignment.
        SAFETY LOCK: If it is already published, structural data (subject/class/questions/
        rubric/groups/targeting) cannot be altered. Dates, submission rules and reference
        material stay editable so teachers can extend deadlines or add resources.
        """
        assignment = self._get_assignment_safely(request.user, pk)
        data = request.data
        teacher_file = request.FILES.get('teacher_attachment')
        extra_files = request.FILES.getlist('additional_attachments')

        def safe_db_val(key, existing_val):
            val = data.get(key)
            if val is None:
                return existing_val
            if val == '' or val == 'null':
                return None
            return val

        def safe_date_val(key, existing_val):
            val = data.get(key)
            if val is None:
                return existing_val
            if val == '' or val == 'null':
                return None
            try:
                parsed = parse_datetime(val)
                if parsed and not is_aware(parsed):
                    return make_aware(parsed)
                return parsed
            except Exception:
                return None

        target_status = data.get('status', assignment.status)

        if target_status == 'Published':
            missing_fields = []
            if not safe_date_val('publish_date', assignment.publish_date): missing_fields.append("Publish Date")
            if not safe_date_val('due_date', assignment.due_date): missing_fields.append("Due Date")
            if not safe_date_val('cutoff_date', assignment.cutoff_date): missing_fields.append("Cutoff Date")

            if missing_fields:
                error_msg = f"Cannot publish. The following fields are mandatory: {', '.join(missing_fields)}."
                return Response({"error": error_msg}, status=status.HTTP_400_BAD_REQUEST)

        was_already_published = assignment.status == 'Published'

        try:
            with transaction.atomic():
                assignment.title = safe_db_val('title', assignment.title)
                assignment.publish_date = safe_date_val('publish_date', assignment.publish_date)
                assignment.due_date = safe_date_val('due_date', assignment.due_date)
                assignment.cutoff_date = safe_date_val('cutoff_date', assignment.cutoff_date)
                assignment.status = target_status

                assignment.curriculum_type = safe_db_val('curriculum_type', assignment.curriculum_type)
                assignment.strand_name = safe_db_val('strand_name',
                                                     assignment.strand_name) if assignment.curriculum_type == 'CBC' else None

                if teacher_file:
                    assignment.teacher_attachment = teacher_file

                # --- ALWAYS EDITABLE: submission rules & reference material ---
                if data.get('allow_resubmission') is not None:
                    assignment.allow_resubmission = str(data.get('allow_resubmission')).lower() == 'true'
                if safe_db_val('max_attempts', None) is not None:
                    assignment.max_attempts = int(data.get('max_attempts'))
                if safe_db_val('late_penalty_percent', None) is not None:
                    assignment.late_penalty_percent = float(data.get('late_penalty_percent'))
                if data.get('reference_links') is not None:
                    assignment.reference_links = _parse_json_field(data, 'reference_links', assignment.reference_links)
                assignment.reference_notes = safe_db_val('reference_notes', assignment.reference_notes)

                removed_attachment_ids = _parse_json_field(data, 'removed_attachment_ids', [])
                if removed_attachment_ids:
                    AssignmentAttachment.objects.filter(assignment=assignment, id__in=removed_attachment_ids).delete()
                for f in extra_files:
                    AssignmentAttachment.objects.create(assignment=assignment, file=f, label=f.name)

                # --- APPLY THE SAFETY LOCK to structural data ---
                if not was_already_published:
                    assignment.subject_id = safe_db_val('subject_id', assignment.subject_id)
                    assignment.class_stream_id = safe_db_val('class_stream_id', assignment.class_stream_id)
                    assignment.is_group_assignment = str(data.get('is_group_assignment', assignment.is_group_assignment)).lower() == 'true'

                    assigned_student_ids = data.get('assigned_student_ids')
                    if assigned_student_ids is not None:
                        assignment.assigned_students.set(_parse_json_field(data, 'assigned_student_ids', []))

                    additional_stream_ids = data.get('additional_class_stream_ids')
                    if additional_stream_ids is not None:
                        assignment.additional_class_streams.set(_parse_json_field(data, 'additional_class_stream_ids', []))

                    groups_data = data.get('groups')
                    if groups_data is not None:
                        _save_groups(assignment, _parse_json_field(data, 'groups', []))

                    questions_raw = data.get('questions')
                    if questions_raw is not None:
                        questions_data = _parse_json_field(data, 'questions', [])
                        assignment.total_max_score = _save_questions(assignment, questions_data)

                assignment.save()

            return Response({"message": "Assignment updated successfully!"}, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": f"Update Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def delete(self, request, pk):
        """Moves the assignment to Trash. Permanently purging it (after 20 days,
        or manually) walks its full file-attachment subtree — see
        apps.assignments.models._purge_assignment."""
        try:
            assignment = self._get_assignment_safely(request.user, pk)
            from apps.core.trash import soft_delete
            soft_delete(
                assignment, operator=request.user, module='Assignments',
                description=f"Deleted assignment '{assignment.title}'.",
            )
            return Response({"message": "Assignment moved to Trash."}, status=status.HTTP_204_NO_CONTENT)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ==========================================
# 3. TEACHER: MANUAL GRADING
# ==========================================

class TeacherGradingAPIView(APIView):
    """
    Fetches submissions for grading and accepts manual marks.
    """
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'assignments.view'
    rbac_edit_permission = 'assignments.edit'

    def _verify_assignment_ownership(self, user, assignment_id):
        if user.is_superuser: return get_object_or_404(Assignment, id=assignment_id)
        return get_object_or_404(Assignment, id=assignment_id, teacher__user=user)

    def get(self, request):
        assignment_id = request.query_params.get('assignment_id')

        try:
            self._verify_assignment_ownership(request.user, assignment_id)
            submissions = StudentSubmission.objects.filter(assignment_id=assignment_id).select_related('student__user')

            data = []
            for sub in submissions:
                data.append({
                    "submission_id": sub.id,
                    "student_name": sub.student.get_name,
                    "is_late": sub.is_late,
                    "status": sub.grading_status,
                    "current_score": float(sub.total_awarded_score),
                    "student_attachment": sub.student_attachment.url if sub.student_attachment else None
                })

            return Response({"submissions": data}, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def post(self, request):
        """
        Receives manual grades for essays/uploads from the teacher.
        Payload format: {"submission_id": 1, "overall_feedback": "Good job", "grades": [{"answer_id": 5, "score": 10, "comment": "Nice logic"}]}
        """
        sub_id = request.data.get('submission_id')
        grades_data = request.data.get('grades', [])
        overall_feedback = request.data.get('overall_feedback')

        try:
            with transaction.atomic():
                submission = StudentSubmission.objects.select_related('assignment').get(id=sub_id)
                self._verify_assignment_ownership(request.user, submission.assignment.id)

                for grade_entry in grades_data:
                    ans_id = grade_entry.get('answer_id')
                    score = grade_entry.get('score', 0)
                    comment = grade_entry.get('comment', '')

                    StudentAnswer.objects.filter(id=ans_id, submission=submission).update(
                        awarded_score=score,
                        teacher_comment=comment
                    )

                total = StudentAnswer.objects.filter(submission=submission).aggregate(Sum('awarded_score'))[
                    'awarded_score__sum']

                submission.total_awarded_score = total or 0
                submission.overall_feedback = overall_feedback
                submission.grading_status = 'Graded'
                submission.save()

            return Response({"message": "Grading saved successfully!"}, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": f"Grading Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ==========================================
# 1. SUBMISSION ROSTER (The Ghost Detector)
# ==========================================
class SubmissionsRosterAPIView(APIView):
    """
    Endpoint: GET /api/assignments/<id>/submissions-roster/
    Fetches ALL students enrolled in the assignment's class stream.
    If they haven't submitted, it sends them as "Missing".
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'assignments.view'

    def get(self, request, assignment_id):
        try:
            assignment = get_object_or_404(Assignment, id=assignment_id)
            if not request.user.is_superuser and assignment.teacher.user != request.user:
                raise PermissionDenied("You do not own this assignment.")

            students = StudentExtra.objects.filter(cl=assignment.class_stream, status=True)
            submissions = StudentSubmission.objects.filter(assignment=assignment)
            sub_map = {sub.student_id: sub for sub in submissions}

            group_name_map = {}
            for group in assignment.groups.prefetch_related('members').all():
                for member in group.members.all():
                    group_name_map[member.id] = group.name

            roster = []
            for student in students:
                sub = sub_map.get(student.id)

                if sub:
                    react_status = 'Pending Review'
                    if sub.grading_status == 'Graded':
                        react_status = 'Graded (Draft)'
                    elif sub.grading_status == 'Returned':
                        react_status = 'Returned'
                    elif sub.grading_status == 'Published':
                        react_status = 'Published'

                    roster.append({
                        "id": sub.id,
                        "student_id": student.id,
                        "student_name": student.get_name,
                        "student_roll": student.roll,
                        "status": react_status,
                        "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
                        "is_late": sub.is_late,
                        "attempt_number": sub.attempt_number,
                        "score": float(sub.total_awarded_score),
                        "max_score": assignment.total_max_score,
                        "attachment_url": request.build_absolute_uri(
                            sub.student_attachment.url) if sub.student_attachment else None,
                        "teacher_feedback": sub.overall_feedback,
                        "group_name": group_name_map.get(student.id)
                    })
                else:
                    roster.append({
                        "id": None,
                        "student_id": student.id,
                        "student_name": student.get_name,
                        "student_roll": student.roll,
                        "status": "Missing",
                        "submitted_at": None,
                        "is_late": False,
                        "attempt_number": 0,
                        "score": 0,
                        "max_score": assignment.total_max_score,
                        "attachment_url": None,
                        "teacher_feedback": "",
                        "group_name": group_name_map.get(student.id)
                    })

            roster = sorted(roster, key=lambda x: x['student_name'])

            return Response({
                "assignment_title": assignment.title,
                "is_group_assignment": assignment.is_group_assignment,
                "submissions": roster
            }, status=status.HTTP_200_OK)

        except Assignment.DoesNotExist:
            return Response({"error": "Assignment not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ==========================================
# 2. BULK RELEASE GRADES
# ==========================================

class BulkReleaseGradesAPIView(APIView):
    """
    Endpoint: POST /api/assignments/<id>/bulk-release/
    Finds all submissions marked as 'Graded' (Drafts) and locks them to 'Published'.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'assignments.edit'

    def post(self, request, assignment_id):
        try:
            assignment = get_object_or_404(Assignment, id=assignment_id)
            if not request.user.is_superuser and assignment.teacher.user != request.user:
                raise PermissionDenied("You do not own this assignment.")
            with transaction.atomic():
                updated_count = StudentSubmission.objects.filter(
                    assignment_id=assignment_id,
                    grading_status='Graded'
                ).update(grading_status='Published')

            return Response({
                "message": f"Successfully released {updated_count} grades to students!"
            }, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ==========================================
# 3. GRADE INDIVIDUAL STUDENT
# ==========================================

class GradeStudentAPIView(APIView):
    """
    Endpoint: POST /api/assignments/<id>/grade-student/
    Saves a specific student's manual grade, feedback, and handles 'Returned' status.
    Optionally propagates the grade to the rest of the student's group.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'assignments.edit'

    def post(self, request, assignment_id):
        student_id = request.data.get('student_id')
        score = request.data.get('score', 0)
        feedback = request.data.get('teacher_feedback', '')
        react_status = request.data.get('status')
        apply_to_group = str(request.data.get('apply_to_group', 'false')).lower() == 'true'

        db_status = 'Graded'
        if react_status in ['Returned', 'Published']: db_status = react_status

        try:
            assignment = get_object_or_404(Assignment, id=assignment_id)
            if not request.user.is_superuser and assignment.teacher.user != request.user:
                raise PermissionDenied("You do not own this assignment.")
            with transaction.atomic():
                submission, created = StudentSubmission.objects.get_or_create(
                    assignment_id=assignment_id,
                    student_id=student_id
                )

                submission.total_awarded_score = score
                submission.overall_feedback = feedback
                submission.grading_status = db_status

                if created and db_status == 'Graded':
                    submission.submitted_at = timezone.now()
                submission.save()

                if apply_to_group and assignment.is_group_assignment:
                    propagate_group_grade(assignment, submission, submission.student)

            return Response({"message": "Grade saved successfully!"}, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class TeacherSubmissionDetailAPIView(APIView):
    """
    The "Data Zip" Endpoint for the Full-Screen Grading Interface.
    Fetches a single student's submission and explicitly zips questions with their answers.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'assignments.view'

    def get(self, request, assignment_id, student_id):
        try:
            assignment = get_object_or_404(Assignment, id=assignment_id)
            if not request.user.is_superuser and assignment.teacher.user != request.user:
                raise PermissionDenied("You do not own this assignment.")

            student = get_object_or_404(StudentExtra, id=student_id)

            submission, created = StudentSubmission.objects.get_or_create(
                assignment=assignment,
                student=student
            )

            questions = assignment.questions.prefetch_related('options', 'rubric_criteria').all()
            answers = StudentAnswer.objects.filter(submission=submission).prefetch_related(
                'selected_options', 'criterion_scores'
            )
            ans_map = {ans.question_id: ans for ans in answers}

            group = None
            if assignment.is_group_assignment:
                group = assignment.groups.filter(members=student).first()

            zipped_data = []
            for q in questions:
                ans = ans_map.get(q.id)

                correct_answer_text = None
                if q.question_type == 'MCQ':
                    correct_opt = q.options.filter(is_correct=True).first()
                    correct_answer_text = correct_opt.option_text if correct_opt else "N/A"
                elif q.question_type == 'SHORT_ANSWER':
                    correct_answer_text = q.exact_match_answer

                student_options = list(ans.selected_options.values_list('id', flat=True)) if ans else []

                criterion_score_map = {}
                if ans:
                    criterion_score_map = {cs.criterion_id: float(cs.score) for cs in ans.criterion_scores.all()}

                rubric_criteria = [
                    {
                        "id": c.id,
                        "criterion_text": c.criterion_text,
                        "max_points": float(c.max_points),
                        "score": criterion_score_map.get(c.id, 0.00),
                    } for c in q.rubric_criteria.all()
                ]

                zipped_data.append({
                    "question_id": q.id,
                    "question_text": q.question_text,
                    "question_type": q.question_type,
                    "is_auto_graded": q.is_auto_graded,
                    "max_score": float(q.max_score),
                    "correct_answer": correct_answer_text,

                    "answer_id": ans.id if ans else None,
                    "student_text_answer": ans.text_answer if ans else "",
                    "student_selected_options": student_options,

                    "awarded_score": float(ans.awarded_score) if ans else 0.00,
                    "teacher_comment": ans.teacher_comment if ans else "",
                    "teacher_corrected_text": ans.teacher_corrected_text if ans else "",
                    "rubric_criteria": rubric_criteria,
                })

            payload = {
                "submission_id": submission.id,
                "student_name": student.get_name,
                "status": submission.grading_status,
                "is_late": submission.is_late,
                "attempt_number": submission.attempt_number,
                "submitted_at": submission.submitted_at.isoformat() if submission.submitted_at else None,
                "overall_feedback": submission.overall_feedback or "",
                "total_awarded_score": float(submission.total_awarded_score),
                "total_max_score": float(assignment.total_max_score),
                "student_attachment": submission.student_attachment.url if submission.student_attachment else None,
                "teacher_returned_file": submission.teacher_returned_file.url if submission.teacher_returned_file else None,
                "is_group_assignment": assignment.is_group_assignment,
                "group_name": group.name if group else None,
                "questions_zipped": zipped_data
            }

            return Response(payload, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": f"Zip Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class TeacherGradingSaveAPIView(APIView):
    """
    The Save Engine for Full-Screen Grading.
    Handles file attachments, granular scores (incl. rubric criteria), per-question
    feedback, pipeline status, and optional group-wide grade propagation.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'assignments.edit'

    def put(self, request, submission_id):
        submission = get_object_or_404(StudentSubmission, id=submission_id)

        if not request.user.is_superuser and submission.assignment.teacher.user != request.user:
            raise PermissionDenied("You do not own this assignment.")
        data = request.data

        target_status = data.get('status', submission.grading_status)
        overall_feedback = data.get('overall_feedback', '')
        apply_to_group = str(data.get('apply_to_group', 'false')).lower() == 'true'

        returned_file = request.FILES.get('teacher_returned_file')
        if returned_file:
            if submission.teacher_returned_file:
                submission.teacher_returned_file.delete(save=False)
            submission.teacher_returned_file = returned_file

        grades_raw = data.get('grades', '[]')
        grades_data = json.loads(grades_raw) if isinstance(grades_raw, str) else grades_raw

        try:
            with transaction.atomic():
                total_tally = 0
                for g in grades_data:
                    ans_id = g.get('answer_id')
                    q_id = g.get('question_id')
                    comment = g.get('comment', '')
                    corrected_text = g.get('corrected_text', '')
                    criterion_scores = g.get('criterion_scores', [])

                    if criterion_scores:
                        score = sum(float(cs.get('score', 0)) for cs in criterion_scores)
                    else:
                        score = float(g.get('score', 0))

                    total_tally += score

                    if ans_id:
                        answer = StudentAnswer.objects.filter(id=ans_id, submission=submission).first()
                    else:
                        answer = None

                    if answer:
                        answer.awarded_score = score
                        answer.teacher_comment = comment
                        answer.teacher_corrected_text = corrected_text
                        answer.save()
                    elif q_id:
                        answer = StudentAnswer.objects.create(
                            submission=submission,
                            question_id=q_id,
                            awarded_score=score,
                            teacher_comment=comment,
                            teacher_corrected_text=corrected_text
                        )

                    if answer and criterion_scores:
                        for cs in criterion_scores:
                            criterion_id = cs.get('criterion_id')
                            if not criterion_id:
                                continue
                            CriterionScore.objects.update_or_create(
                                answer=answer, criterion_id=criterion_id,
                                defaults={'score': float(cs.get('score', 0))}
                            )

                submission.total_awarded_score = total_tally
                submission.overall_feedback = overall_feedback
                submission.grading_status = target_status

                if target_status in ['Graded', 'Published'] and not submission.submitted_at:
                    submission.submitted_at = timezone.now()

                submission.save()

                if apply_to_group and submission.assignment.is_group_assignment:
                    propagate_group_grade(submission.assignment, submission, submission.student)

            return Response({"message": "Grading saved successfully!"}, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": f"Grading Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
