from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status

from apps.core.models import BackgroundJob


class BackgroundJobStatusAPIView(APIView):
    """
    Polled by the frontend after a bulk-operation endpoint returns 202 + job_id.
    Deliberately scoped to jobs the requesting user themselves triggered — nothing
    here needs finer-grained RBAC since a job's own result never contains data the
    triggering user couldn't already see via the original action's permission check.
    """
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, job_id):
        try:
            job = BackgroundJob.objects.get(id=job_id, operator=request.user)
        except BackgroundJob.DoesNotExist:
            return Response({"error": "Job not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response({
            "job_id": str(job.id),
            "job_type": job.job_type,
            "status": job.status,
            "result": job.result,
            "error_message": job.error_message,
            "created_at": job.created_at,
            "completed_at": job.completed_at,
        })
