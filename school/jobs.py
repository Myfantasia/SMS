"""
Shared plumbing for turning a heavy, synchronous view into a queued Celery background
job — used by every endpoint that creates a BackgroundJob + dispatches a task (see
orchestration/tasks.py). Centralizing this here means every future heavy endpoint gets the
same worker-liveness check and response shape for free, instead of each view
reinventing it slightly differently.

--------------------------------------------------------------------------------
WHEN A NEW ENDPOINT SHOULD USE THIS (vs. staying a normal synchronous view)
--------------------------------------------------------------------------------
Reach for `dispatch_background_job` when the endpoint's body does ANY of:
  - Loops over a whole grade/term/school's worth of rows, not one record.
  - Is realistically going to take more than ~1-2 seconds once the school's data has
    grown (the four existing jobs — timetable generation, rollover, bulk-allocate,
    bulk results — were all measured in multiple seconds even at moderate scale).
  - Mutates a resource more than one admin could plausibly touch at the same time
    (allocations, timetable rows, term results) — this needs the per-scope Redis lock
    pattern in orchestration/tasks.py regardless of how fast it runs, since the risk is
    correctness (a race), not just latency.

A single-record create/update/delete, or anything that stays fast even at full scale
(most CRUD views in this app), should stay a normal synchronous DRF view. Converting
those would only add polling latency for no benefit.
--------------------------------------------------------------------------------
"""
from rest_framework import status
from rest_framework.response import Response

from apps.core.models import BackgroundJob


def is_worker_available(queue='bulk_ops', timeout=1.0):
    """
    Broadcasts a liveness ping to Celery workers and checks whether any of them are
    actually consuming `queue`. Without this check, an endpoint happily creates a
    BackgroundJob and pushes a task onto Redis even if nothing is running to read it —
    the job then sits in PENDING forever with no error anywhere, and the frontend's
    poll only ever reports a generic timeout. This turns that silent failure into an
    immediate, clear one.
    """
    from django.conf import settings
    if settings.CELERY_TASK_ALWAYS_EAGER:
        # Tests (and only tests — see settings.py) run tasks inline in-process via
        # .delay(), with no real worker involved at all, so the liveness check itself
        # doesn't apply.
        return True

    from schoolmanagement.celery import app as celery_app
    try:
        active_queues = celery_app.control.inspect(timeout=timeout).active_queues() or {}
    except Exception:
        return False
    for worker_queues in active_queues.values():
        if any(q.get('name') == queue for q in worker_queues):
            return True
    return False


def dispatch_background_job(*, job_type, task, task_args, operator, queue='bulk_ops'):
    """
    Creates a BackgroundJob row and dispatches `task` onto `queue` with `str(job.id)`
    prepended to `task_args`. Returns (job, None) on success, or (None, Response) with
    a 503 if no worker is currently consuming that queue — callers should return the
    Response directly in that case rather than the usual 202.
    """
    if not is_worker_available(queue):
        return None, Response(
            {"error": "The background worker is not running, so this operation cannot be "
                      "processed right now. Contact your system administrator."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    job = BackgroundJob.objects.create(job_type=job_type, operator=operator)
    task.delay(str(job.id), *task_args)
    return job, None
