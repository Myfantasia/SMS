from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.db import transaction
from django.db.models import Avg, Q, Max, Min, F, FloatField, ExpressionWrapper
from school.rbac import HasModulePermission, user_has_permission
from school.models.models import StudentExtra, ExamTerm, ExamResult, AcademicYear, Notification, ParentExtra
from school.models.resultsModels import SubjectTermResult, StudentTermResult, ClassPerformanceAnalytics
from school.utils import calculate_dynamic_grade, get_scaled_score
from school.models.classSubjects_models import ClassStream, SubjectAllocation, SystemAuditLog
from decimal import Decimal, ROUND_HALF_UP


def safe_decimal_round(value):
    """
    Ensures precise arithmetic rounding using Decimal parameters
    to mitigate floating-point truncation faults.
    """
    if value is None:
        return Decimal('0.00')
    return Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def scaled_avg_marks(queryset):
    """
    DB-level equivalent of get_scaled_score() for aggregate queries: averages
    marks_obtained as a percentage of EACH row's own exam.total_marks, instead of a fixed
    magic-number normalization (e.g. the old "* 5" / "/ 60" pair here assumed CAT 1 is out of
    20 and MAIN out of 60 — contradicting the *2 assumption used everywhere else in the app,
    where CAT 1 is actually configured out of 50). Pulling every row into Python just to scale
    it isn't practical for a schoolwide aggregate, so this scales inside the query via annotate.
    """
    result = queryset.annotate(
        scaled=ExpressionWrapper(F('marks_obtained') * 100.0 / F('exam__total_marks'), output_field=FloatField())
    ).aggregate(avg=Avg('scaled'))
    return result['avg'] or 0


def generate_results_for_stream(stream, term):
    """
    The Processing Engine: aggregates raw exam scores into terminal per-subject and overall
    averages for one class stream. Extracted from GenerateTermResultsAPIView so the bulk,
    whole-school/whole-grade endpoint can share the exact same calculation instead of
    re-implementing it — a bulk run must produce identical numbers to running it one stream
    at a time. Returns a summary dict; never raises for "no active students", so a bulk caller
    can report a partial failure for one class without aborting the whole batch.
    """
    # Every calculate_dynamic_grade() call below must be scoped to this stream's actual
    # curriculum — CBC uses EE/ME/AE/BE rubric labels, not 8-4-4 letter grades, and the
    # default fallback silently produced 8-4-4 labels for CBC students otherwise.
    stream_curriculum = stream.grade.curriculum_type if stream.grade else '8-4-4'

    students = StudentExtra.objects.filter(cl=stream, status=True)
    if not students.exists():
        return {"students_assessed": 0, "error": "No active students found within this class stream."}

    all_stream_results = ExamResult.objects.filter(
        student__in=students,
        exam__term=term
    ).select_related('subject', 'exam')

    results_cache = {}
    for res in all_stream_results:
        if res.student_id not in results_cache:
            results_cache[res.student_id] = []
        results_cache[res.student_id].append(res)

    for student in students:
        student_results = results_cache.get(student.id, [])
        subjects_taken = set([res.subject for res in student_results])

        total_student_marks = Decimal('0.00')
        subject_count = 0

        for subject in subjects_taken:
            subject_results = [r for r in student_results if r.subject_id == subject.id]

            # Average every assessment that actually has a mark entered, each scaled to a
            # percentage of ITS OWN exam's total_marks — NOT a fixed /3 over CAT1/CAT2/MAIN.
            # The old code always divided by 3 regardless of how many of those three exams
            # had been entered, so a subject with only a CAT 1 mark got averaged against two
            # phantom zeros and came out ~1/3 of the student's real score. It also only
            # scaled an exam literally named "cat 1", leaving any other non-100-mark exam
            # (a differently-named CAT, a 60-mark opener, etc.) completely unscaled.
            scaled_scores = [
                get_scaled_score(res.marks_obtained, res.exam)
                for res in subject_results if res.marks_obtained is not None
            ]
            scaled_scores = [s for s in scaled_scores if s is not None]

            if not scaled_scores:
                continue

            subject_mean = sum(scaled_scores) / Decimal(len(scaled_scores))
            subject_grade = calculate_dynamic_grade(float(subject_mean), stream_curriculum)

            SubjectTermResult.objects.update_or_create(
                student=student, subject=subject, term=term,
                defaults={
                    'total_score': float(safe_decimal_round(subject_mean)),
                    'grade': subject_grade,
                }
            )

            total_student_marks += subject_mean
            subject_count += 1

        if subject_count > 0:
            overall_mean = total_student_marks / Decimal(str(subject_count))
            overall_grade = calculate_dynamic_grade(float(overall_mean), stream_curriculum)

            StudentTermResult.objects.update_or_create(
                student=student, term=term,
                defaults={
                    'class_stream': stream,
                    'total_marks': float(safe_decimal_round(total_student_marks)),
                    'mean_marks': float(safe_decimal_round(overall_mean)),
                    'mean_grade': overall_grade,
                    'is_published': False
                }
            )

    class_results = StudentTermResult.objects.filter(term=term, class_stream=stream).order_by('-mean_marks')
    total_stream_marks = Decimal('0.00')
    students_assessed = class_results.count()

    for rank, term_result in enumerate(class_results, start=1):
        term_result.stream_position = rank
        term_result.save()
        total_stream_marks += Decimal(str(term_result.mean_marks))

    if students_assessed > 0:
        stream_mean = total_stream_marks / Decimal(str(students_assessed))
        stream_mean_grade = calculate_dynamic_grade(float(stream_mean), stream_curriculum)

        ClassPerformanceAnalytics.objects.update_or_create(
            term=term, class_stream=stream,
            defaults={
                'total_students_assessed': students_assessed,
                'stream_mean_marks': float(safe_decimal_round(stream_mean)),
                'stream_mean_grade': stream_mean_grade,
            }
        )

    return {"students_assessed": students_assessed, "error": None}


class GenerateTermResultsAPIView(APIView):
    """
    Runs generate_results_for_stream() for a single class stream. Enforces runtime checks to
    block unauthorized cross-stream executions.
    """
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_edit_permission = 'results.edit'

    @transaction.atomic
    def post(self, request):
        year = request.data.get('year')
        term_name = request.data.get('term')
        stream_name = request.data.get('stream')

        if not all([year, term_name, stream_name]):
            return Response({"error": "Year, Term, and Stream parameters are mandatory."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            term = ExamTerm.objects.get(name=term_name, academic_year__year=year)
        except ExamTerm.DoesNotExist:
            return Response({"error": f"Term '{term_name}' for year '{year}' not found."},
                            status=status.HTTP_404_NOT_FOUND)

        stream = None
        for s in ClassStream.objects.select_related('grade').all():
            combined_string = f"{s.grade.name} {s.name}" if s.grade else s.name
            if combined_string == stream_name:
                stream = s
                break

        if not stream:
            return Response({"error": f"Class Stream registry matching '{stream_name}' not found."},
                            status=status.HTTP_404_NOT_FOUND)

        # ====================================================================
        # ALLOCATION POLICY GATE: GUARD AGAINST ARBITRARY RUNTIME CALLS
        # ====================================================================
        user = request.user
        # Reaching this line already required results.edit (HasModulePermission gates the
        # view). The per-stream ownership check below only makes sense for teachers (whose
        # "own stream" comes from their class/subject allocations) — a non-teacher who holds
        # results.edit (an admin, or now a Staff account with a Results-granting Role) has no
        # such notion of "their own stream" and should get the same broad access an admin does,
        # rather than a 403 for lacking a TeacherExtra profile they were never meant to have.
        is_admin = user.is_superuser or user.groups.filter(name='ADMIN').exists() or not hasattr(user, 'teacherextra')

        if not is_admin:
            teacher_profile = getattr(user, 'teacherextra', None)
            if not teacher_profile:
                return Response({"error": "Profile context unresolved."}, status=status.HTTP_403_FORBIDDEN)

            has_class_privilege = (stream.class_teacher_id == teacher_profile.id)
            has_subject_privilege = SubjectAllocation.objects.filter(
                teacher=teacher_profile, classroom=stream, is_active=True
            ).exists()

            if not (has_class_privilege or has_subject_privilege):
                return Response({
                    "error": f"Unauthorized Operation. You do not hold an active allocation to compile marks for {stream.name}."
                }, status=status.HTTP_403_FORBIDDEN)

        summary = generate_results_for_stream(stream, term)
        if summary["error"]:
            return Response({"error": summary["error"]}, status=status.HTTP_404_NOT_FOUND)

        return Response({
            "status": "success",
            "message": "Results compiled, math applied, and rankings generated successfully."
        }, status=status.HTTP_200_OK)


class BulkGenerateTermResultsAPIView(APIView):
    """
    Coordinated whole-grade / whole-school results compilation: runs generate_results_for_stream
    for every target class stream in one atomic transaction instead of clicking "Generate" once
    per stream at end of term — mirrors BulkAutoAllocateAPIView's pattern (one commit/rollback
    unit, a per-class summary, an audit log entry). Admin-only: unlike the single-stream
    endpoint, which lets a class/subject teacher compile just their own stream, a bulk run can
    span streams a given teacher has no privilege over, so it doesn't reuse that per-stream gate.
    """
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_edit_permission = 'results.edit'

    @transaction.atomic
    def post(self, request):
        year = request.data.get('year')
        term_name = request.data.get('term')
        grade_id = request.data.get('grade_id')  # optional: scope to one grade
        stream_ids = request.data.get('stream_ids')  # optional: explicit list

        if not all([year, term_name]):
            return Response({"error": "Year and Term are mandatory."}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        is_admin = user.is_superuser or user.groups.filter(name='ADMIN').exists()
        if not is_admin:
            return Response({"error": "Only Administrators can run a bulk results compilation."},
                            status=status.HTTP_403_FORBIDDEN)

        try:
            term = ExamTerm.objects.get(name=term_name, academic_year__year=year)
        except ExamTerm.DoesNotExist:
            return Response({"error": f"Term '{term_name}' for year '{year}' not found."},
                            status=status.HTTP_404_NOT_FOUND)

        if stream_ids:
            target_streams = list(ClassStream.live.filter(id__in=stream_ids, is_virtual=False)
                                   .select_related('grade'))
        elif grade_id:
            target_streams = list(ClassStream.live.filter(grade_id=grade_id, is_virtual=False)
                                   .select_related('grade'))
        else:
            target_streams = list(ClassStream.live.filter(is_virtual=False).select_related('grade'))

        if not target_streams:
            return Response({"error": "No class streams found for the given scope."},
                            status=status.HTTP_404_NOT_FOUND)

        per_class_summary = []
        total_students_assessed = 0
        for stream in target_streams:
            summary = generate_results_for_stream(stream, term)
            per_class_summary.append({
                "class_id": stream.id,
                "class_name": f"{stream.grade.name} {stream.name}" if stream.grade else stream.name,
                "students_assessed": summary["students_assessed"],
                "error": summary["error"],
            })
            total_students_assessed += summary["students_assessed"]

        classes_with_issues = [c for c in per_class_summary if c["error"]]

        SystemAuditLog.objects.create(
            operator=request.user if request.user.is_authenticated else None,
            action_type='EXECUTION',
            module='BulkGenerateTermResults',
            description=(
                f"Bulk-compiled results for {term.name} ({term.academic_year.year}) across "
                f"{len(target_streams)} class(es): {total_students_assessed} student(s) assessed, "
                f"{len(classes_with_issues)} class(es) with no active students."
            )
        )

        return Response({
            "message": (
                f"Bulk results compilation complete: {total_students_assessed} student(s) assessed "
                f"across {len(target_streams)} class(es)."
            ),
            "per_class": per_class_summary,
            "classes_with_issues": classes_with_issues,
        }, status=status.HTTP_200_OK)


class ClassPerformanceSummaryAPIView(APIView):
    """
    Generates class performance matrices and reports. Securely evaluates
    the teacher's relationship to the requested stream to pass custom action parameters.
    """
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_view_permission = 'results.view'

    def get(self, request):
        term_name = request.query_params.get('term', 'Term 1')
        year = request.query_params.get('year', '2026')
        stream_name = request.query_params.get('stream')

        stream = None
        for s in ClassStream.objects.select_related('grade').all():
            combined_string = f"{s.grade.name} {s.name}" if s.grade else s.name
            if combined_string == stream_name:
                stream = s
                break

        if not stream:
            return Response({"error": "Class Stream allocation context not found."}, status=status.HTTP_404_NOT_FOUND)

        # Evaluate identity contextual permissions
        user = request.user
        is_admin = user.is_superuser or user.groups.filter(name='ADMIN').exists()

        is_class_teacher = False
        is_subject_teacher = False

        if not is_admin:
            teacher_profile = getattr(user, 'teacherextra', None)
            if teacher_profile:
                is_class_teacher = (stream.class_teacher_id == teacher_profile.id)
                is_subject_teacher = SubjectAllocation.objects.filter(
                    teacher=teacher_profile, classroom=stream, is_active=True
                ).exists()

        try:
            analytics = ClassPerformanceAnalytics.objects.get(
                term__name=term_name, term__academic_year__year=year, class_stream=stream
            )
            student_results = StudentTermResult.objects.filter(
                term__name=term_name, term__academic_year__year=year, class_stream=stream
            ).order_by('stream_position').select_related('student__user')
        except ClassPerformanceAnalytics.DoesNotExist:
            return Response({"error": "No calculated result logs exist for this class specification."},
                            status=status.HTTP_404_NOT_FOUND)

        stream_curriculum = stream.grade.curriculum_type if stream.grade else '8-4-4'

        class_subjects_stats = SubjectTermResult.objects.filter(
            term__name=term_name, term__academic_year__year=year, student__cl=stream
        ).values('subject__id', 'subject__name').annotate(
            avg_score=Avg('total_score'), highest=Max('total_score'), lowest=Min('total_score')
        ).order_by('-avg_score')

        stream_allocations = SubjectAllocation.objects.filter(
            classroom=stream, term__name=term_name, academic_year__year=year, is_active=True
        ).select_related('teacher__user')
        allocation_map = {alloc.subject_id: alloc.teacher.get_name for alloc in stream_allocations if alloc.teacher}

        subject_performance_list = []
        for stat in class_subjects_stats:
            score = stat['avg_score'] or 0
            assigned_teacher_name = allocation_map.get(stat['subject__id'], "Unassigned")

            subject_performance_list.append({
                "subject": stat['subject__name'],
                "mean": round(float(score), 1),
                "grade": calculate_dynamic_grade(score, stream_curriculum),
                "highest": float(stat['highest']) if stat['highest'] else 0,
                "lowest": float(stat['lowest']) if stat['lowest'] else 0,
                "teacher": assigned_teacher_name
            })

        top_subject = class_subjects_stats.first()['subject__name'] if class_subjects_stats.exists() else "N/A"
        needs_attention = class_subjects_stats.last()['subject__name'] if class_subjects_stats.exists() else "N/A"

        rankings = []
        for result in student_results:
            out_of_marks = 0
            if result.mean_marks and float(result.mean_marks) > 0:
                subject_count = round(float(result.total_marks) / float(result.mean_marks))
                out_of_marks = subject_count * 100

            rankings.append({
                "id": result.student.id,
                "admNo": result.student.roll,
                "name": result.student.get_name,
                "marks": float(result.total_marks),
                "outOf": out_of_marks,
                "meanGrade": result.mean_grade or "N/A",
                "rank": result.stream_position
            })

        return Response({
            "summaryStats": {
                "totalStudents": analytics.total_students_assessed,
                "classMeanGrade": analytics.stream_mean_grade,
                "classMeanMarks": float(analytics.stream_mean_marks),
                "topSubject": top_subject,
                "needsAttention": needs_attention,

                # Contextual flags returned cleanly to direct teacher behaviors in React
                "isClassTeacher": is_admin or is_class_teacher,
                "isAllocatedSubjectTeacher": is_admin or is_subject_teacher
            },
            "subjectPerformance": subject_performance_list,
            "studentRankings": rankings
        }, status=status.HTTP_200_OK)


class StudentPerformanceAnalyticsAPIView(APIView):
    """
    Extracts deep historic data patterns for personal performance evaluation modals.
    Defensively protects processing threads against empty collections or data assembly gaps.
    """
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_view_permission = 'results.view'

    def get(self, request):
        student_id = request.query_params.get('student_id')
        year = request.query_params.get('year')
        term_name = request.query_params.get('term')

        if not all([student_id, year, term_name]):
            return Response({"error": "Required tracking request parameters are missing."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            student = StudentExtra.objects.get(id=student_id)
            term = ExamTerm.objects.get(name=term_name, academic_year__year=year)
        except (StudentExtra.DoesNotExist, ExamTerm.DoesNotExist):
            return Response({"error": "Target tracking indices could not be resolved."},
                            status=status.HTTP_404_NOT_FOUND)

        raw_marks = ExamResult.objects.filter(
            student=student, exam__term=term
        ).select_related('exam', 'subject', 'teacher__user')

        subject_results = SubjectTermResult.objects.filter(
            student=student, term=term
        ).select_related('subject')

        class_subject_results = SubjectTermResult.objects.filter(
            term=term, student__cl=student.cl
        ).values('subject__id', 'student__id', 'total_score').order_by('-total_score')

        subject_ranks = {}
        for csr in class_subject_results:
            sub_id = csr['subject__id']
            if sub_id not in subject_ranks:
                subject_ranks[sub_id] = []
            subject_ranks[sub_id].append(csr['student__id'])

        analytics_data = []
        for sub_res in subject_results:
            sub_id = sub_res.subject.id
            cat1, cat2, main = 0, 0, 0

            # ✅ INTEGRATION FIX: Fetch the current allocated teacher for this student's specific stream
            allocation = SubjectAllocation.objects.filter(
                classroom=student.cl,
                subject_id=sub_id,
                term=term,
                is_active=True
            ).select_related('teacher__user').first()
            teacher_name = allocation.teacher.get_name if (allocation and allocation.teacher) else "Unassigned"

            marks_for_sub = raw_marks.filter(subject_id=sub_id)
            for mark in marks_for_sub:
                if mark.marks_obtained is None: continue
                exam_name = mark.exam.name.upper()
                scaled = float(get_scaled_score(mark.marks_obtained, mark.exam))

                if "CAT 1" in exam_name:
                    cat1 = scaled
                elif "CAT 2" in exam_name:
                    cat2 = scaled
                elif any(kw in exam_name for kw in ["MAIN", "END TERM", "END OF TERM"]):
                    main = scaled

            rank_list = subject_ranks.get(sub_id, [])
            position = rank_list.index(student.id) + 1 if student.id in rank_list else "-"
            total_students_in_subject = len(rank_list)

            analytics_data.append({
                "subject": sub_res.subject.name,
                "teacher": teacher_name,  # Guaranteed connection to teacher allocation matrix
                "cat1": cat1,
                "cat2": cat2,
                "main": main,
                "termMean": float(sub_res.total_score),
                "grade": sub_res.grade or "N/A",
                "position": position,
                "outOf": total_students_in_subject
            })

        return Response({
            "student": {"name": student.get_name, "admNo": student.roll},
            "analytics": analytics_data
        }, status=status.HTTP_200_OK)


class StudentReportCardAPIView(APIView):
    """
    Serves two distinct audiences under one endpoint: staff (Admin/Teacher) can look up any
    student's report card by name/admission number, while a Student or Parent can only ever
    see their own (or their linked children's) — that second case is an identity/ownership
    check, not a module permission, so it must NOT sit behind HasModulePermission's RBAC
    gate (which only ever grants staff-facing module permissions like 'results.view' via a
    Role assignment — a student/parent account would never have one, and previously got a
    flat 403 before any of this view's own role logic ever ran).
    """
    permission_classes = [IsAuthenticated]
    authentication_classes = [SessionAuthentication]

    def get(self, request):
        search_query = request.query_params.get('search', '').strip()
        year = request.query_params.get('year')
        term_name = request.query_params.get('term')

        user = request.user
        is_staff = user.is_superuser or user.groups.filter(name__in=['ADMIN', 'TEACHER']).exists()

        if not is_staff:
            if user.groups.filter(name='STUDENT').exists():
                student_profile = getattr(user, 'studentextra', None)
                search_query = student_profile.roll if student_profile else ""
            elif user.groups.filter(name='PARENT').exists():
                parent_profile = getattr(user, 'parentextra', None)
                if parent_profile:
                    if not parent_profile.students.filter(roll=search_query).exists():
                        first_child = parent_profile.students.first()
                        search_query = first_child.roll if first_child else ""
                else:
                    search_query = ""
            else:
                # Not staff, not a recognized Student/Parent account — there is no legitimate
                # reason for this identity to look anyone up. Previously this fell through
                # with whatever `search` the client supplied left untouched, letting any
                # authenticated account outside those groups query ANY student's report card
                # by name/admission number (only the since-removed blanket 403 prevented it).
                return Response({"error": "You are not authorized to view report cards."},
                                status=status.HTTP_403_FORBIDDEN)

        if not search_query:
            return Response({"error": "Please enter an Admission Number or Student Name."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            parts = search_query.split()
            if len(parts) > 1:
                student = StudentExtra.objects.get(
                    Q(roll__iexact=search_query) |
                    (Q(user__first_name__icontains=parts[0]) & Q(user__last_name__icontains=parts[-1]))
                )
            else:
                student = StudentExtra.objects.get(
                    Q(roll__iexact=search_query) |
                    Q(user__first_name__icontains=search_query) |
                    Q(user__last_name__icontains=search_query)
                )
        except StudentExtra.DoesNotExist:
            return Response({"error": "Student not found. Check the spelling or admission number."},
                            status=status.HTTP_404_NOT_FOUND)
        except StudentExtra.MultipleObjectsReturned:
            return Response({"error": "Multiple students found with that name. Please use Admission Number."},
                            status=status.HTTP_400_BAD_REQUEST)

        if not year or not term_name:
            latest_result = StudentTermResult.objects.filter(student=student).order_by('-term__start_date').first()
            if not latest_result:
                return Response({"error": "No exam results have been calculated for this student yet."},
                                status=status.HTTP_404_NOT_FOUND)
            term_name = latest_result.term.name
            year = latest_result.term.academic_year.year

        try:
            term_summary = StudentTermResult.objects.get(
                student=student, term__name=term_name, term__academic_year__year=year
            )
            subject_results = SubjectTermResult.objects.filter(
                student=student, term__name=term_name, term__academic_year__year=year
            ).select_related('subject')
        except StudentTermResult.DoesNotExist:
            return Response({"error": f"No report card found for {student.get_name} in {term_name} {year}."},
                            status=status.HTTP_404_NOT_FOUND)

        if not is_staff and not term_summary.is_published:
            return Response({"error": "This terminal report card is currently pending administrative verification."},
                            status=status.HTTP_403_FORBIDDEN)

        raw_marks = ExamResult.objects.filter(
            student=student,
            exam__term__name=term_name,
            exam__term__academic_year__year=year
        ).select_related('exam', 'subject')

        curriculum = "8-4-4"
        if term_summary.class_stream and term_summary.class_stream.grade:
            curriculum = term_summary.class_stream.grade.curriculum_type

        # ✅ PERFORMANCE FIX: Fetch all relevant allocations in one database step
        class_allocations = SubjectAllocation.objects.filter(
            classroom=term_summary.class_stream,
            term=term_summary.term,
            is_active=True
        ).select_related('teacher__user')
        allocation_map = {alloc.subject_id: alloc.teacher.get_name for alloc in class_allocations if alloc.teacher}

        subjects_data = []

        # ==========================================
        # CBC DATA FORMATTING
        # ==========================================
        if curriculum == "CBC":
            for sub in subject_results:
                rubric_level = "Meeting Expectation (ME)"

                if sub.grade in ['A', 'A-', 'EE']:
                    rubric_level = "Exceeding Expectation (EE)"
                elif sub.grade in ['B+', 'B', 'B-', 'ME']:
                    rubric_level = "Meeting Expectation (ME)"
                elif sub.grade in ['C+', 'C', 'C-', 'AE']:
                    rubric_level = "Approaching Expectation (AE)"
                elif sub.grade in ['D+', 'D', 'D-', 'E', 'BE']:
                    rubric_level = "Below Expectation (BE)"

                assigned_teacher_name = allocation_map.get(sub.subject.id, "Unassigned")

                subjects_data.append({
                    "name": sub.subject.name,
                    "performanceLevel": rubric_level,
                    "teacher": assigned_teacher_name,  # <-- Dynamic database fetch
                    "remark": sub.subject_teacher_remark or "Demonstrating good progress in this learning area."
                })

        # ==========================================
        # 8-4-4 DATA FORMATTING
        # ==========================================
        else:
            for sub in subject_results:
                cat1, cat2, main = "-", "-", "-"

                marks_for_sub = raw_marks.filter(subject=sub.subject)
                for mark in marks_for_sub:
                    if mark.marks_obtained is None: continue
                    exam_name = mark.exam.name.upper()
                    scaled = float(get_scaled_score(mark.marks_obtained, mark.exam))

                    if "CAT 1" in exam_name:
                        cat1 = scaled
                    elif "CAT 2" in exam_name:
                        cat2 = scaled
                    elif "MAIN" in exam_name or "END TERM" in exam_name or "END of TERM" in exam_name:
                        main = scaled

                assigned_teacher_name = allocation_map.get(sub.subject.id, "Unassigned")

                subjects_data.append({
                    "name": sub.subject.name,
                    "cat1": cat1,
                    "cat2": cat2,
                    "main": main,
                    "total": float(sub.total_score) if sub.total_score is not None else 0.0,
                    "grade": sub.grade or "N/A",
                    "teacher": assigned_teacher_name,  # <-- Dynamic database fetch
                    "remark": sub.subject_teacher_remark or "Average"
                })

        # ==========================================
        # AUTO-COMMENT GENERATOR
        # ==========================================
        ct_comment = term_summary.class_teacher_remark
        pr_comment = term_summary.principal_remark

        if not ct_comment or not pr_comment:
            grade = term_summary.mean_grade

            if curriculum == "CBC":
                if grade in ['A', 'A-', 'EE']:
                    auto_ct = "The learner has consistently exceeded expectations across most learning areas."
                    auto_pr = "An outstanding mastery of core competencies. Keep it up!"
                elif grade in ['B+', 'B', 'B-', 'ME']:
                    auto_ct = "The learner is meeting the required expectations well."
                    auto_pr = "Demonstrating a solid grasp of the curriculum. Good progress."
                elif grade in ['C+', 'C', 'C-', 'AE']:
                    auto_ct = "The learner is approaching expectations but requires a bit more focus."
                    auto_pr = "Making steady progress. With more effort, higher levels can be achieved."
                else:
                    auto_ct = "The learner requires dedicated remedial support in several learning areas."
                    auto_pr = "Needs significant guidance to achieve the core competencies. Let's work together."
            else:
                if grade in ['A', 'A-']:
                    auto_ct = "An outstanding performance this term. A brilliant effort!"
                    auto_pr = "Excellent work. Congratulations on your top-tier results."
                elif grade in ['B+', 'B', 'B-']:
                    auto_ct = "A very good effort resulting in commendable grades. Keep it up."
                    auto_pr = "Good performance, showing strong potential."
                elif grade in ['C+', 'C', 'C-']:
                    auto_ct = "A fair attempt. With a bit more focus, you can achieve higher grades next term."
                    auto_pr = "Average performance. Consistent revision is recommended."
                elif grade in ['D+', 'D', 'D-']:
                    auto_ct = "Below average performance. You need to put in more effort and seek help."
                    auto_pr = "Requires immediate intervention and more dedication to studies."
                else:
                    auto_ct = "Poor performance. A serious turnaround strategy is needed."
                    auto_pr = "Did not meet expectations. Urgent academic support and parental involvement required."

            ct_comment = ct_comment or auto_ct
            pr_comment = pr_comment or auto_pr

        return Response({
            "student": {
                "name": term_summary.student.get_name,
                "admNo": term_summary.student.roll,
                "stream": term_summary.class_stream.name if term_summary.class_stream else "N/A",
                "curriculum": curriculum
            },
            "termInfo": {
                "year": year,
                "term": term_name
            },
            "summary": {
                "totalMarks": float(term_summary.total_marks) if term_summary.total_marks is not None else 0.0,
                "outOf": subject_results.count() * 100,
                "meanGrade": term_summary.mean_grade or "N/A",
                "classPosition": term_summary.class_position or "-",
                "streamPosition": term_summary.stream_position or "-",
            },
            "remarks": {
                "classTeacher": ct_comment,
                "principal": pr_comment
            },
            "subjects": subjects_data,
            "isPublished": term_summary.is_published
        }, status=status.HTTP_200_OK)

    def post(self, request):
        if not request.user.is_superuser and not request.user.groups.filter(name='ADMIN').exists():
            return Response({"error": "Administrative clearance required to verify and publish report card registries."},
                            status=status.HTTP_403_FORBIDDEN)

        adm_no = request.data.get('admNo')
        year = request.data.get('year')
        term_name = request.data.get('term')

        if not all([adm_no, year, term_name]):
            return Response({"error": "Missing required data to publish the report card."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            term_summary = StudentTermResult.objects.select_related('student__user', 'term__academic_year').get(
                student__roll__iexact=adm_no,
                term__name=term_name,
                term__academic_year__year=year
            )
            term_summary.is_published = True
            term_summary.save()

            # Notify the student and every linked parent — is_published is the exact flag
            # StudentReportCardAPIView.get() checks to decide whether they're allowed to view
            # it, so this is the one moment that actually unlocks something for them to see.
            student = term_summary.student
            recipients = []
            if student.user_id:
                recipients.append(student.user_id)
            recipients.extend(
                ParentExtra.objects.filter(students=student).values_list('user_id', flat=True)
            )

            notification_title = "Report Card Published"
            notification_message = (
                f"{student.get_name}'s report card for {term_summary.term.name} "
                f"{term_summary.term.academic_year.year} is now available to view."
            )
            Notification.objects.bulk_create([
                Notification(recipient_id=recipient_id, title=notification_title, message=notification_message)
                for recipient_id in set(recipients)
            ])

            return Response({"message": "Report card published successfully!"}, status=status.HTTP_200_OK)
        except StudentTermResult.DoesNotExist:
            return Response({"error": "Could not find the specific report card to publish."},
                            status=status.HTTP_404_NOT_FOUND)


class SchoolAnalyticsAPIView(APIView):
    """
    1. MAIN DASHBOARD VIEW
    Provides lightweight, categorized stats for the main School Analytics page.
    """
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_view_permission = 'results.view'

    def get(self, request):
        year = request.query_params.get('year', '2026')
        term_name = request.query_params.get('term', 'Term 1')

        try:
            current_term = ExamTerm.objects.get(name=term_name, academic_year__year=year)
        except ExamTerm.DoesNotExist:
            return Response({"error": "Selected term does not exist."}, status=status.HTTP_404_NOT_FOUND)

        all_class_analytics = ClassPerformanceAnalytics.objects.filter(term=current_term).select_related(
            'class_stream__grade')
        all_results = StudentTermResult.objects.filter(term=current_term).select_related('student',
                                                                                         'class_stream__grade')

        # 1. MACRO STATS
        total_assessed = sum([c.total_students_assessed for c in all_class_analytics])
        school_mean = all_class_analytics.aggregate(Avg('stream_mean_marks'))['stream_mean_marks__avg'] or 0

        # "Passed" = mean score >= 50%, the same cutoff the existing 8-4-4 label list already
        # implied (C starts at 50) — but the list was missing 'A+' (the actual top 8-4-4 grade;
        # only 'A-' was listed) and every CBC label entirely, so every CBC student in the school
        # — and every 8-4-4 student scoring an outright A+ — was being counted as failed here
        # regardless of their real performance. EE/ME are CBC's >=50% tiers (AE starts at 25%).
        passed_students = all_results.filter(
            mean_grade__in=['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'EE', 'ME']
        ).count()
        pass_rate = round((passed_students / total_assessed) * 100, 1) if total_assessed > 0 else 0

        # 2. IMPROVEMENT STAT
        improvement_val = 0.0
        if term_name == 'Term 1':
            normalized_cat1 = scaled_avg_marks(
                ExamResult.objects.filter(exam__term=current_term, exam__name__icontains="CAT 1"))
            normalized_main = scaled_avg_marks(
                ExamResult.objects.filter(exam__term=current_term, exam__name__icontains="MAIN"))
            improvement_val = round(normalized_main - normalized_cat1, 1)
        else:
            prev_term_name = 'Term 1' if term_name == 'Term 2' else 'Term 2'
            prev_term = ExamTerm.objects.filter(name=prev_term_name, academic_year__year=year).first()
            if prev_term:
                prev_school_mean = \
                    ClassPerformanceAnalytics.objects.filter(term=prev_term).aggregate(Avg('stream_mean_marks'))[
                        'stream_mean_marks__avg'] or 0
                improvement_val = round(float(school_mean) - float(prev_school_mean), 1)

        improvement_str = f"+{improvement_val}%" if improvement_val >= 0 else f"{improvement_val}%"

        # 3. TRENDS & DISTRIBUTIONS
        term_trends = []
        for t in ['Term 1', 'Term 2', 'Term 3']:
            trend_mean = \
                ClassPerformanceAnalytics.objects.filter(term__name=t, term__academic_year__year=year).aggregate(
                    Avg('stream_mean_marks'))['stream_mean_marks__avg'] or 0
            term_trends.append({"term": t, "mean": round(trend_mean, 1)})

        # Buckets by EXACT label sets spanning both curricula, not a startswith prefix — CBC's
        # "BE" (Below Expectation, its worst grade) starts with "B" and was silently being
        # counted in the "B (Good)" bucket alongside 8-4-4's B+/B/B- grades, the same way "AE"
        # (Approaching Expectation) would land in "A (Distinction)". Each bucket now pairs the
        # semantically-equivalent tier from both scales.
        grade_distribution = [
            {"name": "A / EE (Top)", "value": all_results.filter(mean_grade__in=['A+', 'A', 'A-', 'EE']).count(),
             "color": "#10b981"},
            {"name": "B / ME (Good)", "value": all_results.filter(mean_grade__in=['B+', 'B', 'B-', 'ME']).count(),
             "color": "#3b82f6"},
            {"name": "C / AE (Average)", "value": all_results.filter(mean_grade__in=['C+', 'C', 'C-', 'AE']).count(),
             "color": "#f59e0b"},
            {"name": "D / BE (Below Avg)", "value": all_results.filter(mean_grade__in=['D+', 'D', 'D-', 'BE']).count(),
             "color": "#ef4444"},
            {"name": "E (Fail)", "value": all_results.filter(mean_grade='E').count(), "color": "#64748b"},
        ]

        # 4. GROUPED STREAMS (By Grade)
        grouped_streams = {}
        for stat in all_class_analytics:
            grade_name = stat.class_stream.grade.name if stat.class_stream.grade else "Unassigned Grade"
            if grade_name not in grouped_streams:
                grouped_streams[grade_name] = []
            grouped_streams[grade_name].append({
                "id": stat.id,
                "stream": stat.class_stream.name,
                "mean": f"{stat.stream_mean_marks}%",
                "grade": stat.stream_mean_grade,
                "trend": "up" if stat.stream_mean_marks >= 50 else "down"
            })

        # 5. TOP PERFORMERS (Grouped by Grade)
        grouped_top_performers = {}
        for result in all_results.order_by('-mean_marks'):
            grade_name = result.class_stream.grade.name if result.class_stream and result.class_stream.grade else "Unassigned"
            if grade_name not in grouped_top_performers:
                grouped_top_performers[grade_name] = []

            if len(grouped_top_performers[grade_name]) < 5:
                grouped_top_performers[grade_name].append({
                    "id": result.student.roll,
                    "name": result.student.get_name,
                    "stream": result.class_stream.name if result.class_stream else "N/A",
                    "marks": float(result.total_marks),
                    "grade": result.mean_grade or "N/A"
                })

        # 6. SUBJECT ALERTS & BEST SUBJECT
        subject_alerts = []
        best_subject_name = "N/A"
        highest_sub_mean = 0

        # ✅ FIX: Group by unique ID string path instead of plain names to prevent naming collisions
        class_subjects_stats = SubjectTermResult.objects.filter(term=current_term).values(
            'subject__id', 'subject__name', 'student__cl_id', 'student__cl__name', 'student__cl__grade__name'
        ).annotate(avg_score=Avg('total_score'))

        overall_subject_stats = SubjectTermResult.objects.filter(term=current_term).values(
            'subject__name'
        ).annotate(avg_score=Avg('total_score')).order_by('-avg_score')

        if overall_subject_stats.exists():
            best_sub = overall_subject_stats.first()
            best_subject_name = best_sub['subject__name']
            highest_sub_mean = best_sub['avg_score']

        for stat in class_subjects_stats:
            score = stat['avg_score'] or 0
            if score < 50:
                grade_header = stat['student__cl__grade__name'] or "General"

                # ✅ FIX: Explicit relational lookups provide robust multi-grade validation
                alloc = SubjectAllocation.objects.filter(
                    classroom_id=stat['student__cl_id'],
                    subject_id=stat['subject__id'],
                    term=current_term,
                    is_active=True
                ).select_related('teacher__user').first()
                assigned_teacher = alloc.teacher.get_name if (alloc and alloc.teacher) else "Unassigned"

                subject_alerts.append({
                    "id": f"{stat['subject__name']}-{stat['student__cl__name']}",
                    "subject": f"{stat['subject__name']} ({grade_header})",
                    "mean": f"{round(score, 1)}%",
                    "drop": "Requires Attention",
                    "teacher": assigned_teacher
                })

        return Response({
            "schoolStats": {
                "totalAssessed": total_assessed,
                # school_mean blends every stream regardless of curriculum into one number, so
                # there's no single "correct" curriculum to grade it against — defaults to 8-4-4
                # labels for this one headline stat; the grade_distribution breakdown above is
                # the curriculum-accurate view.
                "schoolMeanGrade": calculate_dynamic_grade(school_mean),
                "passRate": f"{pass_rate}%",
                "improvement": improvement_str
            },
            "termTrends": term_trends,
            "gradeDistribution": grade_distribution,
            "groupedStreams": grouped_streams,
            "groupedTopPerformers": grouped_top_performers,
            "subjectAlerts": subject_alerts,
            "subjectPerformances": {
                "bestSubject": best_subject_name,
                "bestMean": f"{round(highest_sub_mean, 1)}%"
            }
        }, status=status.HTTP_200_OK)


class ResultsFilterOptionsAPIView(APIView):
    """
    Feeds dropdown options to the React frontend with dynamic data.
    Upgraded with secure backend-driven filtering to separate a teacher's
    assigned classes from the general list.
    """
    permission_classes = [IsAuthenticated, HasModulePermission]
    authentication_classes = [SessionAuthentication]
    rbac_view_permission = 'results.view'

    def get(self, request):
        years = AcademicYear.objects.values_list('year', flat=True).distinct().order_by('-year')
        terms = ExamTerm.objects.values_list('name', flat=True).distinct().order_by('name')

        # Base streams list for lenient cross-school browsing
        streams = ClassStream.objects.select_related('grade').all()
        stream_names = [f"{stream.grade.name} {stream.name}" if stream.grade else stream.name for stream in streams]

        # Secure container to pass a teacher's active workspace allocations
        my_stream_names = []
        user = request.user
        is_admin = user.is_superuser or user.groups.filter(name='ADMIN').exists()

        if not is_admin:
            teacher_profile = getattr(user, 'teacherextra', None)
            if teacher_profile:
                # Identify streams where this specific teacher is either the main Class Teacher
                # or has an active subject allocated to them
                allocated_streams = ClassStream.objects.filter(
                    Q(class_teacher=teacher_profile) |
                    Q(allocations__teacher=teacher_profile, allocations__is_active=True)
                ).distinct().select_related('grade')

                my_stream_names = [
                    f"{stream.grade.name} {stream.name}" if stream.grade else stream.name
                    for stream in allocated_streams
                ]

        return Response({
            "years": list(years),
            "terms": list(terms),
            "streams": stream_names,
            "my_streams": my_stream_names  # Injected cleanly to allow distinct frontend layouts
        }, status=status.HTTP_200_OK)


class TermImprovementAnalyticsAPIView(APIView):
    """
    2. DEEP DIVE: IMPROVEMENT MODAL VIEW
    Purpose: Fetches exhaustive, comparative data.
    If Term 1: Compares internal term exams (CAT vs Main).
    If Term 2/3: Compares against the previous historical term.
    """
    permission_classes = [IsAuthenticated, HasModulePermission]  # <-- FIXED: Secure RBAC Access Gate
    authentication_classes = [SessionAuthentication]
    rbac_view_permission = 'results.view'

    def get(self, request):
        year = request.query_params.get('year', '2026')
        term_name = request.query_params.get('term', 'Term 1')

        try:
            current_term = ExamTerm.objects.get(name=term_name, academic_year__year=year)
        except ExamTerm.DoesNotExist:
            return Response({"error": "Term not found."}, status=status.HTTP_404_NOT_FOUND)

        all_class_analytics = ClassPerformanceAnalytics.objects.filter(term=current_term).select_related(
            'class_stream__grade')

        improvement_data = {"improved": [], "dropped": []}

        # ==========================================
        # LOGIC A: Term 1 (CAT vs MAIN Comparison)
        # ==========================================
        if term_name == 'Term 1':
            for stat in all_class_analytics:
                stream = stat.class_stream
                grade_name = stream.grade.name if stream.grade else "Unknown"

                # Calculate specific CAT vs MAIN for this exact stream
                normalized_cat1 = scaled_avg_marks(ExamResult.objects.filter(
                    exam__term=current_term, student__cl=stream, exam__name__icontains="CAT 1"))
                normalized_main = scaled_avg_marks(ExamResult.objects.filter(
                    exam__term=current_term, student__cl=stream, exam__name__icontains="MAIN"))
                jump = round(normalized_main - normalized_cat1, 2)

                record = {
                    "grade": grade_name,
                    "stream": stream.name,
                    "previous_score": f"{round(normalized_cat1, 1)}% (CAT 1)",
                    "current_score": f"{round(normalized_main, 1)}% (MAIN)",
                    "jump": f"+{jump}%" if jump >= 0 else f"{jump}%"
                }

                if jump >= 0:
                    improvement_data["improved"].append(record)
                else:
                    improvement_data["dropped"].append(record)

        # ==========================================
        # LOGIC B: Term 2 or 3 (Previous Term Comparison)
        # ==========================================
        else:
            prev_term_name = 'Term 1' if term_name == 'Term 2' else 'Term 2'
            prev_term = ExamTerm.objects.filter(name=prev_term_name, academic_year__year=year).first()

            if prev_term:
                prev_analytics = ClassPerformanceAnalytics.objects.filter(term=prev_term)

                for stat in all_class_analytics:
                    stream = stat.class_stream
                    grade_name = stream.grade.name if stream.grade else "Unknown"
                    current_mean = float(stat.stream_mean_marks)

                    prev_stat = prev_analytics.filter(class_stream=stream).first()
                    if prev_stat:
                        prev_mean = float(prev_stat.stream_mean_marks)
                        jump = round(current_mean - prev_mean, 2)

                        record = {
                            "grade": grade_name,
                            "stream": stream.name,
                            "previous_score": f"{round(prev_mean, 1)}% ({prev_term_name})",
                            "current_score": f"{round(current_mean, 1)}% ({term_name})",
                            "jump": f"+{jump}%" if jump >= 0 else f"{jump}%"
                        }

                        if jump >= 0:
                            improvement_data["improved"].append(record)
                        else:
                            improvement_data["dropped"].append(record)

        # Sort results so the biggest improvements/drops are at the top
        improvement_data["improved"] = sorted(improvement_data["improved"],
                                              key=lambda x: float(x['jump'].replace('%', '').replace('+', '')),
                                              reverse=True)
        improvement_data["dropped"] = sorted(improvement_data["dropped"],
                                             key=lambda x: float(x['jump'].replace('%', '')), reverse=False)

        return Response(improvement_data, status=status.HTTP_200_OK)


class SubjectMatrixAnalyticsAPIView(APIView):
    """
    3. DEEP DIVE: SUBJECT MODAL VIEW
    Purpose: Fetches exhaustive subject data grouped heavily by Grade,
    allowing Principals to compare subjects laterally across streams.
    """
    permission_classes = [IsAuthenticated, HasModulePermission]  # <-- FIXED: Secure RBAC Access Gate
    authentication_classes = [SessionAuthentication]
    rbac_view_permission = 'results.view'

    def get(self, request):
        year = request.query_params.get('year', '2026')
        term_name = request.query_params.get('term', 'Term 1')

        try:
            current_term = ExamTerm.objects.get(name=term_name, academic_year__year=year)
        except ExamTerm.DoesNotExist:
            return Response({"error": "Term not found."}, status=status.HTTP_404_NOT_FOUND)

        all_subjects = SubjectTermResult.objects.filter(term=current_term).select_related('subject',
                                                                                          'student__cl__grade')

        # Dictionary structure to hold: Grade -> Subject -> Stream -> Scores List
        subject_dict = {}

        for sub_res in all_subjects:
            stream = sub_res.student.cl
            grade_name = stream.grade.name if stream and stream.grade else "Unassigned"
            sub_name = sub_res.subject.name
            stream_name = stream.name if stream else "Unassigned"

            if grade_name not in subject_dict:
                subject_dict[grade_name] = {}
            if sub_name not in subject_dict[grade_name]:
                subject_dict[grade_name][sub_name] = {}
            if stream_name not in subject_dict[grade_name][sub_name]:
                subject_dict[grade_name][sub_name][stream_name] = []

            subject_dict[grade_name][sub_name][stream_name].append(float(sub_res.total_score))

        # Format broadly for the React Modal
        formatted_grades = {}
        for grade_name, subjects in subject_dict.items():
            formatted_grades[grade_name] = []

            for sub_name, streams in subjects.items():
                stream_list = []
                for stream_name, scores in streams.items():
                    avg_score = sum(scores) / len(scores) if scores else 0
                    stream_list.append({
                        "name": stream_name,
                        "mean": f"{round(avg_score, 1)}%",
                        "highest_score": max(scores) if scores else 0,
                        "students_assessed": len(scores)
                    })

                # Sort streams alphabetically or by performance
                stream_list = sorted(stream_list, key=lambda x: x['name'])

                formatted_grades[grade_name].append({
                    "subject": sub_name,
                    "streams": stream_list
                })

        return Response({"grades": formatted_grades}, status=status.HTTP_200_OK)