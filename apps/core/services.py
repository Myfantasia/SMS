"""Public service surface for the `core` app.

Cross-cutting infrastructure: audit logging, background job tracking.
Foundation layer -- no deps on any other app.

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet. This is what lets `core` be swapped for
a real HTTP client later (Phase 2/3) without touching any caller.

This app has no dependencies on any other app -- it sits at the very
foundation, alongside `identity` (which itself depends on `core` for audit
logging).

Track B step 2: SystemAuditLog/BackgroundJob physically relocated to
apps/core/models.py -- function bodies below now import from there directly.

`write_audit_log` in particular collapses what were ~8 separate direct
`from school.models.classSubjects_models import SystemAuditLog` call sites
(admin_invite_views.py, leave_views.py, password_reset_views.py,
rbac_views.py, results_views.py, teacher_dashboard_view.py, views.py, all 4
Celery tasks, and rbac.py's assert_curriculum_editable) into one function --
every one of those call sites should be swept to call this instead.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional

from apps.core.models import BackgroundJob, SystemAuditLog

ActionType = Literal[
    "CREATE", "UPDATE", "DELETE", "RESTORE", "SIMULATION",
    "EXECUTION", "APPROVE", "REJECT", "AUTH_SUCCESS", "AUTH_FAILURE",
]
JobStatus = Literal["PENDING", "RUNNING", "SUCCESS", "FAILURE"]


@dataclass(frozen=True)
class AuditLogEntryDTO:
    id: int
    operator_id: Optional[int]
    action_type: str
    module: str
    description: str
    ip_address: Optional[str]
    timestamp: datetime


@dataclass(frozen=True)
class BackgroundJobDTO:
    id: str
    job_type: str
    operator_id: Optional[int]
    status: str
    result: Optional[dict]
    error_message: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]


def write_audit_log(
    *,
    operator_id: Optional[int],
    action_type: ActionType,
    module: str,
    description: str,
    ip_address: Optional[str] = None,
    school_id: Optional[int] = None,  # unused (single-tenant today) -- threaded now so a future multi-school retrofit doesn't need to touch every call site
) -> AuditLogEntryDTO:
    row = SystemAuditLog.objects.create(
        operator_id=operator_id,
        action_type=action_type,
        module=module,
        description=description,
        ip_address=ip_address,
    )
    return AuditLogEntryDTO(
        id=row.id,
        operator_id=row.operator_id,
        action_type=row.action_type,
        module=row.module,
        description=row.description,
        ip_address=row.ip_address,
        timestamp=row.timestamp,
    )


def create_background_job(*, job_type: str, operator_id: Optional[int]) -> BackgroundJobDTO:
    job = BackgroundJob.objects.create(job_type=job_type, operator_id=operator_id, status="PENDING")
    return _job_to_dto(job)


def mark_job_running(job_id: str) -> None:
    BackgroundJob.objects.filter(id=job_id).update(status="RUNNING")


def mark_job_success(job_id: str, result: dict) -> BackgroundJobDTO:
    from django.utils import timezone

    job = BackgroundJob.objects.get(id=job_id)
    job.status = "SUCCESS"
    job.result = result
    job.completed_at = timezone.now()
    job.save(update_fields=["status", "result", "completed_at"])
    return _job_to_dto(job)


def mark_job_failure(job_id: str, error_message: str) -> BackgroundJobDTO:
    from django.utils import timezone

    job = BackgroundJob.objects.get(id=job_id)
    job.status = "FAILURE"
    job.error_message = error_message
    job.completed_at = timezone.now()
    job.save(update_fields=["status", "error_message", "completed_at"])
    return _job_to_dto(job)


def get_job(job_id: str) -> Optional[BackgroundJobDTO]:
    job = BackgroundJob.objects.filter(id=job_id).first()
    return _job_to_dto(job) if job else None


def _job_to_dto(job) -> BackgroundJobDTO:
    return BackgroundJobDTO(
        id=str(job.id),
        job_type=job.job_type,
        operator_id=job.operator_id,
        status=job.status,
        result=job.result,
        error_message=job.error_message,
        created_at=job.created_at,
        completed_at=job.completed_at,
    )
