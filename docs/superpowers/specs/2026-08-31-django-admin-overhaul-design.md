# Django Admin Overhaul: Super Admin Platform Console

Status: Draft — pending user review
Date: 2026-08-31

## Background

Django admin (`/admin/`) currently exposes 35 of roughly 60 models in the
system, spread across 5 files (`school/admin.py` plus 4 of the 14 modular-
monolith apps), the rest sitting in 10 content-free stub `admin.py` files.
Unfold (the themed admin replacement already installed) is configured with
exactly one setting (`SITE_URL`) — everything else is stock defaults. Most
importantly for this round of work: **`Permission`, `Role`, and `UserRole` —
the entire RBAC system built in the previous spec — aren't registered in
Django admin at all.** There is currently no way for a superuser to assign a
role to a user except through the custom RBAC React page, which is itself
gated by `IsApprovedAdmin | HasModulePermission` — a superuser has never
needed that page, but also has no other route in.

This aligns with a rule the project's own orientation doc picked up
independently while this spec was being written: *"a new backend
model/feature must be registered in Django admin, so the superadmin can
reach it"* (`sms-orient` Hard Rule #10) — this spec is that principle applied
retroactively to the ~25 models that predate the rule, plus the RBAC system
specifically.

**Architectural framing that shapes every section below:** Django admin and
the custom React "Admin Dashboard" are two different consoles for two
different actors. The React dashboard is reached through the DRF API, which
is (or will be, once multi-tenancy lands) scoped to "the current school" via
`get_current_school_id()` — that's the **Admin**'s console, rank 1,
"configures everything concerning a school." Django admin talks to the ORM
directly and is never school-scoped by this work — that's the **Super
Admin**'s console, `is_superuser`, unscoped, cross-school, "the main admin
for the entire system." Nothing in this spec adds school-filtering to any
Django `ModelAdmin` queryset; that absence is deliberate, not an oversight.

## A. RBAC exposure

`Permission`, `Role`, `UserRole` register in `apps/identity/admin.py`.

- **`RoleAdmin`**: `list_display` includes `name`, `rank`, `school`,
  `is_system_role`, permission count; `list_filter` on `rank`, `school`,
  `is_system_role`; `search_fields` on `name`. Permissions render as a
  filtered, module-grouped multi-select (Unfold's filter widgets support
  this natively). **`school` is a visible, editable field here** — unlike
  `RoleSerializer`, which deliberately hides it as server-derived-only for
  regular API users. A superuser managing roles across many schools needs to
  see and set which school a role belongs to; that's exactly this console's
  job.
- **`UserRoleAdmin`**: the actual role-assignment screen — `user` and `role`
  as autocomplete fields (both tables can grow large), `list_display` shows
  `user`, `role`, `role.rank`, `assigned_at`. This is where "where does the
  Super Admin allocate roles" gets answered concretely.
- **`PermissionAdmin`**: catalog browser — `list_display` on `code`,
  `label`, `module`; `list_filter` on `module`; read-write (permissions are
  seeded via `seed_rbac.py`, but nothing stops a superuser hand-adding one
  for a one-off need).

**Audit and cache parity with the DRF API.** Django admin writes straight to
the ORM — none of `RoleViewSet`/`UserRoleAssignmentAPIView`'s
`write_audit_log()` or `invalidate_user_permission_cache()` calls fire for
free. `RoleAdmin`/`UserRoleAdmin` override `save_model`/`delete_model` to
call both, mirroring exactly what the API views already do for the
equivalent action (create/update/delete a Role; assign/remove a UserRole).
The rank/containment guards (`validate_rank_authority`,
`validate_permission_delegation`) are **not** invoked here — they already
no-op for `is_superuser` in every call site, and Django admin is
superuser-only by default (`AdminSite.has_permission` requires
`is_staff` — none of the app's non-superuser roles carry that flag today, so
this stays a superuser-only surface without extra gating).

## B. The other ~25 unregistered models

No bespoke `ModelAdmin` per model — three treatment patterns:

1. **Standard CRUD** (the majority — `School`, `AdminInviteCode`,
   `ForcedPasswordChange`, `Curriculum`, `Pathway`, `Track`,
   `SubjectCategoryLimit`, `SubjectPool`, `AllocationPublishState`,
   `GlobalAllocationPolicy` moves to Rules & Policies, see below,
   `AssignmentGroup`, `AssignmentAttachment`, `RubricCriterion`,
   `CriterionScore`, `TeacherStructuralAvailability`, `StudentTask`,
   `NationalExamRecord`, `ChatUserProfile`, `ChatThread`,
   `ThreadParticipant`, `MessageAudit`, `ChatActionResponse`, `DailyCover`,
   `SubjectTermResult`, `StudentTermResult`, `ClassPerformanceAnalytics`,
   `BackgroundJob`): a plain `unfold.admin.ModelAdmin` with a sensible
   `list_display` (the fields that identify a row at a glance),
   `list_filter` where a real filter axis exists (a status/choice/FK field,
   not a free-text one), `search_fields` on name/identifier-like fields.
   Full add/edit/delete — explicitly including `BackgroundJob`, which
   carries no integrity stakes.
2. **Read-only** — `SystemAuditLog` alone. `list_display`/`list_filter`/
   `date_hierarchy` for browsing, `search_fields` on `description`, but
   `has_add_permission`/`has_change_permission`/`has_delete_permission` all
   return `False`. This is the one exception to "Super Admin can change
   everything," and it's deliberate: the audit log's value as tamper-evidence
   depends on nothing in the system — including Django admin — ever
   rewriting it. Confirmed with the user directly.
3. **Consistency fixes**: `apps/content/admin.py` (`BlogPost`,
   `AlumniReview`) and `apps/academics/admin.py`'s `CurriculumPresetAdmin`
   currently subclass bare `django.contrib.admin.ModelAdmin` instead of
   Unfold's — both switch to `unfold.admin.ModelAdmin` so they render
   themed instead of looking like stock Django admin next to everything
   else.

## C. Navigation — a hand-organized `SIDEBAR`, not Django's default

Unfold's `UNFOLD["SIDEBAR"]["navigation"]` replaces the default
alphabetical-by-Django-app grouping with named sections chosen for how a
Super Admin actually thinks about the system, cutting across app boundaries
freely:

| Section | Models |
|---|---|
| **Governance & RBAC** | Role, Permission, UserRole, AdminInviteCode, ForcedPasswordChange |
| **Platform** | School, SystemAuditLog (read-only), BackgroundJob |
| **People** | User, TeacherExtra, StudentExtra, ParentExtra, StaffExtra, AdminExtra |
| **Rules & Policies** | QuotaDefaultRule, SubjectSelectionRule, SubjectExclusionRule, SubjectSplittingRule, GlobalAllocationPolicy, GradingRule, TimetablePedagogyPolicy |
| **Curriculum Structure** | Curriculum, Pathway, Track, GradeLevel, Tier, Department, Subject, SubjectCurriculumProfile, SubjectCategoryLimit, SubjectPool, CurriculumPreset, PresetCombination |
| **Classes & Enrollment** | ClassStream, AcademicYear, ExamTerm, StudentSubjectEnrollment, StudentPathwaySelection, TimeSlot |
| **Allocations & Timetable** | SubjectQuota, SubjectAllocation, SubjectBlock, AllocationPublishState, Timetable, LessonAllocation, DailyCover, TeacherStructuralAvailability |
| **Attendance & Leave** | AttendanceSession, AttendanceRecord, TeacherLeave, LongTermReliefAssignment |
| **Exams & Results** | ExamEvent, ExamResult, StudentReportSummary, ClassExamStatus, SubjectTermResult, StudentTermResult, ClassPerformanceAnalytics, NationalExamRecord |
| **Assignments** | Assignment, AssignmentGroup, AssignmentAttachment, Question, QuestionOption, RubricCriterion, StudentSubmission, StudentAnswer, CriterionScore, StudentTask |
| **Communication** | Notice, Event, Notification, ChatUserProfile, ChatThread, ThreadParticipant, MessageAudit, ChatActionResponse |
| **Content (public site)** | BlogPost, AlumniReview |

**Rules & Policies is the "settings/configuration" section requested
separately** — rather than build a distinct configuration panel alongside
the navigation groups, the config-as-data models (`QuotaDefaultRule`,
`SubjectSelectionRule`, `SubjectExclusionRule`, `SubjectSplittingRule`,
`GlobalAllocationPolicy`, `GradingRule`, `TimetablePedagogyPolicy`) are
pulled out of Curriculum Structure/Allocations & Timetable/Exams & Results
and consolidated into their own group — this *is* the place the Super Admin
goes to tune how the system behaves, separate from where school data lives.
Each section gets a Material Symbols icon matching its purpose.

## D. Branding

`UNFOLD["SITE_HEADER"]`/`SITE_TITLE` (proposed: "SMS Control Center" — the
user should confirm or rename), `SITE_ICON`/`SITE_SYMBOL`, and a `COLORS`
palette distinct from the React admin dashboard's blue/slate theme, so
Django admin visually reads as its own platform-level tool rather than a
clone of the school-level React console.

## E. Custom live dashboard

`UNFOLD["DASHBOARD_CALLBACK"]` replaces the default admin index with real
widgets: pending-approvals count (linked to the filtered `AdminExtra`/
`UserRole`-relevant queue), recent `SystemAuditLog` activity (last ~10
entries), role-assignment stats (users per rank tier, roles per school), and
a per-school breakdown once multi-school data exists.

## F. Dashboard personalization

Each superuser can show/hide which of the Section E widgets appear on their
own homepage — a small per-user preference (a JSON field or one-row-per-user
model keyed to `User`), not full drag-and-drop layout control, which is a
materially bigger, separate build for marginal benefit at this stage.

## Implementation phases

1. **RBAC exposure (A)** — the immediately blocking piece; this is what
   lets the user test role assignment through Django admin at all.
2. **Navigation + branding (C, D)** — organizes what's already registered
   (35 models + the 3 new RBAC ones) before adding 25 more into an
   unorganized pile.
3. **Remaining model registrations (B)** — the ~25 models, grouped into the
   navigation structure from phase 2 as they land.
4. **Live dashboard + personalization (E, F)** — built last since it depends
   on stats queries across models registered in phases 1–3.

## Explicitly out of scope

- School-scoping any Django admin queryset — deliberately never added; see
  the architectural framing above.
- Full drag-and-drop dashboard layout editing (F's simpler show/hide
  toggle is the chosen scope).
- Changing `AdminSite.has_permission`/`is_staff` gating — Django admin
  stays superuser-only, matching current behavior.
