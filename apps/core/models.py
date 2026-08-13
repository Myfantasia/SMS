"""Models for the `core` app.

Cross-cutting infrastructure: audit logging, background job tracking. Foundation layer -- no deps on any other app.

Track B step 2: BackgroundJob and SystemAuditLog physically relocated here
from school/models/{jobs_models.py,classSubjects_models.py} via a hand-written
SeparateDatabaseAndState migration pair (this app's 0001_initial creates both
in *state* only; school's paired migration deletes them from *state* only).
Meta.db_table is pinned to each model's original table name below so the
underlying tables (school_backgroundjob, school_systemauditlog) never
physically move -- only Django's bookkeeping of which app owns the model.
"""
import uuid

from django.contrib.auth.models import User
from django.db import models


class BackgroundJob(models.Model):
    """
    Tracks a heavy operation (timetable generation, bulk allocation, bulk result
    compilation) handed off to a Celery worker instead of run inline on the request.
    The view creates one of these and returns its id immediately; the frontend polls
    GET /api/jobs/<id>/ until status is SUCCESS or FAILURE.
    """
    STATUS_CHOICES = [
        ('PENDING', 'Queued'),
        ('RUNNING', 'Running'),
        ('SUCCESS', 'Completed'),
        ('FAILURE', 'Failed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job_type = models.CharField(max_length=50)
    operator = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='background_jobs')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='PENDING')
    result = models.JSONField(null=True, blank=True)
    error_message = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'school_backgroundjob'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.job_type} ({self.status}) - {self.id}"


class SystemAuditLog(models.Model):
    """
    The immutable operational ledger.
    Tracks critical automated actions, rule changes, and deletions.
    """
    ACTION_CHOICES = [
        ('CREATE', 'Created Resource'),
        ('UPDATE', 'Modified Settings / Rules'),
        ('DELETE', 'Soft Deleted Resource'),
        ('RESTORE', 'Restored Soft Deleted Resource'),
        ('SIMULATION', 'Executed Allocation Simulation'),
        ('EXECUTION', 'Committed Live Allocation Splits'),
        ('APPROVE', 'Approved Pending Account'),
        ('REJECT', 'Rejected Pending Account'),
        ('PROMOTE', 'Promoted or Graduated Student'),
        ('AUTH_SUCCESS', 'Authentication Succeeded'),
        ('AUTH_FAILURE', 'Authentication Failed'),
    ]

    operator = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_actions')
    action_type = models.CharField(max_length=20, choices=ACTION_CHOICES)
    module = models.CharField(max_length=100, help_text="e.g., 'SplittingEngine', 'ClassStream'")
    description = models.TextField(help_text="Detailed summary of the operational event.")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'school_systemauditlog'
        ordering = ['-timestamp']

    def __str__(self):
        operator_name = self.operator.username if self.operator else "System Engine"
        return f"{self.timestamp.strftime('%Y-%m-%d %H:%M')} | {operator_name} -> {self.action_type}"
