"""Composition-root layer for the modular monolith.

This is NOT one of the 14 Django apps and is deliberately absent from
INSTALLED_APPS -- it's the one named seam where a genuine cross-app saga
(right now: allocations-domain jobs needing to synchronously call into
timetable-domain sync logic inside the same DB transaction) is allowed to
import more than one app's services.py in the same function body. Every
other module in the codebase is bound by the "apps never import each
other" rule; this package is the documented exception, not a loophole.

Status: done. `tasks.py` now lives here (see orchestration/tasks.py) --
school/tasks.py no longer exists. rollover_allocations_task and
bulk_auto_allocate_task call apps.allocations.services.rollover_allocations
/ .bulk_auto_allocate for the business logic and leave every affected class
as a DRAFT -- they no longer touch the timetable at all. `publish.py` is
this package's other module: it is the one place that calls both
apps.allocations.services (to mark classes published) and
apps.timetable.services.sync_with_allocation_changes (to apply the draft
to the timetable), inside one transaction.atomic() block -- the exact
composition this package exists to host, now scoped to an explicit,
admin-gated Review & Publish rather than happening automatically at
save/rollover/bulk-allocate time. schoolmanagement/celery.py's
autodiscover_tasks() was updated in the same change to explicitly include
`'orchestration'` (Celery's default autodiscovery only scans
INSTALLED_APPS, which this package is deliberately not part of).
"""
