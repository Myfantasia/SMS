from rest_framework import viewsets
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated

from school.models.models import StudentExtra
from school.models.students_model import StudentTask
from school.serializers.student_serializers import StudentTaskSerializer


class CsrfExemptSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        return


class StudentTaskViewSet(viewsets.ModelViewSet):
    """Self-service CRUD for a student's own personal to-do items."""
    serializer_class = StudentTaskSerializer
    authentication_classes = [CsrfExemptSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        try:
            student = StudentExtra.objects.get(user=self.request.user, status=True)
        except StudentExtra.DoesNotExist:
            return StudentTask.objects.none()
        return StudentTask.objects.filter(student=student)

    def perform_create(self, serializer):
        try:
            student = StudentExtra.objects.get(user=self.request.user, status=True)
        except StudentExtra.DoesNotExist:
            raise PermissionDenied("Active student profile not found.")
        serializer.save(student=student)
