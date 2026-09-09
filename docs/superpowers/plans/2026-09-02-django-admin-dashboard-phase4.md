# Django Admin Custom Dashboard (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default Django admin index page with a live dashboard of real widgets (pending approvals, recent audit activity, RBAC rank/role stats, per-school breakdown), plus a per-superuser show/hide preference for which widgets appear on their own homepage.

**Architecture:** A new `apps/core/dashboard.py` module exposes pure, testable data-building functions and one `dashboard_callback(request, context)` entry point wired via `UNFOLD["DASHBOARD_CALLBACK"]`. Per-user visibility is a new `DashboardPreference` model (`apps/core`, one row per `User`, `hidden_widgets` JSON list). A small staff-only view toggles membership in that list and redirects back to `admin:index`. Rendering happens through a project-level override of `templates/admin/index.html` (extends `admin/base.html` directly — not Unfold's `admin/index.html` — to avoid a self-extending template loop) plus a `dashboard_widgets.html` partial built from Unfold's built-in `unfold/components/card.html` component.

**Tech Stack:** Django 6, django-unfold 0.100.0 (`unfold.admin.ModelAdmin`, `{% component %}` template tag), Django's own template engine (no new JS).

**Spec:** `docs/superpowers/specs/2026-08-31-django-admin-overhaul-design.md` (Section E "Custom live dashboard", Section F "Dashboard personalization", and the "Implementation phases" list marking this as phase 4 — the final phase of the 4-phase Django Admin Overhaul).

## Global Constraints

- **Never run `makemigrations`/`migrate`.** The user runs migrations themselves (project-wide rule, see `.claude/skills/sms-orient/SKILL.md` Hard Rule #1). Task 1 stops short of generating/applying the migration for `DashboardPreference` — say so and move on.
- **Never run `git add`/`git commit`.** The user stages and commits everything themselves. Skip every "Commit" step in the task template below — do not run it.
- **Django admin stays superuser-only** — do not add any new permission-gating mechanism; the toggle view uses the same `staff_member_required` gate Django admin's own views use.
- **No school-scoping added to any queryset** — this dashboard reads system-wide data; multi-tenant row-scoping is explicitly out of scope per the spec.
- **A new model must be registered in Django admin** (`.claude/skills/sms-orient/SKILL.md` Hard Rule #10) — `DashboardPreference` gets a `ModelAdmin` registration even though users manage it exclusively through the dashboard UI, not the admin form.
- **Exact existing query semantics for "pending approvals" must be reused, not reinvented** — the widget's counts must match what `/api/pending-approvals/` already shows elsewhere in the system (`school/views/views.py:1156-1183`), so testers don't see two different numbers for the same concept.

---

## File Structure

- **Modify** `apps/core/models.py` — add `DashboardPreference` model.
- **Modify** `apps/core/admin.py` — register `DashboardPreferenceAdmin`.
- **Create** `apps/core/dashboard.py` — widget data functions + `dashboard_callback(request, context)`.
- **Create** `apps/core/views.py` — `toggle_dashboard_widget(request, widget_key)` view.
- **Modify** `apps/core/urls.py` — wire the toggle view's path.
- **Modify** `schoolmanagement/Urls/urls.py` — include `apps.core.urls`.
- **Modify** `schoolmanagement/settings.py` — set `UNFOLD["DASHBOARD_CALLBACK"]`.
- **Create** `templates/admin/index.html` — project-level override of the admin index page.
- **Create** `templates/admin/dashboard_widgets.html` — the widget-cards partial, included by the override above.
- **Create** `school/tests/test_admin_dashboard.py` — all tests for this plan.

---

## Interfaces used across tasks

- `apps.core.dashboard.get_pending_approvals_summary() -> dict` — keys `teachers`, `students`, `parents`, `admins`, `staff`, `leaves`, `total` (all `int`).
- `apps.core.dashboard.get_recent_audit_log(limit: int = 10) -> QuerySet[SystemAuditLog]`.
- `apps.core.dashboard.get_role_rank_stats() -> list[dict]` — each dict has keys `rank` (`int | None`), `role_count` (`int`), `user_count` (`int`).
- `apps.core.dashboard.get_school_breakdown() -> list[dict]` — each dict has keys `name` (`str`), `level` (`str`), `role_count` (`int`).
- `apps.core.dashboard.WIDGET_CHOICES` — `list[tuple[str, str]]` of `(widget_key, display_label)`, the fixed catalog of all 4 widgets.
- `apps.core.dashboard.dashboard_callback(request, context: dict) -> dict` — the Unfold `DASHBOARD_CALLBACK` entry point.
- `apps.core.models.DashboardPreference` — fields `user` (OneToOne to `User`), `hidden_widgets` (`JSONField`, default `[]`).
- `apps.core.views.toggle_dashboard_widget(request, widget_key: str)` — POST-only view, redirects to `admin:index`.

---

### Task 1: `DashboardPreference` model + admin registration

**Files:**
- Modify: `apps/core/models.py`
- Modify: `apps/core/admin.py`
- Test: `school/tests/test_admin_dashboard.py`

**Interfaces:**
- Produces: `apps.core.models.DashboardPreference` (fields `user`, `hidden_widgets`) — every later task's view/callback code depends on this exact shape.

- [ ] **Step 1: Write the failing test**

Create `school/tests/test_admin_dashboard.py` with this first test class:

```python
from django.contrib.auth.models import User
from django.test import TestCase

from apps.core.models import DashboardPreference


class DashboardPreferenceModelTests(TestCase):
    def test_default_hidden_widgets_is_empty_list(self):
        user = User.objects.create_user(username='pref_owner', password='x')
        pref = DashboardPreference.objects.create(user=user)
        self.assertEqual(pref.hidden_widgets, [])

    def test_one_preference_row_per_user(self):
        user = User.objects.create_user(username='pref_owner2', password='x')
        DashboardPreference.objects.create(user=user)
        with self.assertRaises(Exception):
            DashboardPreference.objects.create(user=user)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test school.tests.test_admin_dashboard -v 1 --noinput --keepdb`
Expected: FAIL/ERROR — `ImportError: cannot import name 'DashboardPreference'`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/core/models.py`:

```python
class DashboardPreference(models.Model):
    """
    Per-superuser show/hide preference for the Django admin dashboard widgets
    defined in apps/core/dashboard.py's WIDGET_CHOICES. One row per user,
    created lazily (get_or_create) the first time dashboard_callback runs for
    that user -- there is no bulk-seeding step.
    """
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='dashboard_preference')
    hidden_widgets = models.JSONField(default=list, blank=True)

    def __str__(self):
        return f"Dashboard preference for {self.user.username}"
```

Append to `apps/core/admin.py` (after the existing imports and registrations, keep everything else in the file unchanged):

```python
from apps.core.models import BackgroundJob, DashboardPreference, SystemAuditLog


@admin.register(DashboardPreference)
class DashboardPreferenceAdmin(ModelAdmin):
    """
    Managed almost entirely through the dashboard's own show/hide buttons
    (apps/core/views.toggle_dashboard_widget) -- this registration exists so
    the Super Admin can still inspect or reset a stuck preference row
    directly, per the "every model gets an admin registration" rule.
    """
    list_display = ('user', 'hidden_widgets')
    search_fields = ('user__username',)
```

Note: this changes the existing `from apps.core.models import BackgroundJob, SystemAuditLog` import line at the top of `apps/core/admin.py` — replace that line with the one above (adds `DashboardPreference` to the same import) rather than adding a second import line.

- [ ] **Step 4: Run test to verify it passes**

This step cannot fully pass yet — `DashboardPreference` has no migration. Run:
`venv/bin/python manage.py makemigrations --check --dry-run core`
Expected output: a message that `core` has model changes not reflected in a migration.

**STOP HERE and tell the user**: *"`DashboardPreference` needs a migration — please run `python manage.py makemigrations core` and `python manage.py migrate` yourself before continuing to Task 2."* Do not generate or apply the migration. Do not proceed to Task 2 until the user confirms the migration is applied (verify with `venv/bin/python manage.py showmigrations core` showing the new migration as `[X]`).

- [ ] **Step 5: Run test to verify it passes (after user applies the migration)**

Run: `venv/bin/python manage.py test school.tests.test_admin_dashboard -v 1 --noinput --keepdb`
Expected: PASS (2 tests).

---

### Task 2: Widget data functions

**Files:**
- Create: `apps/core/dashboard.py`
- Test: `school/tests/test_admin_dashboard.py`

**Interfaces:**
- Consumes: `apps.identity.models.{TeacherExtra, StudentExtra, ParentExtra, StaffExtra, AdminExtra}` (`status` BooleanField on each; `AdminExtra` additionally has `verification_code`), `apps.staff.models.TeacherLeave` (`status` CharField, `'Pending'` is a valid value), `apps.core.models.SystemAuditLog` (`Meta.ordering = ['-timestamp']`, has `operator` FK), `apps.identity.models.Role` (`rank`, `school`, `is_deleted`), `apps.identity.models.UserRole` (`user`, `role`), `apps.identity.models.School` (`name`, `level`).
- Produces: the four data functions plus `WIDGET_CHOICES`, listed in "Interfaces used across tasks" above — Task 3's `dashboard_callback` calls all four.

- [ ] **Step 1: Write the failing tests**

Append to `school/tests/test_admin_dashboard.py`:

```python
from apps.core.dashboard import (
    get_pending_approvals_summary, get_recent_audit_log,
    get_role_rank_stats, get_school_breakdown, WIDGET_CHOICES,
)
from apps.core.models import SystemAuditLog
from apps.identity.models import (
    AdminExtra, ParentExtra, Role, School, StaffExtra, StudentExtra,
    TeacherExtra, UserRole,
)
from apps.staff.models import TeacherLeave


class PendingApprovalsSummaryTests(TestCase):
    def test_counts_match_pending_approvals_api_semantics(self):
        u1 = User.objects.create_user(username='t1', password='x')
        TeacherExtra.objects.create(user=u1, status=False)
        u2 = User.objects.create_user(username='t2', password='x')
        TeacherExtra.objects.create(user=u2, status=True)
        u3 = User.objects.create_user(username='a1', password='x')
        AdminExtra.objects.create(user=u3, status=False, verification_code=None)
        u4 = User.objects.create_user(username='a2', password='x')
        AdminExtra.objects.create(user=u4, status=False, verification_code='somehash')

        summary = get_pending_approvals_summary()

        self.assertEqual(summary['teachers'], 1)
        self.assertEqual(summary['admins'], 1)
        self.assertEqual(summary['total'], summary['teachers'] + summary['students']
                          + summary['parents'] + summary['admins'] + summary['staff']
                          + summary['leaves'])


class RecentAuditLogTests(TestCase):
    def test_returns_most_recent_first_up_to_limit(self):
        for i in range(15):
            SystemAuditLog.objects.create(action_type='CREATE', module='Test', description=f'entry {i}')
        entries = list(get_recent_audit_log(limit=10))
        self.assertEqual(len(entries), 10)
        self.assertEqual(entries[0].description, 'entry 14')


class RoleRankStatsTests(TestCase):
    def test_excludes_soft_deleted_roles(self):
        live_role = Role.objects.create(name='Live Role', rank=3)
        deleted_role = Role.objects.create(name='Deleted Role', rank=3, is_deleted=True)
        u = User.objects.create_user(username='ranked_user', password='x')
        UserRole.objects.create(user=u, role=live_role)

        stats = get_role_rank_stats()

        rank_3 = next(row for row in stats if row['rank'] == 3)
        self.assertEqual(rank_3['role_count'], 1)
        self.assertEqual(rank_3['user_count'], 1)


class SchoolBreakdownTests(TestCase):
    def test_lists_each_school_with_role_count(self):
        school = School.objects.create(name='Test Academy', level='PRIMARY')
        Role.objects.create(name='Scoped Role', school=school)

        breakdown = get_school_breakdown()

        row = next(r for r in breakdown if r['name'] == 'Test Academy')
        self.assertEqual(row['role_count'], 1)

    def test_empty_when_no_schools_exist(self):
        self.assertEqual(get_school_breakdown(), [])


class WidgetChoicesTests(TestCase):
    def test_four_widgets_defined(self):
        keys = [key for key, _label in WIDGET_CHOICES]
        self.assertEqual(
            set(keys),
            {'pending_approvals', 'recent_audit_log', 'role_stats', 'schools_breakdown'},
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test school.tests.test_admin_dashboard -v 1 --noinput --keepdb`
Expected: FAIL/ERROR — `ModuleNotFoundError: No module named 'apps.core.dashboard'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/core/dashboard.py`:

```python
"""
Data-building functions for the Django admin custom dashboard, plus the
DASHBOARD_CALLBACK entry point wired in schoolmanagement/settings.py
(UNFOLD["DASHBOARD_CALLBACK"]).

Every get_* function here is a plain, standalone query -- no request/context
dependency -- so each is independently unit-testable. dashboard_callback
(added in a later task of the same plan) is the only function that touches
`request`/`context`.
"""
from django.db.models import Count, Q

from apps.core.models import SystemAuditLog
from apps.identity.models import (
    AdminExtra, ParentExtra, Role, School, StaffExtra, StudentExtra,
    TeacherExtra, UserRole,
)
from apps.staff.models import TeacherLeave

WIDGET_CHOICES = [
    ('pending_approvals', 'Pending Approvals'),
    ('recent_audit_log', 'Recent Audit Log'),
    ('role_stats', 'Roles & Ranks'),
    ('schools_breakdown', 'Schools'),
]


def get_pending_approvals_summary():
    """
    Mirrors school/views/views.py:1156-1183's pending_approvals_api filter
    semantics exactly, so this widget's numbers always match what that
    existing endpoint reports elsewhere in the system.
    """
    teachers = TeacherExtra.objects.filter(status=False).count()
    students = StudentExtra.objects.filter(status=False).count()
    parents = ParentExtra.objects.filter(status=False).count()
    admins = AdminExtra.objects.filter(status=False, verification_code__isnull=True).count()
    staff = StaffExtra.objects.filter(status=False).count()
    leaves = TeacherLeave.objects.filter(status='Pending').count()
    return {
        'teachers': teachers,
        'students': students,
        'parents': parents,
        'admins': admins,
        'staff': staff,
        'leaves': leaves,
        'total': teachers + students + parents + admins + staff + leaves,
    }


def get_recent_audit_log(limit=10):
    return SystemAuditLog.objects.select_related('operator').all()[:limit]


def get_role_rank_stats():
    roles = (
        Role.objects.filter(is_deleted=False)
        .values('rank')
        .annotate(role_count=Count('id', distinct=True))
    )
    user_counts = dict(
        UserRole.objects.filter(role__is_deleted=False)
        .values('role__rank')
        .annotate(user_count=Count('user', distinct=True))
        .values_list('role__rank', 'user_count')
    )
    return [
        {
            'rank': row['rank'],
            'role_count': row['role_count'],
            'user_count': user_counts.get(row['rank'], 0),
        }
        for row in roles
    ]


def get_school_breakdown():
    return list(
        School.objects.annotate(
            role_count=Count('roles', filter=Q(roles__is_deleted=False), distinct=True)
        ).values('name', 'level', 'role_count')
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/bin/python manage.py test school.tests.test_admin_dashboard -v 1 --noinput --keepdb`
Expected: PASS (all tests from Tasks 1 and 2).

---

### Task 3: `dashboard_callback` + Unfold wiring

**Files:**
- Modify: `apps/core/dashboard.py`
- Modify: `schoolmanagement/settings.py`
- Test: `school/tests/test_admin_dashboard.py`

**Interfaces:**
- Consumes: `apps.core.models.DashboardPreference` (Task 1), the four `get_*` functions and `WIDGET_CHOICES` (Task 2).
- Produces: `context['dashboard_widget_data']` (`dict[str, Any]`, keyed by widget key, only for currently-visible widgets), `context['hidden_dashboard_widgets']` (`list[tuple[str, str]]`, the `(key, label)` pairs currently hidden for this user) — Task 5's templates read both of these.

- [ ] **Step 1: Write the failing test**

Append to `school/tests/test_admin_dashboard.py`:

```python
from django.test import RequestFactory

from apps.core.dashboard import dashboard_callback
from apps.core.models import DashboardPreference


class DashboardCallbackTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.superuser = User.objects.create_superuser(username='super1', password='x', email='s@example.com')

    def test_all_widgets_visible_by_default(self):
        request = self.factory.get('/admin/')
        request.user = self.superuser
        context = dashboard_callback(request, {'title': 'Home'})
        self.assertEqual(len(context['dashboard_widget_data']), 4)
        self.assertEqual(context['hidden_dashboard_widgets'], [])
        self.assertEqual(context['title'], 'Home')

    def test_hidden_widget_excluded_from_widget_data(self):
        DashboardPreference.objects.create(user=self.superuser, hidden_widgets=['recent_audit_log'])
        request = self.factory.get('/admin/')
        request.user = self.superuser
        context = dashboard_callback(request, {})
        self.assertNotIn('recent_audit_log', context['dashboard_widget_data'])
        self.assertEqual(len(context['dashboard_widget_data']), 3)
        self.assertEqual(context['hidden_dashboard_widgets'], [('recent_audit_log', 'Recent Audit Log')])

    def test_admin_index_renders_with_dashboard_callback_wired(self):
        self.client.force_login(self.superuser)
        response = self.client.get('/admin/')
        self.assertEqual(response.status_code, 200)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test school.tests.test_admin_dashboard -v 1 --noinput --keepdb`
Expected: FAIL — `ImportError: cannot import name 'dashboard_callback'`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/core/dashboard.py` (after the four `get_*` functions):

```python
def dashboard_callback(request, context):
    """
    UNFOLD["DASHBOARD_CALLBACK"] entry point. Unfold calls this as
    callback(request, context) and REPLACES its own context with whatever
    this function returns (unfold/sites.py's index() does
    `context = import_string(...)(request, context)`, not a merge) -- so
    every key already in `context` (app_list, title, ...) must survive
    untouched, and only new keys get added on top.
    """
    preference, _ = DashboardPreference.objects.get_or_create(user=request.user)
    hidden_keys = set(preference.hidden_widgets)

    all_widget_data = {
        'pending_approvals': get_pending_approvals_summary(),
        'recent_audit_log': get_recent_audit_log(),
        'role_stats': get_role_rank_stats(),
        'schools_breakdown': get_school_breakdown(),
    }
    context['dashboard_widget_data'] = {
        key: value for key, value in all_widget_data.items() if key not in hidden_keys
    }
    context['hidden_dashboard_widgets'] = [
        (key, label) for key, label in WIDGET_CHOICES if key in hidden_keys
    ]
    return context
```

Add the import at the top of `apps/core/dashboard.py` (with the other `apps.core`/`apps.identity` imports):

```python
from apps.core.models import DashboardPreference, SystemAuditLog
```

(This replaces the earlier `from apps.core.models import SystemAuditLog` line from Task 2 — one import line, not two.)

In `schoolmanagement/settings.py`, inside the `UNFOLD = {...}` dict (added in Phase 2, right after `"SITE_SYMBOL": "school",`), add:

```python
    "DASHBOARD_CALLBACK": "apps.core.dashboard.dashboard_callback",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/bin/python manage.py test school.tests.test_admin_dashboard -v 1 --noinput --keepdb`
Expected: PASS (all tests so far). Note: `test_admin_index_renders_with_dashboard_callback_wired` passing here confirms the callback runs without error against a *real* admin index render, even before Task 5's template override exists (Django admin's default `admin/index.html` simply ignores the extra context keys until Task 5 adds a template that reads them).

---

### Task 4: Toggle view + URL wiring

**Files:**
- Create: `apps/core/views.py`
- Modify: `apps/core/urls.py`
- Modify: `schoolmanagement/Urls/urls.py`
- Test: `school/tests/test_admin_dashboard.py`

**Interfaces:**
- Consumes: `apps.core.models.DashboardPreference` (Task 1).
- Produces: URL name `toggle_dashboard_widget` at `admin/dashboard/widgets/<str:widget_key>/toggle/` — Task 5's templates build hide/show buttons against this URL name.

- [ ] **Step 1: Write the failing test**

Append to `school/tests/test_admin_dashboard.py`:

```python
from django.urls import reverse


class ToggleDashboardWidgetViewTests(TestCase):
    def setUp(self):
        self.superuser = User.objects.create_superuser(username='super2', password='x', email='s2@example.com')
        self.client.force_login(self.superuser)

    def test_post_hides_a_visible_widget(self):
        url = reverse('toggle_dashboard_widget', kwargs={'widget_key': 'role_stats'})
        response = self.client.post(url)
        self.assertRedirects(response, reverse('admin:index'))
        pref = DashboardPreference.objects.get(user=self.superuser)
        self.assertIn('role_stats', pref.hidden_widgets)

    def test_post_again_shows_it_again(self):
        DashboardPreference.objects.create(user=self.superuser, hidden_widgets=['role_stats'])
        url = reverse('toggle_dashboard_widget', kwargs={'widget_key': 'role_stats'})
        self.client.post(url)
        pref = DashboardPreference.objects.get(user=self.superuser)
        self.assertNotIn('role_stats', pref.hidden_widgets)

    def test_get_not_allowed(self):
        url = reverse('toggle_dashboard_widget', kwargs={'widget_key': 'role_stats'})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 405)

    def test_anonymous_user_redirected_to_login(self):
        self.client.logout()
        url = reverse('toggle_dashboard_widget', kwargs={'widget_key': 'role_stats'})
        response = self.client.post(url)
        self.assertEqual(response.status_code, 302)
        self.assertIn('/admin/login/', response.url)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test school.tests.test_admin_dashboard -v 1 --noinput --keepdb`
Expected: FAIL — `NoReverseMatch: 'toggle_dashboard_widget' is not a registered namespace`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/core/views.py`:

```python
"""Views for the `core` app: the dashboard-widget visibility toggle."""
from django.contrib.admin.views.decorators import staff_member_required
from django.shortcuts import redirect
from django.views.decorators.http import require_POST

from apps.core.models import DashboardPreference


@staff_member_required
@require_POST
def toggle_dashboard_widget(request, widget_key):
    """
    Flips membership of `widget_key` in the current user's hidden_widgets
    list, then redirects back to the admin index -- the only place this
    button is ever rendered (see templates/admin/dashboard_widgets.html).
    """
    preference, _ = DashboardPreference.objects.get_or_create(user=request.user)
    if widget_key in preference.hidden_widgets:
        preference.hidden_widgets = [w for w in preference.hidden_widgets if w != widget_key]
    else:
        preference.hidden_widgets = preference.hidden_widgets + [widget_key]
    preference.save()
    return redirect('admin:index')
```

Replace the content of `apps/core/urls.py`:

```python
"""URL routes for the `core` app."""
from django.urls import path

from apps.core.views import toggle_dashboard_widget

urlpatterns = [
    path('admin/dashboard/widgets/<str:widget_key>/toggle/', toggle_dashboard_widget, name='toggle_dashboard_widget'),
]
```

In `schoolmanagement/Urls/urls.py`, insert immediately before the existing `path('admin/', admin.site.urls),` line (currently line 102):

```python
    path('', include('apps.core.urls')),
    path('admin/', admin.site.urls),
```

(Only the new line is an addition — the `admin.site.urls` line already exists and must stay exactly where it is relative to the rest of the file, just with the new `include` placed directly above it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/bin/python manage.py test school.tests.test_admin_dashboard -v 1 --noinput --keepdb`
Expected: PASS (all tests so far).

---

### Task 5: Dashboard templates

**Files:**
- Create: `templates/admin/index.html`
- Create: `templates/admin/dashboard_widgets.html`
- Test: `school/tests/test_admin_dashboard.py`

**Interfaces:**
- Consumes: `context['dashboard_widget_data']`, `context['hidden_dashboard_widgets']` (Task 3), URL name `toggle_dashboard_widget` (Task 4), Unfold's `unfold/components/card.html` component (accepts `title`, `icon`, `footer`; body between `{% component %}`/`{% endcomponent %}` becomes `children`).

- [ ] **Step 1: Write the failing tests**

Append to `school/tests/test_admin_dashboard.py`:

```python
class DashboardTemplateRenderingTests(TestCase):
    def setUp(self):
        self.superuser = User.objects.create_superuser(username='super3', password='x', email='s3@example.com')
        self.client.force_login(self.superuser)

    def test_widget_titles_render_on_index(self):
        response = self.client.get(reverse('admin:index'))
        content = response.content.decode()
        self.assertIn('Pending Approvals', content)
        self.assertIn('Recent Audit Log', content)
        self.assertIn('Roles', content)
        self.assertIn('Schools', content)

    def test_app_list_still_renders(self):
        # The override must not lose Django admin's own model list.
        response = self.client.get(reverse('admin:index'))
        self.assertContains(response, reverse('admin:identity_role_changelist'))

    def test_hidden_widget_not_rendered(self):
        DashboardPreference.objects.create(user=self.superuser, hidden_widgets=['schools_breakdown'])
        response = self.client.get(reverse('admin:index'))
        content = response.content.decode()
        self.assertNotIn('id="widget-schools_breakdown"', content)

    def test_hidden_widget_shows_in_restore_panel(self):
        DashboardPreference.objects.create(user=self.superuser, hidden_widgets=['schools_breakdown'])
        response = self.client.get(reverse('admin:index'))
        self.assertContains(response, reverse('toggle_dashboard_widget', kwargs={'widget_key': 'schools_breakdown'}))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python manage.py test school.tests.test_admin_dashboard.DashboardTemplateRenderingTests -v 1 --noinput --keepdb`
Expected: FAIL — widget titles/ids not found (default Unfold `admin/index.html` doesn't render any of this yet).

- [ ] **Step 3: Write minimal implementation**

Create `templates/admin/index.html` (extends `admin/base.html` directly, replicating Unfold's own `admin/index.html` content block rather than extending it, since extending `"admin/index.html"` from a template that IS `admin/index.html` in the project's own `DIRS`-first template search path would self-reference and infinite-loop):

```django
{% extends 'admin/base.html' %}
{% load i18n %}

{% block title %}{% if subtitle %}{{ subtitle }} | {% endif %}{{ title }} | {{ site_title|default:_('Django site admin') }}{% endblock %}

{% block branding %}
    {% include "unfold/helpers/site_branding.html" %}
{% endblock %}

{% block content %}
    {% include "admin/dashboard_widgets.html" %}

    <div class="flex flex-col lg:flex-row lg:gap-8">
        <div class="grow">
            {% include "unfold/helpers/app_list_default.html" %}
        </div>

        {% include "unfold/helpers/history.html" %}
    </div>
{% endblock %}
```

Create `templates/admin/dashboard_widgets.html`:

```django
{% load unfold %}

{% if hidden_dashboard_widgets %}
    <div class="mb-6 flex flex-wrap items-center gap-2 rounded-default border border-base-200 bg-base-50 p-3 text-sm dark:border-base-800 dark:bg-base-800">
        <span class="font-semibold">Hidden widgets:</span>
        {% for key, label in hidden_dashboard_widgets %}
            <form method="post" action="{% url 'toggle_dashboard_widget' widget_key=key %}" class="inline">
                {% csrf_token %}
                <button type="submit" class="underline">{{ label }} (show)</button>
            </form>
        {% endfor %}
    </div>
{% endif %}

<div class="grid grid-cols-1 gap-4 mb-8 md:grid-cols-2 xl:grid-cols-4">
    {% if 'pending_approvals' in dashboard_widget_data %}
        {% with data=dashboard_widget_data.pending_approvals %}
        <div id="widget-pending_approvals">
            {% component "unfold/components/card.html" with title="Pending Approvals" icon="pending_actions" %}
                <p class="text-3xl font-semibold">{{ data.total }}</p>
                <ul class="mt-2 text-sm text-base-500 dark:text-base-400">
                    <li>Teachers: {{ data.teachers }}</li>
                    <li>Students: {{ data.students }}</li>
                    <li>Parents: {{ data.parents }}</li>
                    <li>Admins: {{ data.admins }}</li>
                    <li>Staff: {{ data.staff }}</li>
                    <li>Leave requests: {{ data.leaves }}</li>
                </ul>
                <form method="post" action="{% url 'toggle_dashboard_widget' widget_key='pending_approvals' %}" class="mt-3">
                    {% csrf_token %}
                    <button type="submit" class="text-xs underline text-base-400">Hide</button>
                </form>
            {% endcomponent %}
        </div>
        {% endwith %}
    {% endif %}

    {% if 'recent_audit_log' in dashboard_widget_data %}
        <div id="widget-recent_audit_log">
            {% component "unfold/components/card.html" with title="Recent Audit Log" icon="history" %}
                <ul class="text-sm space-y-1">
                    {% for entry in dashboard_widget_data.recent_audit_log %}
                        <li>{{ entry.timestamp|date:"Y-m-d H:i" }} — {{ entry.operator|default:"System" }} — {{ entry.action_type }} — {{ entry.module }}</li>
                    {% empty %}
                        <li class="text-base-400">No activity yet.</li>
                    {% endfor %}
                </ul>
                <form method="post" action="{% url 'toggle_dashboard_widget' widget_key='recent_audit_log' %}" class="mt-3">
                    {% csrf_token %}
                    <button type="submit" class="text-xs underline text-base-400">Hide</button>
                </form>
            {% endcomponent %}
        </div>
    {% endif %}

    {% if 'role_stats' in dashboard_widget_data %}
        <div id="widget-role_stats">
            {% component "unfold/components/card.html" with title="Roles & Ranks" icon="shield_person" %}
                <table class="text-sm w-full">
                    <thead><tr><th class="text-left">Rank</th><th class="text-left">Roles</th><th class="text-left">Users</th></tr></thead>
                    <tbody>
                        {% for row in dashboard_widget_data.role_stats %}
                            <tr><td>{{ row.rank|default:"—" }}</td><td>{{ row.role_count }}</td><td>{{ row.user_count }}</td></tr>
                        {% empty %}
                            <tr><td colspan="3" class="text-base-400">No roles yet.</td></tr>
                        {% endfor %}
                    </tbody>
                </table>
                <form method="post" action="{% url 'toggle_dashboard_widget' widget_key='role_stats' %}" class="mt-3">
                    {% csrf_token %}
                    <button type="submit" class="text-xs underline text-base-400">Hide</button>
                </form>
            {% endcomponent %}
        </div>
    {% endif %}

    {% if 'schools_breakdown' in dashboard_widget_data %}
        <div id="widget-schools_breakdown">
            {% component "unfold/components/card.html" with title="Schools" icon="domain" %}
                <ul class="text-sm space-y-1">
                    {% for row in dashboard_widget_data.schools_breakdown %}
                        <li>{{ row.name }} ({{ row.level }}) — {{ row.role_count }} role(s)</li>
                    {% empty %}
                        <li class="text-base-400">No schools configured yet.</li>
                    {% endfor %}
                </ul>
                <form method="post" action="{% url 'toggle_dashboard_widget' widget_key='schools_breakdown' %}" class="mt-3">
                    {% csrf_token %}
                    <button type="submit" class="text-xs underline text-base-400">Hide</button>
                </form>
            {% endcomponent %}
        </div>
    {% endif %}
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/bin/python manage.py test school.tests.test_admin_dashboard -v 1 --noinput --keepdb`
Expected: PASS (every test in the file).

---

### Task 6: Full regression pass + manual check

**Files:** none (verification only).

- [ ] **Step 1: Run the full new test file**

Run: `venv/bin/python manage.py test school.tests.test_admin_dashboard -v 2 --noinput --keepdb`
Expected: all tests PASS, none skipped.

- [ ] **Step 2: Run the full backend suite for regressions**

Run: `venv/bin/python manage.py test school.tests --noinput --keepdb`
Expected: same pass count as before this plan (436 tests) plus the new tests added in Tasks 1–5, zero failures/errors.

- [ ] **Step 3: Manual check**

Start the dev server (`venv/bin/python manage.py runserver`), log in to `/admin/` as a superuser, and confirm:
- All 4 widget cards render with real numbers (not template errors).
- The app list below the widgets still works (unchanged from before this plan).
- Clicking "Hide" on a widget removes it and adds it to the "Hidden widgets" restore bar at the top; clicking its "(show)" link there brings it back.
- The dashboard still renders correctly for a second superuser account with a separate, independent set of hidden widgets (personalization is per-user, not global).

Report the result of this manual check back before considering Phase 4 done — this is a Django-admin-rendered UI, and automated tests alone don't verify the widgets are visually sane.

- [ ] **Step 4: Do not commit**

Per the Global Constraints above, leave all changes unstaged. Report what changed and let the user run `git status`/`git diff` and commit themselves.
