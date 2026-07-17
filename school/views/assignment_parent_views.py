from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.db.models import Q

from school.models.models import ParentExtra
from school.models.assignments_models import StudentSubmission
from school.views.assignment_common import (
    get_parent_profile, get_student_profile, build_review_payload, review_error_response
)


class ParentMonitoringAPIView(APIView):
    """
    Feeds the Parent Dashboard. Returns only graded assignments or late/missing action items
    for all children linked to this parent.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        parent_id = request.query_params.get('parent_id')

        try:
            parent = get_parent_profile(request.user, parent_id)
            children = parent.students.all()

            alerts = []

            for child in children:
                submissions = StudentSubmission.objects.filter(
                    Q(grading_status='Published') | Q(is_late=True),
                    student=child
                ).select_related('assignment', 'assignment__subject')

                for sub in submissions:
                    alert_type = "Action Required: Late" if sub.is_late and sub.grading_status != 'Published' else "Grade Available"

                    alerts.append({
                        "student_id": child.id,
                        "student_name": child.get_name,
                        "assignment_id": sub.assignment_id,
                        "assignment_title": sub.assignment.title,
                        "subject": sub.assignment.subject.name,
                        "alert_type": alert_type,
                        "score": float(sub.total_awarded_score) if sub.grading_status == 'Published' else None,
                        "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else "Not Submitted"
                    })

            return Response({"parent_alerts": alerts}, status=status.HTTP_200_OK)

        except ParentExtra.DoesNotExist:
            return Response({"error": "Parent profile not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": f"Backend Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ParentSubmissionReviewAPIView(APIView):
    """
    Allows a parent to review one of their children's graded (Published) assignments.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        student_id = request.query_params.get('student_id')
        assignment_id = request.query_params.get('assignment_id')

        if not student_id or not assignment_id:
            return Response({"error": "Missing parameters."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            # Reuses the shared IDOR-checked resolver: a parent can only reach their own children.
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
