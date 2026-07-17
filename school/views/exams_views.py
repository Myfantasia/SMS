from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.db import transaction
from decimal import Decimal, ROUND_HALF_UP
from school.models.models import (StudentExtra, ExamTerm, ExamEvent, ExamResult, GradingRule,
                                  AcademicYear, StudentReportSummary, ClassExamStatus)
from school.serializers.exams_serializers import StudentGridSerializer, ExamResultSerializer
from django.utils import timezone
from datetime import timedelta
from school.models.classSubjects_models import (
    ClassStream, Subject, SystemAuditLog, SubjectAllocation, SubjectQuota, StudentSubjectEnrollment
)
from school.utils import get_teacher_exam_clearance, get_scaled_score, get_applicable_students, \
    resolve_classroom_students
from django.db.models import Q
from school.rbac import HasModulePermission


class RapidMarksEntryView(APIView):
    """
    Handles fetching students for data entry and bulk-saving their exam marks.
    Protected by Adoptive RBAC.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'exams.view'
    # exams.marks is the narrower alternative — lets a Staff role enter marks without also
    # granting exams.edit's ability to redefine terms/events/grading rules.
    rbac_edit_permission = ('exams.edit', 'exams.marks')

    def get(self, request):
        class_id = request.GET.get('class_id')
        subject_id = request.GET.get('subject_id')
        exam_id = request.GET.get('exam_id')

        if not class_id:
            return Response({"error": "Please select a class stream."}, status=status.HTTP_400_BAD_REQUEST)

        # --- RBAC SECURITY CHECK ---
        is_cleared, role = get_teacher_exam_clearance(request.user, class_id, subject_id, exam_id)
        if not is_cleared:
            return Response(
                {"error": "Access Denied. You are not assigned to this class or subject."},
                status=status.HTTP_403_FORBIDDEN
            )
        # ---------------------------

        try:
            classroom = ClassStream.objects.select_related('grade').get(id=class_id)
        except ClassStream.DoesNotExist:
            return Response({"error": "Class not found."}, status=status.HTTP_404_NOT_FOUND)

        total_marks = None
        is_core_subject = True

        if subject_id:
            # Electives only apply to students who actually chose them — showing the full
            # homeroom for an elective would let a teacher enter (and later scale/rank) marks
            # for students who never took the subject.
            try:
                subject = Subject.objects.get(id=subject_id)
                is_core_subject = subject.is_core
                academic_year = None
                if exam_id:
                    exam_obj = ExamEvent.objects.select_related('term__academic_year').filter(id=exam_id).first()
                    if exam_obj:
                        total_marks = exam_obj.total_marks
                        academic_year = exam_obj.term.academic_year
                if academic_year is None:
                    academic_year = AcademicYear.objects.filter(is_active=True).first()
                students = get_applicable_students(subject, classroom, academic_year)
            except Subject.DoesNotExist:
                students = StudentExtra.objects.filter(cl_id=class_id, status=True)
        else:
            students = StudentExtra.objects.filter(cl_id=class_id, status=True)

        student_data = StudentGridSerializer(students, many=True).data

        existing_marks = []
        if subject_id and exam_id:
            results = ExamResult.objects.filter(
                exam_id=exam_id,
                subject_id=subject_id,
                student__in=students
            )
            existing_marks = ExamResultSerializer(results, many=True).data

        return Response({
            "students": student_data,
            "existing_marks": existing_marks,
            "total_marks": total_marks,
            "is_core_subject": is_core_subject
        }, status=status.HTTP_200_OK)

    def post(self, request):
        exam_id = request.data.get('exam_id')
        subject_id = request.data.get('subject_id')
        results_list = request.data.get('results', [])

        if not exam_id or not subject_id:
            return Response({"error": "Exam and Subject are required."}, status=status.HTTP_400_BAD_REQUEST)

        if not results_list:
             return Response({"message": "No marks to save."}, status=status.HTTP_200_OK)

        try:
            # Derive the class_id from the first student in the payload to run the security check
            first_student_id = results_list[0].get('student_id')
            first_student = StudentExtra.objects.select_related(
                'cl__class_teacher__user'
            ).get(id=first_student_id)
            class_id = first_student.cl.id

            # --- RBAC SECURITY CHECK ---
            is_cleared, role = get_teacher_exam_clearance(request.user, class_id, subject_id, exam_id)
            if not is_cleared:
                return Response(
                    {"error": "Access Denied. You are not assigned to teach this subject to this class."},
                    status=status.HTTP_403_FORBIDDEN
                )
            # ---------------------------

            exam = ExamEvent.objects.select_related('term__academic_year').get(id=exam_id)
            subject = Subject.objects.get(id=subject_id)
            teacher_profile = getattr(request.user, 'teacherextra', None)

            classroom = first_student.cl
            applicable_student_ids = set(
                get_applicable_students(subject, classroom, exam.term.academic_year).values_list('id', flat=True)
            )

            # --- MARK CEILING VALIDATION: reject the whole batch on the first bad row rather
            # than silently clamping or saving an impossible score (e.g. 90 on a 50-mark CAT). ---
            exam_total = exam.total_marks or 100
            for item in results_list:
                marks = item.get('marks')
                if marks is None or marks == '':
                    continue
                try:
                    marks_decimal = Decimal(str(marks))
                except Exception:
                    return Response({"error": f"'{marks}' is not a valid score."}, status=status.HTTP_400_BAD_REQUEST)
                if marks_decimal < 0 or marks_decimal > exam_total:
                    return Response({
                        "error": f"Score {marks} is outside the valid range (0-{exam_total}) for {exam.name}."
                    }, status=status.HTTP_400_BAD_REQUEST)
                if int(item.get('student_id')) not in applicable_student_ids:
                    return Response({
                        "error": f"One or more students are not enrolled in {subject.name} and cannot be scored for it."
                    }, status=status.HTTP_400_BAD_REQUEST)

            with transaction.atomic():
                for item in results_list:
                    student_id = item.get('student_id')
                    marks = item.get('marks')
                    remarks = item.get('remarks', '')

                    if marks is not None and marks != '':
                        # Fetching student here ensures we don't accidentally write to a student in a different class
                        student = StudentExtra.objects.get(id=student_id, cl_id=class_id)

                        existing_result = ExamResult.objects.filter(
                            exam=exam,
                            student=student,
                            subject=subject
                        ).first()

                        if existing_result:
                            # Safely cast the incoming frontend value to a Decimal to match database type integrity
                            new_score_decimal = Decimal(str(marks))
                            old_score_decimal = existing_result.marks_obtained

                            # If the score has genuinely changed, document it immutably in the System Audit Ledger
                            if old_score_decimal != new_score_decimal:
                                SystemAuditLog.objects.create(
                                    operator=request.user,
                                    action_type='UPDATE',
                                    module='ExamResult',
                                    description=(
                                        f"Exam Mark Alteration: Student {student.get_name} ({student.roll}) "
                                        f"in {subject.name} had their score changed from {old_score_decimal} "
                                        f"to {new_score_decimal} for assessment event '{exam.name}'."
                                    )
                                )

                        ExamResult.objects.update_or_create(
                            exam=exam,
                            student=student,
                            subject=subject,
                            defaults={
                                'marks_obtained': marks,
                                'teacher_remarks': remarks,
                                'teacher': teacher_profile
                            }
                        )

            return Response({"message": "Results successfully saved as Draft."}, status=status.HTTP_200_OK)

        except ExamEvent.DoesNotExist:
            return Response({"error": "Invalid Exam selected."}, status=status.HTTP_404_NOT_FOUND)
        except StudentExtra.DoesNotExist:
            return Response({"error": "One or more students could not be verified."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class BroadsheetGeneratorView(APIView):
    """
    The core calculation engine for aggregated exam results.
    Calculates totals, means, assigns grades dynamically, and ranks students.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'exams.view'

    def get(self, request):
        class_id = request.GET.get('class_id')
        exam_id = request.GET.get('exam_id')

        if not class_id or not exam_id:
            return Response({"error": "Class and Exam parameters are required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            target_class = ClassStream.objects.select_related(
                'grade',
                'class_teacher__user'
            ).get(id=class_id)
            curriculum = target_class.grade.curriculum_type  # '8-4-4' or 'CBC'

            exam = ExamEvent.objects.select_related('term__academic_year').get(id=exam_id)

            # ==========================================
            # 🌟 THE FIX: Check the actual Publish Status!
            # ==========================================
            publish_record = ClassExamStatus.objects.filter(exam=exam, class_stream=target_class).first()
            current_status = publish_record.status if publish_record else 'Draft'
            # ==========================================

            # 1. Fetch all active students in this class. For a split elective (a virtual
            # stream like "French - Group 1"), no student's cl is ever set to it directly — it
            # resolves back to every student taking that subject across the whole grade,
            # treating every teaching group of the subject as one class.
            students = resolve_classroom_students(target_class, exam.term.academic_year)

            # 2. Fetch all grading rules for the specific curriculum, ordered by highest score first
            rules = list(GradingRule.objects.filter(curriculum=curriculum).order_by('-min_score'))

            # 3. Build the table columns from subjects actually taught to this grade (its
            # SubjectQuota rows — both core and elective), not every subject in the whole
            # school regardless of grade.
            grade_subject_ids = SubjectQuota.objects.filter(grade=target_class.grade).values_list(
                'subject_id', flat=True)
            subjects = list(Subject.objects.filter(id__in=grade_subject_ids).values('code', 'name'))

            # 4. Fetch all relevant results
            results_qs = ExamResult.objects.filter(exam_id=exam_id, student__in=students).select_related('subject')

            # Organize results into a dictionary for fast lookup: dict[student_id][subject_code] = marks
            raw_scores = {}
            for res in results_qs:
                if res.student_id not in raw_scores:
                    raw_scores[res.student_id] = {}
                # Scale to a percentage of the exam's own total_marks rather than assuming
                # every exam is out of 100.
                raw_scores[res.student_id][res.subject.code] = get_scaled_score(res.marks_obtained, exam)

            # 5. The Calculation Loop
            broadsheet_data = []

            for student in students:
                student_scores = raw_scores.get(student.id, {})
                total_marks = Decimal('0.00')
                subjects_taken = 0 # <-- FIXED: Start at 0, only increment if there is a valid mark

                # Format scores for the frontend dictionary
                formatted_scores = {}
                for sub_code, mark in student_scores.items():
                    if mark is not None: # <-- FIXED: Only consider subjects filled with results
                        formatted_scores[sub_code] = float(mark)
                        total_marks += mark
                        subjects_taken += 1

                # Calculate Mean
                mean_score = Decimal('0.00')
                if subjects_taken > 0:
                    # Precise rounding to 2 decimal places using only valid taken subjects
                    mean_score = (total_marks / subjects_taken).quantize(Decimal('0.00'), rounding=ROUND_HALF_UP)

                # Determine Grade based on dynamic rules
                assigned_grade = "-"
                # Note: For CBC, logic will map to rubrics. For 8-4-4, we use the percentage mean.
                if subjects_taken > 0:
                    for rule in rules:
                        if rule.min_score <= mean_score <= rule.max_score:
                            assigned_grade = rule.grade_label
                            break

                broadsheet_data.append({
                    "id": student.id,
                    "roll": student.roll,
                    "name": student.get_name,
                    "scores": formatted_scores,
                    "total": float(total_marks),
                    "mean": float(mean_score),
                    "grade": assigned_grade,
                    "position": "-"  # Will be calculated below for 8-4-4
                })

            # 6. The Ranking Engine (Only applicable for 8-4-4)
            if curriculum == '8-4-4':
                # Sort descending by total marks
                broadsheet_data.sort(key=lambda x: x['total'], reverse=True)

                current_rank = 1
                for i, student_data in enumerate(broadsheet_data):
                    # Handle ties: If the current student has the same total as the previous, they get the same rank.
                    if i > 0 and student_data['total'] == broadsheet_data[i - 1]['total']:
                        student_data['position'] = broadsheet_data[i - 1]['position']
                    else:
                        student_data['position'] = current_rank
                    current_rank += 1
            else:
                # For CBC, we don't rank, but we might sort alphabetically by name
                broadsheet_data.sort(key=lambda x: x['name'])

            return Response({
                "curriculum": curriculum,
                "subjects": subjects,
                "results": broadsheet_data,
                "class_publish_status": current_status  # <--- Send the truth to React!
            }, status=status.HTTP_200_OK)

        except ClassStream.DoesNotExist:
            return Response({"error": "Class not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class ExamSelectionDataView(APIView):
    """
    Provides the necessary dropdown data (Classes, Subjects, Exams)
    for the frontend Exams Hub interfaces.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'exams.view'

    def get(self, request):
        try:
            # =========================================================================================
            # ✨ STEP 6 MODIFICATION: Cache user identity state values before entering the map loop
            # =========================================================================================
            is_admin = request.user.is_staff or request.user.is_superuser
            teacher_profile = getattr(request.user, 'teacherextra', None)

            # Only fetch live classrooms, optimizing performance with multi-table joins
            classes_qs = ClassStream.objects.select_related('grade', 'class_teacher__user').filter(
                is_deleted=False).order_by('id')

            # ✅ FIXED: Enforce contextual teacher scope restrictions using the 'allocations' relation
            if not is_admin:
                if teacher_profile:
                    classes_qs = classes_qs.filter(
                        Q(class_teacher=teacher_profile) |
                        Q(allocations__teacher=teacher_profile, allocations__is_active=True)
                    ).distinct()
                else:
                    classes_qs = classes_qs.none()

            # Splitting spawns one virtual ClassStream per teaching group ("French - Group 1",
            # "French - Group 2", ...) purely for timetable capacity — for exams/results the
            # school wants a split subject to appear and behave as ONE class, so collapse every
            # group of the same subject/grade down to a single dropdown entry (the lowest-id
            # group, since classes_qs is ordered by id) with the "- Group N" suffix stripped.
            class_data = []
            seen_virtual_subjects = set()
            for c in classes_qs:
                if c.is_virtual:
                    base_subject_name = c.name.split(' - Group')[0].strip()
                    dedup_key = (c.grade_id, base_subject_name.lower())
                    if dedup_key in seen_virtual_subjects:
                        continue
                    seen_virtual_subjects.add(dedup_key)
                    display_name = f"{c.grade.name} {base_subject_name} ({c.grade.curriculum_type})"
                else:
                    display_name = f"{c.grade.name} {c.name} ({c.grade.curriculum_type})"

                class_data.append({
                    "id": c.id,
                    "grade_id": c.grade_id,
                    "name": display_name,
                    "class_teacher_id": c.class_teacher.id if c.class_teacher else None,
                    "class_teacher_name": c.class_teacher.get_name if c.class_teacher else "Not Assigned",

                    # =========================================================================================
                    # ✨ STEP 6 MODIFICATION: Inject a secure capability token for direct client-side consumption
                    # =========================================================================================
                    "can_publish": is_admin or (teacher_profile is not None and c.class_teacher == teacher_profile)
                })
            # =========================================================================================

            # 2. Fetch Subjects
            subjects_qs = Subject.objects.all()

            # ✅ FIXED: Restrict subject matrix options based on active workload configurations
            if not is_admin and teacher_profile:
                allocated_subject_ids = SubjectAllocation.objects.filter(
                    teacher=teacher_profile, is_active=True
                ).values_list('subject_id', flat=True).distinct()
                subjects_qs = subjects_qs.filter(id__in=allocated_subject_ids)

            # Which grades actually teach each subject (via SubjectQuota) — lets the frontend
            # narrow the subject dropdown to what's relevant once a class is picked, instead of
            # showing every subject in the school regardless of grade.
            subject_grade_map = {}
            for row in SubjectQuota.objects.filter(subject__in=subjects_qs).values('subject_id', 'grade_id'):
                subject_grade_map.setdefault(row['subject_id'], []).append(row['grade_id'])

            subject_data = [
                {
                    "id": sub.id,
                    "name": sub.name,
                    "code": sub.code,
                    "is_core": sub.is_core,
                    "grade_ids": subject_grade_map.get(sub.id, [])
                }
                for sub in subjects_qs
            ]

            # 3. Fetch Exam Events
            exams_qs = ExamEvent.objects.select_related('term').all()
            exam_data = [
                {
                    "id": exam.id,
                    "name": f"{exam.term.name} - {exam.name}",
                    "total_marks": exam.total_marks
                }
                for exam in exams_qs
            ]

            return Response({
                "classes": class_data,
                "subjects": subject_data,
                "exams": exam_data
            }, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ExamSetupDataView(APIView):
    """
    Fetches the overview data for the Exam Setup tab.
    Returns active academic year, terms, and exams.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'exams.view'

    def get(self, request):
        try:

            # 1. NEW: Fetch Academic Years for the dropdown
            years_qs = AcademicYear.objects.all().order_by('-id')
            years_data = [
                {
                    "id": y.id,
                    "year": y.year  # Adjust 'name' to whatever field holds "2026"
                }
                for y in years_qs
            ]


            # Fetch Terms
            terms_qs = ExamTerm.objects.all().order_by('start_date')
            terms_data = [
                {
                    "id": term.id,
                    "name": term.name,
                    "academic_year_id": term.academic_year_id,
                    "startDate": term.start_date.strftime('%Y-%m-%d') if term.start_date else '',
                    "endDate": term.end_date.strftime('%Y-%m-%d') if term.end_date else '',
                    # Simple logic to determine if active, adjust based on your model
                    "status": "Active" if term.is_active else "Upcoming"
                }
                for term in terms_qs
            ]

            # Fetch Exams
            exams_qs = ExamEvent.objects.select_related('term').all().order_by('-id')
            exams_data = [
                {
                    "id": exam.id,
                    "term_name": exam.term.name if exam.term else "No Term",
                    "name": exam.name,
                    "exam_type": exam.exam_type,
                    "marks": exam.total_marks,
                    "status": exam.status,  # e.g., 'Draft' or 'Published'
                    "published_at": exam.published_at.isoformat() if exam.published_at else None # <-- NEW: Pass time to frontend
                }
                for exam in exams_qs
            ]

            # Find Active Term (first one marked active, or fallback)
            active_term_obj = ExamTerm.objects.filter(is_active=True).first()
            active_term_name = active_term_obj.name if active_term_obj else "No Active Term"

            # NEW: Find Active Academic Year for the top stats bar
            active_year_obj = AcademicYear.objects.filter(is_active=True).first()
            active_year_name = active_year_obj.year if active_year_obj else "No Active Year"

            return Response({
                "active_year": active_year_name,  # You can map this to an AcademicYear model if you have one
                "active_term": active_term_name,
                "academic_years": years_data,
                "terms": terms_data,
                "exams": exams_data
            }, status=status.HTTP_200_OK)

        except Exception as e:
            print(f"Crash in ExamSetupDataView: {str(e)}"),
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# --- UPDATED: ADD TERM VIEW ---
class AddExamTermView(APIView):

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'exams.edit'

    def post(self, request):
        try:
            data = request.data

            # 1. Grab the specific year the Admin selected in the modal
            year_id = data.get('academic_year_id')
            if not year_id:
                return Response({"error": "Please select an Academic Year."}, status=status.HTTP_400_BAD_REQUEST)

            academic_year = AcademicYear.objects.get(id=year_id)

            # 1. Automatically find the active Academic Year
            active_year = AcademicYear.objects.filter(is_active=True).first()

            # If the admin hasn't created a year yet, stop and warn them
            if not active_year:
                return Response(
                    {"error": "No active Academic Year found. Please configure an Academic Year first."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 2. Create the term and attach it to the active year
            term = ExamTerm.objects.create(
                academic_year=active_year,
                name=data.get('name'),
                start_date=data.get('startDate'),
                end_date=data.get('endDate'),
                is_active=False  # Default to false until admin activates it
            )
            return Response({"status": "success", "message": "Term created"}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# --- ADD EXAM EVENT VIEW ---
class AddExamEventView(APIView):

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'exams.edit'


    def post(self, request):
        try:
            data = request.data
            term = ExamTerm.objects.get(id=data.get('term_id'))

            # 1. Safely map the React dropdown values to your Django EXAM_TYPES
            frontend_type = data.get('exam_type')
            if frontend_type == 'Continuous Assessment':
                db_exam_type = 'CAT'
            else:
                db_exam_type = 'MAIN'  # Catches "Main Exam" and "Opener Exam"

            # 2. Create the exam event
            exam = ExamEvent.objects.create(
                term=term,
                name=data.get('name'),
                exam_type=db_exam_type,  # <-- FIXED: Uses mapped DB choices
                total_marks=data.get('marks'),  # <-- FIXED: Changed from max_marks to total_marks
                status='Draft'
            )
            return Response({"status": "success", "message": "Exam created"}, status=status.HTTP_201_CREATED)
        except ExamTerm.DoesNotExist:
            return Response({"error": "Selected term does not exist."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


# --- GRADING RULES VIEW (GET & POST) ---
class GradingRulesView(APIView):
    """
    Handles fetching and bulk-updating grading rules for a specific curriculum.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'exams.view'
    rbac_edit_permission = 'exams.edit'

    def get(self, request):
        curriculum = request.GET.get('curriculum', '8-4-4')
        try:
            # Order by highest score first
            rules = GradingRule.objects.filter(curriculum=curriculum).order_by('-min_score')
            rules_data = [
                {
                    "id": rule.id,
                    "grade_label": rule.grade_label,
                    "min_score": float(rule.min_score),
                    "max_score": float(rule.max_score),
                    "remarks": rule.remarks
                }
                for rule in rules
            ]
            return Response(rules_data, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def post(self, request):
        curriculum = request.data.get('curriculum')
        rules_data = request.data.get('rules', [])

        if not curriculum:
            return Response({"error": "Curriculum type is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            # 1. Delete all existing rules for this specific curriculum
            GradingRule.objects.filter(curriculum=curriculum).delete()

            # 2. Bulk create the new rules
            new_rules = [
                GradingRule(
                    curriculum=curriculum,
                    grade_label=rule.get('grade_label'),
                    min_score=rule.get('min_score'),
                    max_score=rule.get('max_score'),
                    remarks=rule.get('remarks')
                )
                for rule in rules_data
            ]
            GradingRule.objects.bulk_create(new_rules)

            return Response({"status": "success", "message": f"{curriculum} rules updated successfully."},
                            status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# --- NEW: ACTIVATE TERM VIEW ---
class ActivateTermView(APIView):
    """
    Sets a specific term as active and deactivates all others.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'exams.edit'

    def post(self, request, pk):
        try:
            # Deactivate all terms
            ExamTerm.objects.all().update(is_active=False)

            # Activate the target term
            target_term = ExamTerm.objects.get(pk=pk)
            target_term.is_active = True
            target_term.save()

            return Response({
                "status": "success",
                "message": f"{target_term.name} is now the active term."
            }, status=status.HTTP_200_OK)
        except ExamTerm.DoesNotExist:
                return Response({"error": "Term not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


    # schoolmanagement/exams/exam_views.py

class UpdateTermView(APIView):
    """Handles updating an existing Academic Term."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'exams.edit'

    def put(self, request, pk):
        try:
            term = ExamTerm.objects.get(pk=pk)
            data = request.data

            # Update the fields
            year_id = data.get('academic_year_id')
            if year_id:
                term.academic_year_id = year_id

            term.name = data.get('name', term.name)
            term.start_date = data.get('startDate', term.start_date)
            term.end_date = data.get('endDate', term.end_date)
            term.save()

            return Response({"status": "success", "message": "Term updated successfully."}, status=status.HTTP_200_OK)
        except ExamTerm.DoesNotExist:
            return Response({"error": "Term not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class DeleteTermView(APIView):
    """Handles the deletion of an Academic Term."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'exams.edit'

    def delete(self, request, pk):
        try:
            term = ExamTerm.objects.get(pk=pk)

            # Deleting a term CASCADEs through every ExamEvent, ExamResult, StudentReportSummary
            # and ClassExamStatus attached to it — a single click can silently destroy a whole
            # term's worth of entered marks. Report the blast radius and require an explicit
            # confirmation the first time, instead of deleting unconditionally.
            exam_count = ExamEvent.objects.filter(term=term).count()
            result_count = ExamResult.objects.filter(exam__term=term).count()
            published_count = ExamEvent.objects.filter(term=term, status='Published').count()

            if (exam_count or result_count) and request.query_params.get('force') != 'true':
                return Response({
                    "error": (
                        f"This term has {exam_count} exam event(s) with {result_count} entered mark(s) "
                        f"({published_count} published). Deleting it removes all of them permanently."
                    ),
                    "requires_confirmation": True,
                    "impact": {
                        "exam_count": exam_count,
                        "result_count": result_count,
                        "published_count": published_count
                    }
                }, status=status.HTTP_409_CONFLICT)

            term.delete()
            return Response({"status": "success", "message": "Term deleted successfully."}, status=status.HTTP_200_OK)
        except ExamTerm.DoesNotExist:
            return Response({"error": "Term not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class UpdateExamEventView(APIView):
    """Handles updating an existing Exam Event."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'exams.edit'

    def put(self, request, pk):
        try:
            exam = ExamEvent.objects.get(pk=pk)
            data = request.data

            # Safely map the React data to the DB fields
            term_id = data.get('term_id')
            if term_id:
                exam.term_id = term_id

            exam.name = data.get('name', exam.name)

            # Handle the exam_type mapping just like we did in the Create view
            frontend_type = data.get('exam_type')
            if frontend_type in ['CAT', 'MAIN']:
                exam.exam_type = frontend_type
            elif frontend_type == 'Continuous Assessment':
                exam.exam_type = 'CAT'
            elif frontend_type:
                exam.exam_type = 'MAIN'

            # React sends 'marks', DB expects 'total_marks'
            if data.get('marks'):
                exam.total_marks = data.get('marks')

            exam.save()

            return Response({"status": "success", "message": "Exam updated successfully."}, status=status.HTTP_200_OK)
        except ExamEvent.DoesNotExist:
            return Response({"error": "Exam not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class PublishExamEventView(APIView):
    """
    Publishes results class-by-class (for Class Teachers) OR school-wide (for Admins).
    Enforces strict Role-Based Access Control (RBAC).
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    # exams.publish is the narrower alternative — releasing results is high-stakes enough
    # to delegate separately from general exams.edit (term/event/grading-rule management).
    rbac_edit_permission = ('exams.edit', 'exams.publish')

    def post(self, request, pk):
        try:
            exam = ExamEvent.objects.get(pk=pk)
            class_id = request.data.get('class_id')

            if not class_id:
                return Response({"error": "Class ID is required to publish."}, status=status.HTTP_400_BAD_REQUEST)

            # 1. Determine the user's role
            # Safely check if the logged-in user has a Teacher profile
            teacher_profile = request.user.teacherextra if hasattr(request.user, 'teacherextra') else None

            # Reaching this line already required exams.edit or exams.publish (see this
            # view's rbac_edit_permission). A non-teacher who got this far — an admin, or
            # now a Staff account with an exams.publish-granting Role — has no "my assigned
            # class" notion, so treat them as admin-equivalent rather than blocking them for
            # lacking is_staff/is_superuser specifically.
            is_admin = (
                request.user.is_staff or request.user.is_superuser
                or request.user.groups.filter(name='ADMIN').exists()
                or not teacher_profile
            )

            # ==========================================
            # SCENARIO A: ADMIN PUBLISHING THE WHOLE SCHOOL
            # ==========================================
            if class_id == 'ALL':
                if not is_admin:
                    return Response({"error": "Only Administrators can publish the entire school at once."},
                                    status=status.HTTP_403_FORBIDDEN)

                # Update the master exam status
                exam.status = 'Published'
                exam.published_at = timezone.now()
                exam.save()

                # Loop through all classes and mark them as published
                all_classes = ClassStream.objects.filter(is_deleted=False)
                for c in all_classes:
                    status_record, _ = ClassExamStatus.objects.get_or_create(exam=exam, class_stream=c)
                    status_record.status = 'Published'
                    status_record.published_at = timezone.now()
                    status_record.published_by = request.user
                    status_record.save()

                # ✨ STEP 6 MODIFICATION: Document school-wide global publishing logs
                # =========================================================================================
                SystemAuditLog.objects.create(
                    operator=request.user,
                    action_type='UPDATE',
                    module='ExamEvent',
                    description=f"Global Publication: Entire school results compiled and locked for exam event '{exam.name}'."
                )

                return Response({
                    "status": "success",
                    "message": f"Successfully published {exam.name} for ALL classes!"
                }, status=status.HTTP_200_OK)

            # ==========================================
            # SCENARIO B: PUBLISHING A SINGLE CLASS
            # ==========================================
            class_stream = ClassStream.objects.get(id=class_id)

            # --- RBAC ENFORCEMENT ---
            if not is_admin:
                # If they aren't an admin, and they aren't the teacher assigned to this specific class... BLOCK THEM.
                if not teacher_profile or class_stream.class_teacher != teacher_profile:
                    return Response({
                        "error": f"Access Denied. You are only authorized to publish results for your assigned class."
                    }, status=status.HTTP_403_FORBIDDEN)

            # Proceed with publishing for this specific class
            status_record, created = ClassExamStatus.objects.get_or_create(
                exam=exam,
                class_stream=class_stream
            )

            if status_record.status == 'Published':
                return Response({"message": "This class is already published."}, status=status.HTTP_200_OK)

            status_record.status = 'Published'
            status_record.published_at = timezone.now()
            status_record.published_by = request.user
            status_record.save()

            # ✨ STEP 6 MODIFICATION: Record class-level localized validation audit trails
            # =========================================================================================
            SystemAuditLog.objects.create(
                operator=request.user,
                action_type='UPDATE',
                module='ClassExamStatus',
                description=f"Class Publication: Results for stream '{class_stream}' officially locked and released by authorized operator."
            )

            return Response({
                "status": "success",
                "message": f"Results for {class_stream.name} have been published!"
            }, status=status.HTTP_200_OK)

        except ExamEvent.DoesNotExist:
            return Response({"error": "Exam not found."}, status=status.HTTP_404_NOT_FOUND)
        except ClassStream.DoesNotExist:
            return Response({"error": "Class not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DeleteExamEventView(APIView):
    """Handles the deletion of an Exam Event."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = 'exams.edit'

    def delete(self, request, pk):
        try:
            exam = ExamEvent.objects.get(pk=pk)

            result_count = ExamResult.objects.filter(exam=exam).count()

            if result_count and request.query_params.get('force') != 'true':
                return Response({
                    "error": (
                        f"This exam has {result_count} entered mark(s)"
                        + (" and is Published" if exam.status == 'Published' else "")
                        + ". Deleting it removes all of them permanently."
                    ),
                    "requires_confirmation": True,
                    "impact": {"result_count": result_count, "status": exam.status}
                }, status=status.HTTP_409_CONFLICT)

            exam.delete()
            return Response({"status": "success", "message": "Exam deleted successfully."}, status=status.HTTP_200_OK)
        except ExamEvent.DoesNotExist:
            return Response({"error": "Exam not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class RevertExamEventView(APIView):
    """
    Reverses a published class back to Draft within a 2-hour window.
    Applies the same RBAC logic as the Publish view.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_edit_permission = ('exams.edit', 'exams.publish')

    def post(self, request, pk):
        try:
            class_id = request.data.get('class_id')
            if not class_id:
                return Response({"error": "Class ID is required to revert."}, status=status.HTTP_400_BAD_REQUEST)

            teacher_profile = request.user.teacherextra if hasattr(request.user, 'teacherextra') else None
            is_admin = (
                request.user.is_staff or request.user.is_superuser
                or request.user.groups.filter(name='ADMIN').exists()
                or not teacher_profile
            )

            # ==========================================
            # SCENARIO A: ADMIN REVERTING THE WHOLE SCHOOL
            # ==========================================
            if class_id == 'ALL':
                if not is_admin:
                    return Response({"error": "Only Administrators can revert the entire school."},
                                    status=status.HTTP_403_FORBIDDEN)

                exam = ExamEvent.objects.get(pk=pk)
                exam.status = 'Draft'
                exam.published_at = None
                exam.save()

                ClassExamStatus.objects.filter(exam=exam).update(status='Draft', published_at=None)

                return Response({"status": "success", "message": "All classes reversed to Draft successfully."},
                                status=status.HTTP_200_OK)

            # ==========================================
            # SCENARIO B: REVERTING A SINGLE CLASS
            # ==========================================
            class_stream = ClassStream.objects.get(id=class_id)

            # --- RBAC ENFORCEMENT ---
            if not is_admin:
                if not teacher_profile or class_stream.class_teacher != teacher_profile:
                    return Response({"error": "Access Denied. You can only revert results for your assigned class."},
                                    status=status.HTTP_403_FORBIDDEN)

            status_record = ClassExamStatus.objects.get(exam_id=pk, class_stream_id=class_id)

            if status_record.status != 'Published' or not status_record.published_at:
                return Response({"error": "This class is not currently published."}, status=status.HTTP_400_BAD_REQUEST)

            # 2-Hour Grace Period Check
            time_since_published = timezone.now() - status_record.published_at
            if time_since_published > timedelta(hours=2):
                return Response({
                    "error": "The 2-hour grace period has expired. You can no longer revert this."
                }, status=status.HTTP_403_FORBIDDEN)

            # Revert the class status
            status_record.status = 'Draft'
            status_record.published_at = None
            status_record.save()

            return Response({
                "status": "success",
                "message": f"{class_stream.name} reversed to Draft successfully."
            }, status=status.HTTP_200_OK)

        except ClassExamStatus.DoesNotExist:
            return Response({"error": "Publish record not found for this class."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def build_report_card_payload(student, exam):
    """
    Builds the comprehensive data required to print a single student's report card. Scales
    every mark to a percentage of its own exam's total_marks and dynamically resolves the
    officially allocated subject teacher rather than data entry clerks. Extracted so both the
    single-student view and the whole-class bulk-print view share one implementation — a bulk
    print run must show the exact same numbers as opening each student individually.
    """
    from school.models.classSubjects_models import SubjectAllocation

    curriculum = student.cl.grade.curriculum_type

    # Fetch the raw marks saved for the student
    results_qs = ExamResult.objects.filter(exam=exam, student=student).select_related('subject')

    # =========================================================================================
    # ✨ STEP 7 LOOKUP: Pre-fetch all official subject allocations for this specific term
    # to guarantee that the report cards render the assigned instructor accurately.
    # =========================================================================================
    allocations_qs = SubjectAllocation.objects.filter(
        classroom=student.cl,
        term=exam.term,
        academic_year=exam.term.academic_year,
        is_active=True
    ).select_related('subject', 'teacher__user')

    # Create a fast-lookup dictionary map: allocation_map[subject_id] = Teacher get_name string
    allocation_map = {alloc.subject_id: alloc.teacher.get_name for alloc in allocations_qs}
    # =========================================================================================

    subject_results = []
    total_marks = Decimal('0.00')
    subjects_taken = 0

    # Fetch Grading Rules
    rules = list(GradingRule.objects.filter(curriculum=curriculum).order_by('-min_score'))

    for res in results_qs:
        if res.marks_obtained is not None:
            scaled_mark = get_scaled_score(res.marks_obtained, exam)
            total_marks += scaled_mark
            subjects_taken += 1

            sub_grade = "-"
            for rule in rules:
                if rule.min_score <= scaled_mark <= rule.max_score:
                    sub_grade = rule.grade_label
                    break

            # =========================================================================================
            # ✨ STEP 7 RESOLUTION: Extract allocated identity, falling back cleanly if unassigned
            # =========================================================================================
            official_teacher_name = allocation_map.get(res.subject_id)
            if not official_teacher_name:
                # Fallback to the user profile stamped on the result record if allocation is blank
                official_teacher_name = res.teacher.get_name if res.teacher else "School Admin"
            # =========================================================================================

            subject_results.append({
                "subject": res.subject.name,
                "code": res.subject.code,
                "marks": float(scaled_mark),
                "grade": sub_grade,
                "remarks": res.teacher_remarks or "-",
                "teacher": official_teacher_name  # Injects the true allocation anchor token
            })

    # Calculate Overall Mean and Grade
    mean_score = Decimal('0.00')
    overall_grade = "-"
    if subjects_taken > 0:
        mean_score = (total_marks / subjects_taken).quantize(Decimal('0.00'), rounding=ROUND_HALF_UP)
        for rule in rules:
            if rule.min_score <= mean_score <= rule.max_score:
                overall_grade = rule.grade_label
                break

    # Calculate Position (For 8-4-4 only)
    position = "-"
    if curriculum == '8-4-4':
        class_students = StudentExtra.objects.filter(cl=student.cl, status=True)
        class_results = ExamResult.objects.filter(exam=exam, student__in=class_students)

        totals_dict = {}
        for cr in class_results:
            if cr.marks_obtained is not None:
                scaled_cr_mark = get_scaled_score(cr.marks_obtained, exam)
                totals_dict[cr.student_id] = totals_dict.get(cr.student_id, Decimal('0.00')) + scaled_cr_mark

        sorted_totals = sorted(totals_dict.values(), reverse=True)
        if total_marks in sorted_totals:
            position = sorted_totals.index(total_marks) + 1

    # Fetch Overall Remarks (Principal / Class Teacher)
    summary_obj = StudentReportSummary.objects.filter(exam=exam, student=student).first()

    return {
        "student": {
            "name": student.get_name,
            "roll": student.roll,
            "class_name": str(student.cl),
            "curriculum": curriculum
        },
        "exam": {
            "name": exam.name,
            "term": exam.term.name,
            "year": exam.term.academic_year.year
        },
        "results": subject_results,
        "aggregates": {
            "total": float(total_marks),
            "mean": float(mean_score),
            "grade": overall_grade,
            "position": position
        },
        "summary": {
            "class_teacher_remark": summary_obj.class_teacher_remark if summary_obj else "",
            "principal_remark": summary_obj.principal_remark if summary_obj else ""
        }
    }


class StudentReportCardView(APIView):
    """
    Fetches the comprehensive data required to print a single student's report card.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'exams.view'

    def get(self, request, exam_id, student_id):
        try:
            student = StudentExtra.objects.select_related('cl__grade').get(id=student_id)
            exam = ExamEvent.objects.select_related('term__academic_year').get(id=exam_id)
            return Response(build_report_card_payload(student, exam), status=status.HTTP_200_OK)

        except StudentExtra.DoesNotExist:
            return Response({"error": "Student not found."}, status=status.HTTP_404_NOT_FOUND)
        except ExamEvent.DoesNotExist:
            return Response({"error": "Exam not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ClassReportCardsAPIView(APIView):
    """
    Fetches every student's full report card payload for one class/exam in a single call,
    powering "print the whole class at once" instead of opening each student individually.
    Reuses build_report_card_payload() so bulk output is guaranteed identical to the
    single-student view.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'exams.view'

    def get(self, request, exam_id, class_id):
        try:
            exam = ExamEvent.objects.select_related('term__academic_year').get(id=exam_id)
            classroom = ClassStream.objects.select_related('grade').get(id=class_id)
        except ExamEvent.DoesNotExist:
            return Response({"error": "Exam not found."}, status=status.HTTP_404_NOT_FOUND)
        except ClassStream.DoesNotExist:
            return Response({"error": "Class not found."}, status=status.HTTP_404_NOT_FOUND)

        students = StudentExtra.objects.filter(
            cl=classroom, status=True
        ).select_related('cl__grade').order_by('roll')

        report_cards = [build_report_card_payload(student, exam) for student in students]

        return Response({
            "class_name": str(classroom),
            "exam_name": exam.name,
            "report_cards": report_cards,
        }, status=status.HTTP_200_OK)


class SaveReportSummaryView(APIView):
    """
    Saves and fetches manual remarks alongside rich student performance telemetry.
    Powers the split-screen, data-driven Class Teacher Remarks panel.
    Protected by Adoptive RBAC.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'exams.view'
    rbac_edit_permission = 'exams.edit'

    # =========================================================================================
    # ✨ STEP 5 ADDITION: Fetching Roster with Performance Metrics & Smart Telemetry Side-by-Side
    # =========================================================================================
    def get(self, request):
        class_id = request.GET.get('class_id')
        exam_id = request.GET.get('exam_id')

        if not class_id or not exam_id:
            return Response({"error": "Class ID and Exam ID parameters are required."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            # 1. --- RBAC SECURITY CHECK ---
            # Verifies if the logged-in operator has rights to evaluate this entire classroom
            from school.utils import get_teacher_exam_clearance
            is_cleared, role = get_teacher_exam_clearance(request.user, class_id, exam_id=exam_id)

            # Viewing the roster/report cards is allowed for anyone with legitimate access to
            # the class (Admin, Class Teacher, or an allocated Subject Teacher) — editing the
            # official remarks below in post() stays restricted to Admin/Class Teacher only.
            if role not in ["Admin", "Class_Teacher", "Subject_Teacher"]:
                return Response(
                    {"error": "Access Denied. You are not assigned to this class."},
                    status=status.HTTP_403_FORBIDDEN
                )

            try:
                exam = ExamEvent.objects.select_related('term__academic_year').get(id=exam_id)
                target_class = ClassStream.objects.select_related('grade').get(id=class_id)
            except (ExamEvent.DoesNotExist, ClassStream.DoesNotExist):
                return Response({"error": "The selected Exam Event or Class Stream index could not be resolved."},
                                status=status.HTTP_404_NOT_FOUND)

            curriculum = target_class.grade.curriculum_type if target_class.grade else "8-4-4"

            # 3. Retrieve all active students inside this classroom stream
            students = StudentExtra.objects.filter(cl=target_class, status=True).select_related('user')

            # Fetch all results and summary records for this class upfront to prevent query duplication loops
            all_results = ExamResult.objects.filter(exam=exam, student__in=students)
            all_summaries = StudentReportSummary.objects.filter(exam=exam, student__in=students)

            # Map existing remarks and data into fast-lookup in-memory dictionary hashes
            summary_map = {summary.student_id: summary for summary in all_summaries}

            # Group performance results by student ID mapping
            student_marks_map = {}
            for res in all_results:
                if res.student_id not in student_marks_map:
                    student_marks_map[res.student_id] = []
                scaled = get_scaled_score(res.marks_obtained, exam)
                if scaled is not None:
                    student_marks_map[res.student_id].append(scaled)

            # Calculate the overall class performance baseline to compute student deviations
            flat_all_marks = [mark for marks in student_marks_map.values() for mark in marks]
            class_mean_baseline = sum(flat_all_marks) / len(flat_all_marks) if flat_all_marks else Decimal('0.00')

            # 4. Compile the Data-Driven UX Payload Array
            roster_telemetry_packet = []

            from school.utils import compute_student_telemetry, calculate_dynamic_grade_details

            for student in students:
                student_marks = student_marks_map.get(student.id, [])
                total_marks = sum(student_marks)
                subjects_taken = len(student_marks)

                # Calculate individual student fixed-precision mean
                mean_score = Decimal('0.00')
                if subjects_taken > 0:
                    mean_score = (total_marks / subjects_taken).quantize(Decimal('0.00'), rounding=ROUND_HALF_UP)

                # Resolve current grade configurations and administrative default remarks
                grade_details = calculate_dynamic_grade_details(float(mean_score), curriculum)

                # Compute advanced performance progression metrics using Step 4 controllers
                progress_telemetry = compute_student_telemetry(student, exam, mean_score)

                # Compute deviation variance relative to class baselines
                deviation = mean_score - class_mean_baseline
                deviation_float = float(deviation.quantize(Decimal('0.00'), rounding=ROUND_HALF_UP))

                # Extract existing remarks if previously saved as draft progress
                saved_summary = summary_map.get(student.id)
                current_teacher_remark = saved_summary.class_teacher_remark if saved_summary else ""
                current_principal_remark = saved_summary.principal_remark if saved_summary else ""

                # 💡 BUILD THE SMART REMARK BANK RECOMMENDATIONS OPTIONS
                # Automatically presets vocabulary items depending on performance parameters to reduce typing fatigue
                smart_recommendations = []
                if mean_score >= 75:
                    smart_recommendations = [
                        "An exceptional, highly commendable performance. Keep maintaining this high standard.",
                        "Excellent work across all evaluation disciplines. A focused and consistent student.",
                        "Outstanding academic output. Possesses a strong grasp of subject material."
                    ]
                elif mean_score >= 50:
                    smart_recommendations = [
                        "A satisfactory performance. Shows good potential, though there is room for improvement.",
                        "Steady academic output. With consistent revision, better grades are within reach.",
                        "A good attempt. Needs to pay closer attention to weak areas in technical disciplines."
                    ]
                else:
                    smart_recommendations = [
                        "Academically weak performance. Intensive remedial study and revision are urgently required.",
                        "Below baseline standards. Requires close supervision and consistent guidance.",
                        "Disappointing results. Must double their effort in upcoming assessment blocks."
                    ]

                roster_telemetry_packet.append({
                    "student_id": student.id,
                    "student_name": student.get_name,
                    "student_roll": student.roll,
                    "performance": {
                        "total_marks": float(total_marks),
                        "mean_score": float(mean_score),
                        "grade_label": grade_details["label"],
                        "class_deviation": deviation_float,
                        "historical_velocity": progress_telemetry["historical_velocity"],
                        "trajectory_state": progress_telemetry["trajectory"]
                    },
                    "saved_remarks": {
                        "class_teacher_remark": current_teacher_remark,
                        "principal_remark": current_principal_remark
                    },
                    "smart_remark_bank": smart_recommendations
                })

            return Response({
                "class_name": str(target_class),
                "exam_name": exam.name,
                "curriculum": curriculum,
                "class_average_baseline": float(class_mean_baseline.quantize(Decimal('0.00'), rounding=ROUND_HALF_UP)),
                "roster": roster_telemetry_packet
            }, status=status.HTTP_200_OK)

        except ClassStream.DoesNotExist:
            return Response({"error": "Class Stream not found."}, status=status.HTTP_404_NOT_FOUND)
        except ExamEvent.DoesNotExist:
            return Response({"error": "Exam Event not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def post(self, request):
        student_id = request.data.get('student_id')
        exam_id = request.data.get('exam_id')

        if not student_id or not exam_id:
            return Response({"error": "Student and Exam IDs are required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            try:
                student = StudentExtra.objects.select_related('cl').get(id=student_id)
                exam = ExamEvent.objects.get(id=exam_id)
            except (StudentExtra.DoesNotExist, ExamEvent.DoesNotExist):
                return Response({"error": "Student or Exam selection indices could not be verified."},
                                status=status.HTTP_404_NOT_FOUND)

            # --- RBAC SECURITY CHECK ---
            is_cleared, role = get_teacher_exam_clearance(request.user, student.cl.id, exam_id=exam_id)

            if role not in ["Admin", "Class_Teacher"]:
                return Response(
                    {"error": "Only the Admin or designated Class Teacher can modify official remarks."},
                    status=status.HTTP_403_FORBIDDEN
                )

            summary_obj, created = StudentReportSummary.objects.get_or_create(
                student=student,
                exam=exam
            )

            if 'class_teacher_remark' in request.data:
                summary_obj.class_teacher_remark = request.data.get('class_teacher_remark', '')

            if 'principal_remark' in request.data:
                if role == "Admin":
                    summary_obj.principal_remark = request.data.get('principal_remark', '')

            summary_obj.save()
            return Response({"status": "success", "message": "Remarks saved successfully."}, status=status.HTTP_200_OK)

        except (StudentExtra.DoesNotExist, ExamEvent.DoesNotExist):
            return Response({"error": "Student or Exam not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class MissingMarksVerificationView(APIView):
    """
    Automated Compliance Engine: Cross-references active subject allocations
    against submitted exam results to pinpoint missing entry sheets.
    """
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, HasModulePermission]
    rbac_view_permission = 'exams.view'

    def get(self, request):
        class_id = request.GET.get('class_id')
        exam_id = request.GET.get('exam_id')

        # Baseline request validation
        if not class_id or not exam_id:
            return Response(
                {"error": "Both Class ID and Exam ID parameters are required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # =========================================================================================
            # ✨ STEP 3 LOOKUP: Fetch core anchor records utilizing optimized table joins
            # =========================================================================================
            try:
                exam = ExamEvent.objects.select_related('term__academic_year').get(id=exam_id)
                target_class = ClassStream.objects.get(id=class_id)
            except (ExamEvent.DoesNotExist, ClassStream.DoesNotExist):
                return Response({"error": "The targeted Exam event or Class stream registry does not exist."},
                                status=status.HTTP_404_NOT_FOUND)

            # 1. Fetch all active students currently occupying a seat in this class stream. A
            # split elective's virtual stream resolves to every student taking that subject
            # across the whole grade — every teaching group counts as the same class.
            active_students = resolve_classroom_students(target_class, exam.term.academic_year)
            total_student_count = active_students.count()

            if total_student_count == 0:
                return Response(
                    {"message": "No active students found in this class stream.", "matrix": []},
                    status=status.HTTP_200_OK
                )

            # 2. Fetch the master schedule allocations governing this class for this specific term
            # This tells us exactly which subjects are supposed to be taught and by whom.
            allocated_subjects = SubjectAllocation.objects.filter(
                classroom=target_class,
                term=exam.term,
                academic_year=exam.term.academic_year,
                is_active=True
            ).select_related('subject', 'teacher__user')

            # 3. The Cross-Reference Mapping Loop
            verification_matrix = []

            for allocation in allocated_subjects:
                # Electives only expect marks from students who actually chose the subject —
                # using the whole class roster here previously flagged every elective as
                # "Partial" forever, since no elective is taken by 100% of a homeroom class.
                expected_students = get_applicable_students(
                    allocation.subject, target_class, exam.term.academic_year
                )
                expected_count = expected_students.count()

                # Count how many individual student result marks have been saved for this subject and exam
                submitted_marks_count = ExamResult.objects.filter(
                    exam=exam,
                    subject=allocation.subject,
                    student__in=expected_students
                ).count()

                # Determine the current administrative operational status of the mark sheet
                if expected_count == 0:
                    submission_status = "No Enrolled Students"
                    missing_count = 0
                elif submitted_marks_count == 0:
                    submission_status = "Missing"  # Not a single mark entered
                    missing_count = expected_count
                elif submitted_marks_count < expected_count:
                    submission_status = "Partial"  # Teacher started entry but left records blank
                    missing_count = expected_count - submitted_marks_count
                else:
                    submission_status = "Complete"  # Perfect match: all students graded
                    missing_count = 0

                # Append the parsed audit ledger item to the final matrix array
                verification_matrix.append({
                    "subject_id": allocation.subject.id,
                    "subject_name": allocation.subject.name,
                    "subject_code": allocation.subject.code,
                    "teacher_id": allocation.teacher.id,
                    "teacher_name": allocation.teacher.get_name,
                    "status": submission_status,
                    "expected_submissions": expected_count,
                    "actual_submissions": submitted_marks_count,
                    "missing_records_count": missing_count
                })

            return Response({
                "class_name": str(target_class),
                "exam_name": exam.name,
                "total_class_students": total_student_count,
                "matrix": verification_matrix
            }, status=status.HTTP_200_OK)

        except ExamEvent.DoesNotExist:
            return Response({"error": "The selected Exam event could not be found."}, status=status.HTTP_404_NOT_FOUND)
        except ClassStream.DoesNotExist:
            return Response({"error": "The selected Class Stream could not be found."},
                            status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)