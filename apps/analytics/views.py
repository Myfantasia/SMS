from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.db.models import Avg, F, FloatField, ExpressionWrapper

from school.rbac import HasModulePermission
from apps.identity.models import StudentExtra
from apps.academics.models import ExamTerm
from apps.exams.models import ExamResult
from apps.results.models import SubjectTermResult, StudentTermResult, ClassPerformanceAnalytics
from apps.allocations.services import get_allocated_teacher_name
from school.utils import calculate_dynamic_grade, get_scaled_score


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
            teacher_name = get_allocated_teacher_name(
                classroom_id=student.cl_id, subject_id=sub_id, term_id=term.id,
            ) or "Unassigned"

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
                assigned_teacher = get_allocated_teacher_name(
                    classroom_id=stat['student__cl_id'], subject_id=stat['subject__id'], term_id=current_term.id,
                ) or "Unassigned"

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


class TermImprovementAnalyticsAPIView(APIView):
    """
    2. DEEP DIVE: IMPROVEMENT MODAL VIEW
    Purpose: Fetches exhaustive, comparative data.
    If Term 1: Compares internal term exams (CAT vs Main).
    If Term 2/3: Compares against the previous historical term.
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
    permission_classes = [IsAuthenticated, HasModulePermission]
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
