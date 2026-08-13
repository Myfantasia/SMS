"""
Celery tasks for the four heaviest synchronous endpoints in the app (timetable
auto-generation, allocation rollover, bulk auto-allocate, bulk term-result
compilation). Each task is the exact body that used to run inline in the view's
request/response cycle — the views now only do fast validation (missing params,
permission checks, existence checks) synchronously and return 202 + a BackgroundJob
id immediately, dispatching everything below to a worker process.

Every task follows the same shape: mark the job RUNNING, do the work, mark it
SUCCESS with a `result` dict shaped exactly like the old synchronous JSON response
(so the frontend's polling code can treat a completed job's `result` the same way it
used to treat the direct POST response), or mark it FAILURE with `error_message` on
any exception.

This module (physically relocated from school/tasks.py) is the modular monolith's
composition-root/orchestration layer: `rollover_allocations_task` and
`bulk_auto_allocate_task` are the one place allowed to call both
apps.allocations.services and apps.timetable.services in the same function body,
wrapping them in the same transaction.atomic() block the original inline logic
used — see the plan's "allocations <-> timetable problem" section for why this
composition can't live inside either app's own services.py without creating a
dependency cycle. `orchestration` is not one of the 14 apps (see .importlinter's
`app-layering` contract: it sits in its own top layer, and nothing may import it
back), so it is exempt from the "apps never import each other" rule by design.
"""
from celery import shared_task
from celery.exceptions import MaxRetriesExceededError
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from apps.core import services as core_services
from apps.allocations.services import rollover_allocations, bulk_auto_allocate, AllocationValidationError
from apps.timetable.services import (
    get_active_timetable_id, sync_with_allocation_changes, generate_lessons_for_scope, get_timetable_name,
)
from shared.events.bus import bus
from shared.events.types import BackgroundJobCompletedEvent

# How long a task waits for a scope lock (held by someone else's still-running job)
# before giving up. 20 retries * 10s = ~200s, comfortably under pollJob()'s 300s
# frontend timeout — so a genuine "gave up" FAILURE is available before the frontend
# ever falls back to its own generic timeout message.
LOCK_RETRY_COUNTDOWN = 10
LOCK_MAX_RETRIES = 20


def _notify_operator(*, job_id, job_type, operator_id, succeeded, error_message):
    """
    Job completion notifications only ever go to the one user who triggered the job
    (`operator_id`) — these are long-running admin actions with no other stakeholder,
    unlike e.g. leave-approval notices which fan out to a teacher. Lets an admin who
    kicked off a job and navigated away still find out it finished, instead of only
    ever seeing the result if they happen to be sitting on the page polling.

    Publishes BackgroundJobCompletedEvent through the event bus instead of writing a
    Notification directly — apps.messaging.receivers.handle_background_job_completed
    is the subscriber (registered from MessagingConfig.ready()) that builds the
    title/message/action_url and creates the row. This is what lets orchestration
    stay ignorant of `messaging` even existing, per the plan's event-bus design.
    """
    if operator_id is None:
        return
    bus.publish(BackgroundJobCompletedEvent(
        job_id=str(job_id), job_type=job_type, operator_id=operator_id,
        succeeded=succeeded, error_message=error_message, occurred_at=timezone.now(),
    ))


def _acquire_lock_or_retry(task, job_id, lock_key):
    """
    Tries to atomically acquire `lock_key` (cache.add only succeeds if it's free). If
    another job currently holds it, this parks the task back on the queue and retries
    every LOCK_RETRY_COUNTDOWN seconds — so a second submission for the same scope
    isn't rejected, it just runs automatically the moment the current one releases the
    lock, and every requester still gets their own job tracked/notified independently.

    Returns True if the lock was acquired (caller should proceed and release it in a
    `finally`). Returns False if retries were exhausted — the job has already been
    marked FAILURE and the caller should return immediately without doing any work.

    Must be called BEFORE the task's own try/except Exception block: task.retry()
    raises Celery's internal Retry exception to signal "reschedule me", and that must
    propagate all the way out to the worker machinery uncaught — catching it here
    (via `except MaxRetriesExceededError`, which is a distinct exception raised only
    once retries are exhausted) is what keeps the two cases separate.
    """
    if cache.add(lock_key, job_id, timeout=300):
        return True

    from django.conf import settings
    if settings.CELERY_TASK_ALWAYS_EAGER:
        # Eager mode (tests only) runs .delay() as one single synchronous call with no
        # real worker cycle behind it — task.retry() would raise Celery's Retry exception
        # straight back out through .delay() into the calling view, uncaught, instead of
        # actually being rescheduled. There's no way to meaningfully "wait and try again"
        # inside one synchronous call, so this simulates giving up immediately instead.
        _mark_failure(job_id, "Timed out waiting for another operation on this scope to finish. Please try again.")
        return False

    try:
        task.retry(countdown=LOCK_RETRY_COUNTDOWN, max_retries=LOCK_MAX_RETRIES)
    except MaxRetriesExceededError:
        _mark_failure(job_id, "Timed out waiting for another operation on this scope to finish. Please try again.")
        return False


def _mark_running(job_id):
    core_services.mark_job_running(job_id)


def _mark_success(job_id, result):
    dto = core_services.mark_job_success(job_id, result)
    _notify_operator(
        job_id=dto.id, job_type=dto.job_type, operator_id=dto.operator_id,
        succeeded=True, error_message=None,
    )


def _mark_failure(job_id, error_message):
    dto = core_services.mark_job_failure(job_id, error_message)
    _notify_operator(
        job_id=dto.id, job_type=dto.job_type, operator_id=dto.operator_id,
        succeeded=False, error_message=dto.error_message,
    )


@shared_task(bind=True)
def generate_timetable_task(self, job_id, timetable_id, stream_id, grade_id, lock_key, operator_id):
    from apps.academics.models import ClassStream
    from school.views.views_timetable import cache_unscheduled_basket_errors

    if not _acquire_lock_or_retry(self, job_id, lock_key):
        return

    _mark_running(job_id)
    try:
        # generate_lessons_for_scope clears every in-scope stream's existing lessons up
        # front, then repopulates them one stream at a time — without this wrapper, a
        # crash partway through would leave the already-cleared-but-not-yet-repopulated
        # streams with fewer/no lessons until the redelivered retry finishes. Wrapping the
        # whole thing means a mid-run crash rolls back to the pre-run state instead —
        # either every in-scope stream ends up fully regenerated, or none of them do.
        with transaction.atomic():
            streams = ClassStream.live.all().select_related('grade')
            if stream_id:
                streams = streams.filter(id=stream_id)
            elif grade_id:
                streams = streams.filter(grade_id=grade_id)
            stream_ids = list(streams.values_list('id', flat=True))

            allocations_created, unscheduled_basket_errors = generate_lessons_for_scope(
                timetable_id=timetable_id, class_stream_ids=stream_ids
            )

            if stream_id:
                scope_desc = f'stream_id={stream_id}'
            elif grade_id:
                scope_desc = f'grade_id={grade_id}'
            else:
                scope_desc = 'all streams'
            timetable_name = get_timetable_name(timetable_id=timetable_id)
            core_services.write_audit_log(
                operator_id=operator_id,
                action_type='EXECUTION',
                module='Timetable',
                description=f"Auto-generated '{timetable_name}' ({scope_desc}): "
                            f"{allocations_created} lessons scheduled, {len(unscheduled_basket_errors)} warning(s)."
            )

        # Deliberately outside the atomic block — this only updates a cache entry (see
        # cache_unscheduled_basket_errors), not the database, so it doesn't need to roll
        # back with the transaction above.
        cache_unscheduled_basket_errors(timetable_id, unscheduled_basket_errors)

        _mark_success(job_id, {
            'status': 'success',
            'message': f'Auto-Generation complete! {allocations_created} lessons intelligently scheduled.',
            'unscheduled_basket': unscheduled_basket_errors,
        })
    except Exception as e:
        _mark_failure(job_id, f"Engine Abort: {str(e)}")
    finally:
        cache.delete(lock_key)


@shared_task(bind=True)
def rollover_allocations_task(self, job_id, source_term_id, target_term_id, year_id, class_id, source_year_id, operator_id, lock_key):
    from school.utils import get_cached_unscheduled_errors

    if not _acquire_lock_or_retry(self, job_id, lock_key):
        return

    _mark_running(job_id)
    try:
        with transaction.atomic():
            result = rollover_allocations(
                source_term_id=source_term_id, target_term_id=target_term_id, year_id=year_id,
                source_year_id=source_year_id, class_id=class_id, operator_id=operator_id,
            )

            active_timetable_id = get_active_timetable_id(term_id=target_term_id, year_id=year_id)
            sync_result = sync_with_allocation_changes(
                active_timetable_id=active_timetable_id,
                prior_triples=result.prior_triples, new_triples=result.new_triples,
            )

            scope_label = f"class {result.scoped_classroom_label}" if result.scoped_classroom_label else "the whole term"
            core_services.write_audit_log(
                operator_id=operator_id,
                action_type='UPDATE',
                module='RolloverEngine',
                description=f"Rolled over term {source_term_id} -> {target_term_id} ({scope_label}): "
                            f"{result.blocks_cloned} block(s) cloned, {result.new_allocation_count} allocation(s) carried over, "
                            f"{sync_result.ejected_count} stale lesson(s) ejected, "
                            f"{sync_result.swapped_count} lesson(s) swapped in place, "
                            f"{sum(len(v) for v in sync_result.needs_regeneration.values())} subject(s) "
                            f"regenerated."
                            + (f" {len(result.skipped_published_classroom_ids)} published class(es) were skipped."
                               if result.skipped_published_classroom_ids else "")
            )

        timetable_warnings = []
        if active_timetable_id and result.scoped_classroom_name:
            timetable_warnings = get_cached_unscheduled_errors(active_timetable_id, [result.scoped_classroom_name])

        message = (
            f"Successfully rolled over {result.new_allocation_count} allocation(s) and "
            f"{result.blocks_cloned} subject block(s)"
            + (f" for {result.scoped_classroom_label}." if result.scoped_classroom_label else " to the new term.")
        )
        if result.skipped_published_classroom_ids:
            message += (f" {len(result.skipped_published_classroom_ids)} published class(es) were skipped — "
                        f"unpublish them first to roll them over.")

        _mark_success(job_id, {
            'message': message,
            'warnings': list(result.warnings),
            'ejected_lesson_count': sync_result.ejected_count,
            'swapped_lesson_count': sync_result.swapped_count,
            'timetable_warnings': timetable_warnings,
        })
    except AllocationValidationError as e:
        _mark_failure(job_id, str(e))
    except Exception as e:
        _mark_failure(job_id, str(e))
    finally:
        cache.delete(lock_key)


@shared_task(bind=True)
def bulk_auto_allocate_task(self, job_id, grade_id, term_id, year_id, explicit_class_ids, operator_id, lock_key):
    from school.utils import get_cached_unscheduled_errors

    if not _acquire_lock_or_retry(self, job_id, lock_key):
        return

    _mark_running(job_id)
    try:
        with transaction.atomic():
            result = bulk_auto_allocate(
                grade_id=grade_id, term_id=term_id, year_id=year_id,
                explicit_class_ids=explicit_class_ids, operator_id=operator_id,
            )

            active_timetable_id = get_active_timetable_id()
            sync_result = sync_with_allocation_changes(
                active_timetable_id=active_timetable_id,
                prior_triples=result.prior_triples, new_triples=result.new_triples,
            )
            total_regenerated_subjects = sum(len(v) for v in sync_result.needs_regeneration.values())

            core_services.write_audit_log(
                operator_id=operator_id,
                action_type='EXECUTION',
                module='BulkAutoAllocate',
                description=f"Bulk auto-allocated {len(result.target_class_ids)} class(es): "
                            f"{result.total_saved} contract(s) saved, {sync_result.ejected_count} stale lesson(s) ejected, "
                            f"{sync_result.swapped_count} lesson(s) swapped to their new teacher in place, "
                            f"{total_regenerated_subjects} subject(s) targeted-regenerated, "
                            f"{len(result.classes_with_gaps)} class(es) with gaps."
                            + (f" {len(result.skipped_published)} published class(es) were skipped." if result.skipped_published else "")
            )

            timetable_warnings = []
            if active_timetable_id:
                timetable_warnings = get_cached_unscheduled_errors(
                    active_timetable_id, list(result.target_class_names)
                )

        message = (f"Bulk allocation complete: {result.total_saved} contract(s) across {len(result.target_class_ids)} class(es), "
                    f"saved as Draft. Open each class in the Matrix and hit Save Grid to publish it.")
        if result.skipped_published:
            message += (f" {len(result.skipped_published)} published class(es) were skipped — "
                        f"unpublish them first to include them.")

        _mark_success(job_id, {
            "message": message,
            "per_class": list(result.per_class_summary),
            "classes_with_gaps": list(result.classes_with_gaps),
            "teachers_near_cap": list(result.teachers_near_cap),
            "ejected_lesson_count": sync_result.ejected_count,
            "swapped_lesson_count": sync_result.swapped_count,
            "regenerated_subject_count": total_regenerated_subjects,
            "timetable_warnings": timetable_warnings,
            "skipped_published": list(result.skipped_published),
        })
    except AllocationValidationError as e:
        _mark_failure(job_id, str(e))
    except Exception as e:
        _mark_failure(job_id, f"Bulk Allocation Error: {str(e)}")
    finally:
        cache.delete(lock_key)


@shared_task(bind=True)
def bulk_generate_term_results_task(self, job_id, term_id, stream_ids, operator_id, lock_key):
    from apps.academics.models import ClassStream
    from apps.academics.models import ExamTerm
    from school.views.results_views import generate_results_for_stream

    if not _acquire_lock_or_retry(self, job_id, lock_key):
        return

    _mark_running(job_id)
    try:
        with transaction.atomic():
            term = ExamTerm.objects.get(id=term_id)
            target_streams = list(ClassStream.objects.filter(id__in=stream_ids).select_related('grade'))

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

            core_services.write_audit_log(
                operator_id=operator_id,
                action_type='EXECUTION',
                module='BulkGenerateTermResults',
                description=(
                    f"Bulk-compiled results for {term.name} ({term.academic_year.year}) across "
                    f"{len(target_streams)} class(es): {total_students_assessed} student(s) assessed, "
                    f"{len(classes_with_issues)} class(es) with no active students."
                )
            )

        _mark_success(job_id, {
            "message": (
                f"Bulk results compilation complete: {total_students_assessed} student(s) assessed "
                f"across {len(target_streams)} class(es)."
            ),
            "per_class": per_class_summary,
            "classes_with_issues": classes_with_issues,
        })
    except Exception as e:
        _mark_failure(job_id, str(e))
    finally:
        cache.delete(lock_key)


@shared_task(bind=True)
def promote_students_task(self, job_id, academic_year_id, student_ids, operator_id):
    from apps.identity.models import StudentExtra
    from apps.academics.models import AcademicYear
    from school.views.promotion_views import _promote_student

    _mark_running(job_id)
    try:
        with transaction.atomic():
            academic_year = AcademicYear.objects.get(id=academic_year_id)
            students = StudentExtra.objects.filter(id__in=student_ids).select_related('cl__grade__tier')

            outcomes = [_promote_student(s, academic_year) for s in students]
            promoted = sum(1 for o in outcomes if o['outcome'] == 'promoted')
            graduated = sum(1 for o in outcomes if o['outcome'] == 'graduated')
            held = sum(1 for o in outcomes if o['outcome'] == 'held')

            core_services.write_audit_log(
                operator_id=operator_id, action_type='PROMOTE', module='BulkPromoteStudents',
                description=f"Promotion run for {academic_year.year}: {promoted} promoted, "
                            f"{graduated} graduated, {held} held.",
            )
        _mark_success(job_id, {
            "message": f"{promoted} promoted, {graduated} graduated, {held} held pending results/exams.",
            "outcomes": outcomes,
        })
    except Exception as e:
        _mark_failure(job_id, str(e))
