from apps.academics.models import (SubjectSelectionRule,
                     GradeLevel, Subject, ClassStream, SubjectCategoryLimit, SubjectExclusionRule,
                     Pathway, Track, CurriculumPreset,
                     PresetCombination, get_effective_is_core, get_effective_department, Department,
                     AcademicYear, ExamTerm, grade_requires_pathway_choice)
from apps.allocations.models import SubjectQuota, SubjectAllocation
from apps.students.models import StudentSubjectEnrollment, StudentPathwaySelection
from apps.core.services import write_audit_log
from apps.identity.models import ( TeacherExtra, StudentExtra,)
from apps.identity.services import get_current_school_id
from apps.messaging.models import Notification
from apps.results.models import SubjectTermResult
from django.contrib.auth.models import User
from django.http import JsonResponse
import json
from django.db import transaction, IntegrityError
from django.db.models import Q, Count
from school.decorators import require_permission
from school.rbac import curriculum_edit_guard, is_class_teacher_of_student
from school.views.class_views import _eligible_subjects_for

# Mathematics subjects assigned automatically based on a student's SSS pathway (see
# _ensure_core_mathematics) rather than chosen via CurriculumPreset/SubjectPool self-service --
# excluded from pool listings/requests so a student can't end up with two maths subjects (e.g.
# Advanced Mathematics from their combo AND a self-requested Core/Essential Mathematics).
SYSTEM_MANAGED_MATH_CODES = {'CMAT', 'EMAT'}


def _is_admin(user):
    """
    Canonical admin check, matching the convention already used in attendance_views.py and
    class_views.py — broader than just is_superuser/AdminExtra, since real admin accounts
    here are more commonly flagged via is_staff or the 'ADMIN' group.
    """
    return (
        user.is_superuser or user.is_staff or
        user.groups.filter(name='ADMIN').exists() or
        hasattr(user, 'adminextra')
    )


def _resolve_curriculum_preset(request, grade, pathway, track=None):
    """
    Resolves which CurriculumPreset (and therefore which SubjectPool structure) governs a
    student's elective choices, given their grade and their approved Pathway + Track (both
    None for JSS or non-CBC grades). Returns None when nothing matches — callers fall back
    to the flat, curriculum-agnostic SubjectQuota-based behavior that predates presets/pools,
    so 8-4-4 grades and CBC grades without a configured preset are unaffected.

    Takes `request` to scope the lookup by school — without it, two schools sharing an
    identical tier/pathway/track combo could resolve to each other's preset once a second
    school exists (see get_current_school_id()'s docstring for the current single-tenant
    caveat this still relies on).

    Tries an exact pathway/track match first (a preset built for exactly this one pathway) —
    unchanged from before. If nothing matches and a pathway was requested, falls back to a
    "universal" preset (pathway=None, track=None) at the same curriculum/tier, which serves
    every pathway via its own pathway-tagged SubjectPools instead of one preset per pathway —
    see _pools_for_pathway(). Existing single-pathway presets always take priority when they
    exist, so this is purely additive.
    """
    if not grade.curriculum_id:
        return None
    base = CurriculumPreset.objects.filter(
        school_id=get_current_school_id(request), curriculum=grade.curriculum, tier=grade.tier,
    )
    prefetch = ('pools__subjects', 'pools__combinations__subjects', 'pools__combinations__track')
    exact = base.filter(pathway=pathway, track=track).prefetch_related(*prefetch).first()
    if exact or pathway is None:
        return exact
    return base.filter(pathway__isnull=True, track__isnull=True).prefetch_related(*prefetch).first()


def _pools_for_pathway(preset, pathway, track=None):
    """
    Which of a resolved preset's SubjectPools actually apply to this student's pathway/track.
    A pool with pathway=None (every Core Compulsory/Guided Elective pool, and every pool on a
    legacy single-pathway preset) always applies. A pathway-tagged PATHWAY_CORE pool only
    applies to a student in that same pathway (and, if the pool also names a track, that same
    track) — this is what stops a STEM student from seeing an Arts-only pool's subjects on a
    "universal" preset that hosts pools for several pathways at once.
    """
    pathway_id = pathway.id if pathway else None
    track_id = track.id if track else None
    return [
        pool for pool in preset.pools.all()
        if pool.pathway_id in (None, pathway_id) and pool.track_id in (None, track_id)
    ]


def _pool_subjects_for_student(pool, pathway, track=None):
    """
    A pool with no combinations behaves exactly as before (pool.subjects is the full,
    unscoped list). A pool WITH combinations holds offerings from every pathway/track at
    once (see SubjectPool.combinations), so its `subjects` M2M is a superset -- narrow it
    here to just the subjects of combinations whose own track matches this student's
    approved track (or, if the student hasn't picked a track yet, whose track belongs to
    their approved pathway).
    """
    combos = list(pool.combinations.all())
    if not combos:
        return list(pool.subjects.all())
    track_id = track.id if track else None
    pathway_id = pathway.id if pathway else None
    relevant = [c for c in combos if c.track_id == track_id or (track_id is None and c.track.pathway_id == pathway_id)]
    subject_ids = {s.id for c in relevant for s in c.subjects.all()}
    return [s for s in pool.subjects.all() if s.id in subject_ids]


def _student_approved_selection(student, academic_year):
    """
    Returns the student's Approved StudentPathwaySelection (with pathway + track prefetched)
    for the given year, or None. Both the pathway and the track (if any) are needed together
    to resolve the right CurriculumPreset, so callers should read both off one selection
    rather than querying pathway and track separately.
    """
    return StudentPathwaySelection.objects.filter(
        student=student, academic_year=academic_year, status='Approved'
    ).select_related('pathway', 'track').first()


@require_permission('curriculum.view', edit_permission='curriculum.edit')
def api_manage_departments(request):
    """
    GET: list every Department (active and inactive) for the Academics Hub's management
    screen and for subject-create/edit dropdowns. Optional ?curriculum_id= filters to just
    that curriculum's departments (CBC and 8-4-4 don't share departments — see Department
    model docstring); omit it to manage the full list across both. POST: create a new one.
    """
    if request.method == 'GET':
        # annotate rather than a per-row .count() — one query instead of N+1 as departments grow
        departments = Department.objects.annotate(subject_count=Count('subject_profiles__subject', distinct=True)).select_related('curriculum')
        curriculum_id = request.GET.get('curriculum_id')
        if curriculum_id:
            departments = departments.filter(curriculum_id=curriculum_id)
        data = [{
            'id': d.id,
            'name': d.name,
            'code': d.code,
            'description': d.description,
            'is_active': d.is_active,
            'subject_count': d.subject_count,
            'curriculum_id': d.curriculum_id,
            'curriculum_code': d.curriculum.code,
        } for d in departments]
        return JsonResponse({'status': 'success', 'data': data})

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            name = (data.get('name') or '').strip()
            code = (data.get('code') or '').strip() or None
            description = (data.get('description') or '').strip()
            curriculum_id = data.get('curriculum_id')
            if not name:
                return JsonResponse({'status': 'error', 'message': 'Department name is required.'})
            if not curriculum_id:
                return JsonResponse({'status': 'error', 'message': 'Curriculum is required (CBC or 8-4-4).'})
            if len(name) > 50:
                return JsonResponse({'status': 'error', 'message': 'Department name must be 50 characters or fewer.'})
            if code and len(code) > 10:
                return JsonResponse({'status': 'error', 'message': 'Department code must be 10 characters or fewer.'})
            if len(description) > 255:
                return JsonResponse({'status': 'error', 'message': 'Description must be 255 characters or fewer.'})
            if Department.objects.filter(name__iexact=name, curriculum_id=curriculum_id).exists():
                return JsonResponse({'status': 'error', 'message': f"A department named '{name}' already exists for that curriculum."})
            try:
                dept = Department.objects.create(
                    name=name,
                    code=code,
                    description=description,
                    is_active=data.get('is_active', True),
                    curriculum_id=curriculum_id,
                )
                subjects_list = data.get('subjects')
                if subjects_list is not None and isinstance(subjects_list, list):
                    from apps.academics.models import SubjectCurriculumProfile
                    SubjectCurriculumProfile.objects.filter(
                        subject_id__in=subjects_list,
                        curriculum_id=curriculum_id
                    ).update(department=dept)
            except IntegrityError:
                return JsonResponse({'status': 'error', 'message': "That name or code is already in use by another department in that curriculum."})
            return JsonResponse({'status': 'success', 'message': 'Department created.', 'department_id': dept.id})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method.'})


@require_permission('curriculum.edit')
def api_department_detail(request, pk):
    """PUT: rename/edit a Department. DELETE: remove it (subjects referencing it fall back
    to uncategorized via on_delete=SET_NULL; any QuotaDefaultRule/SubjectCategoryLimit rows
    scoped to it are cascade-deleted, same as deleting any other config row)."""
    try:
        dept = Department.objects.get(id=pk)
    except Department.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Department not found.'})

    if request.method in ('PUT', 'POST'):
        try:
            data = json.loads(request.body)
            name = data.get('name')
            if name is not None:
                name = name.strip()
                if not name:
                    return JsonResponse({'status': 'error', 'message': 'Department name is required.'})
                if len(name) > 50:
                    return JsonResponse({'status': 'error', 'message': 'Department name must be 50 characters or fewer.'})
                if Department.objects.exclude(id=dept.id).filter(name__iexact=name, curriculum_id=dept.curriculum_id).exists():
                    return JsonResponse({'status': 'error', 'message': f"A department named '{name}' already exists for that curriculum."})
                dept.name = name
            if 'code' in data:
                code = (data.get('code') or '').strip() or None
                if code and len(code) > 10:
                    return JsonResponse({'status': 'error', 'message': 'Department code must be 10 characters or fewer.'})
                dept.code = code
            if 'description' in data:
                description = (data.get('description') or '').strip()
                if len(description) > 255:
                    return JsonResponse({'status': 'error', 'message': 'Description must be 255 characters or fewer.'})
                dept.description = description
            if 'is_active' in data:
                dept.is_active = data['is_active']
            try:
                dept.save()
                subjects_list = data.get('subjects')
                if subjects_list is not None and isinstance(subjects_list, list):
                    from apps.academics.models import SubjectCurriculumProfile
                    SubjectCurriculumProfile.objects.filter(
                        department=dept,
                        curriculum_id=dept.curriculum_id
                    ).exclude(subject_id__in=subjects_list).update(department=None)
                    SubjectCurriculumProfile.objects.filter(
                        subject_id__in=subjects_list,
                        curriculum_id=dept.curriculum_id
                    ).update(department=dept)
            except IntegrityError:
                return JsonResponse({'status': 'error', 'message': "That name or code is already in use by another department."})
            return JsonResponse({'status': 'success', 'message': 'Department updated.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    if request.method == 'DELETE':
        subject_count = dept.subjects.count()
        dept.delete()
        return JsonResponse({
            'status': 'success',
            'message': f'Department deleted. {subject_count} subject(s) are now uncategorized.' if subject_count
                       else 'Department deleted.'
        })

    return JsonResponse({'status': 'error', 'message': 'Invalid request method.'})


@require_permission('curriculum.view')
def api_manage_subjects(request):
    """
    Returns subjects data.
    RBAC ENABLED: Admins see all subjects; Teachers only see subjects they actively instruct.
    """
    if request.method == 'GET':
        try:
            user = request.user
            # Identify user roles securely
            is_teacher = hasattr(user, 'teacherextra')
            # Reaching this line already required curriculum.view/classes.view (see the
            # @require_permission decorator on this view) — Admin and Teacher are the only
            # two roles that grant it today, but a Staff account can now hold it too via an
            # assigned Role. A non-teacher who got this far has no "only subjects I teach"
            # notion, so they get the same full list an admin does rather than an empty one.
            is_admin = user.is_superuser or user.is_staff or user.groups.filter(name='ADMIN').exists() or hasattr(user, 'adminextra') or not is_teacher
            from apps.academics.models import SubjectCurriculumProfile, Tier as TierModel

            if is_admin:
                subjects = Subject.live.select_related('department').all().order_by('name')
            elif is_teacher:
                teacher = user.teacherextra
                # Single source of truth for eligibility (see TeacherExtra.qualified_subjects)
                subjects = teacher.qualified_subjects.select_related('department').all().order_by('name')
            else:
                subjects = Subject.live.none()

            # Bulk-fetch all profiles so we don't hit the DB per subject
            all_profiles = SubjectCurriculumProfile.objects.select_related('tier', 'curriculum', 'department').all()
            profiles_by_subject = {}
            for p in all_profiles:
                profiles_by_subject.setdefault(p.subject_id, []).append(p)

            data = []
            for sub in subjects:
                teachers = TeacherExtra.objects.filter(qualified_subjects=sub, status=True)
                teacher_names = [t.get_name for t in teachers]

                profiles = profiles_by_subject.get(sub.id, [])
                tier_ids = list({p.tier_id for p in profiles if p.tier_id is not None})
                tier_names = list({p.tier.name for p in profiles if p.tier is not None})
                curriculum_ids = list({p.curriculum_id for p in profiles if p.curriculum_id is not None})
                curriculum_codes = list({p.curriculum.code for p in profiles if p.curriculum is not None})

                # Per-curriculum department: the profile's own department assignment (if any),
                # falling back to the subject's flat default.  Keyed by curriculum_id (as str
                # for JSON).  Frontend uses this to group subjects by the *correct* department
                # when a curriculum filter is active.
                curriculum_departments: dict = {}
                for p in profiles:
                    if p.curriculum_id is None:
                        continue
                    dept_name = (
                        p.department.name if p.department_id else
                        (sub.department.name if sub.department_id else None)
                    )
                    # Only set if not already set (first profile per curriculum wins)
                    if str(p.curriculum_id) not in curriculum_departments:
                        curriculum_departments[str(p.curriculum_id)] = dept_name

                # Per-curriculum tier mapping: curriculum_id → list of tier names assigned
                curriculum_tier_names: dict = {}
                for p in profiles:
                    if p.curriculum_id is None or p.tier_id is None:
                        continue
                    key = str(p.curriculum_id)
                    curriculum_tier_names.setdefault(key, [])
                    if p.tier.name not in curriculum_tier_names[key]:
                        curriculum_tier_names[key].append(p.tier.name)

                data.append({
                    'id': sub.id,
                    'code': sub.code,
                    'name': sub.name,
                    'department_id': sub.department_id,
                    'department_name': sub.department.name if sub.department_id else None,
                    'is_core': sub.is_core,
                    'allow_double_periods': sub.allow_double_periods,
                    'earliest_allowed_time': sub.earliest_allowed_time.strftime('%H:%M') if sub.earliest_allowed_time else None,
                    'requires_synchronized_grade_blocking': sub.requires_synchronized_grade_blocking,
                    'synchronized_blocking_min_grade': sub.synchronized_blocking_min_grade,
                    'assigned_teachers': teacher_names,
                    'assigned_teacher_ids': [t.id for t in teachers],
                    'tier_ids': tier_ids,
                    'tier_names': tier_names,
                    'curriculum_ids': curriculum_ids,
                    'curriculum_codes': curriculum_codes,
                    'curriculum_departments': curriculum_departments,
                    'curriculum_tier_names': curriculum_tier_names,
                })
            return JsonResponse({'status': 'success', 'data': data})

        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})


@require_permission('curriculum.view')
def api_subject_students(request, pk):
    """
    Who actually takes this subject, grouped by Grade level. Resolved per grade (via
    get_effective_is_core) since a curriculum/tier override can make this subject core in
    one grade's curriculum and elective in another's. Core grades: every active student in
    that grade. Elective grades: only students with an Approved StudentSubjectEnrollment for
    the active academic year — mirrors the same enrollment ledger the Allocation/Enrollment
    engine treats as the source of truth.
    """
    if request.method != 'GET':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'})

    try:
        subject = Subject.objects.get(id=pk)
    except Subject.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Subject not found.'})

    try:
        # A subject can be core in one curriculum and elective in another (per-grade
        # SubjectCurriculumProfile override), so this is resolved per grade rather than
        # once off the subject's flat is_core.
        quotas_by_grade = {
            q.grade_id: q.grade for q in SubjectQuota.objects.filter(subject=subject).select_related('grade')
        }
        core_grade_ids = {
            grade_id for grade_id, grade in quotas_by_grade.items()
            if get_effective_is_core(subject, grade.curriculum, grade.tier)
        }
        elective_grade_ids = set(quotas_by_grade) - core_grade_ids

        current_year = AcademicYear.objects.filter(is_active=True).first()
        enrollment_qs = StudentSubjectEnrollment.objects.filter(subject=subject, status='Approved')
        if current_year:
            enrollment_qs = enrollment_qs.filter(academic_year=current_year)
        elective_student_ids = enrollment_qs.filter(
            student__cl__grade_id__in=elective_grade_ids
        ).values_list('student_id', flat=True)

        students_qs = StudentExtra.objects.filter(
            Q(status=True) & (Q(cl__grade_id__in=core_grade_ids) | Q(id__in=elective_student_ids))
        ).select_related('cl', 'cl__grade', 'user').distinct()

        current_term = ExamTerm.objects.filter(is_active=True).first()
        results_by_student = {}
        if current_term:
            results = SubjectTermResult.objects.filter(subject=subject, term=current_term, student__in=students_qs)
            results_by_student = {r.student_id: r for r in results}

        students_data = []
        for s in students_qs:
            result = results_by_student.get(s.id)
            students_data.append({
                'id': s.id,
                'name': s.get_name,
                'roll': s.roll,
                'grade_id': s.cl.grade_id if s.cl else None,
                'grade_name': s.cl.grade.name if s.cl and s.cl.grade else 'Unassigned',
                'grade_order': s.cl.grade.numeric_order if s.cl and s.cl.grade else 9999,
                'stream_name': s.cl.name if s.cl else 'N/A',
                'total_score': float(result.total_score) if result and result.total_score is not None else None,
                'grade_label': result.grade if result else None,
            })

        # Group by Grade level (ascending), then by Stream (alphabetical), then
        # alphabetical by name within each stream — each stream is its own findable group.
        students_data.sort(key=lambda d: (d['grade_order'], d['stream_name'].lower(), d['name'].lower()))

        return JsonResponse({
            'status': 'success',
            'data': {
                'term': current_term.name if current_term else None,
                'students': students_data,
            }
        })
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)})


@require_permission('curriculum.edit')
def api_add_subject(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            subject = Subject.objects.create(
                code=data['code'].upper(),
                name=data['name'],
                department_id=data.get('department_id') or None,
                is_core=data.get('is_core', True),
                allow_double_periods=data.get('allow_double_periods', True),
                earliest_allowed_time=data.get('earliest_allowed_time') or None,
                requires_synchronized_grade_blocking=data.get('requires_synchronized_grade_blocking', False),
                synchronized_blocking_min_grade=data.get('synchronized_blocking_min_grade') or None,
            )
            return JsonResponse({'status': 'success', 'message': 'Subject added successfully.', 'subject_id': subject.id})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})

@require_permission('curriculum.edit')
def api_edit_subject(request, pk):
    if request.method == 'POST' or request.method == 'PUT':
        try:
            data = json.loads(request.body)
            subject = Subject.objects.get(id=pk)
            old_subject_name = subject.name

            subject.code = data.get('code', subject.code).upper()
            subject.name = data.get('name', subject.name)
            if 'department_id' in data:
                subject.department_id = data['department_id'] or None
            subject.is_core = data.get('is_core', subject.is_core)
            subject.allow_double_periods = data.get('allow_double_periods', subject.allow_double_periods)
            if 'earliest_allowed_time' in data:
                subject.earliest_allowed_time = data['earliest_allowed_time'] or None
            subject.requires_synchronized_grade_blocking = data.get(
                'requires_synchronized_grade_blocking', subject.requires_synchronized_grade_blocking
            )
            if 'synchronized_blocking_min_grade' in data:
                subject.synchronized_blocking_min_grade = data['synchronized_blocking_min_grade'] or None
            subject.save()

            teacher_ids = data.get('teacher_ids')
            if teacher_ids is not None:
                new_subject_name = subject.name

                all_teachers = TeacherExtra.objects.all()
                for teacher in all_teachers:
                    if teacher.subjects:
                        subj_list = [s.strip() for s in teacher.subjects.split(',') if s.strip()]
                        if old_subject_name in subj_list:
                            subj_list.remove(old_subject_name)
                        teacher.subjects = ", ".join(subj_list)
                        teacher.save()

                checked_teachers = TeacherExtra.objects.filter(id__in=teacher_ids)
                for teacher in checked_teachers:
                    if teacher.subjects:
                        subj_list = [s.strip() for s in teacher.subjects.split(',') if s.strip()]
                        if new_subject_name not in subj_list:
                            subj_list.append(new_subject_name)
                        teacher.subjects = ", ".join(subj_list)
                    else:
                        teacher.subjects = new_subject_name
                    teacher.save()

                # The free-text sync above is kept for legacy display only. This is the
                # real source of truth every eligibility check (allocation matrix, auto-draft,
                # substitution finder, manual timetable picker) now reads from.
                subject.qualified_teachers.set(checked_teachers)

            return JsonResponse({'status': 'success', 'message': 'Subject updated successfully.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})
    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})

@require_permission('curriculum.edit')
def api_delete_subject(request, pk):
    if request.method == 'POST' or request.method == 'DELETE':
        try:
            subject = Subject.objects.get(id=pk)
            subject.soft_delete(operator_user=request.user)
            return JsonResponse({'status': 'success', 'message': 'Subject moved to Trash.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})
    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


@require_permission('curriculum.view')
def api_subject_catalog(request, grade_id):
    """
    API 1: THE CATALOG
    Fetches all available subjects and groups them by department to make
    the React UI clean and organized. Also passes down the dynamic rules.
    """
    if request.method == 'GET':
        try:
            grade = GradeLevel.objects.get(id=grade_id)

            # Tier-scope the catalog using the same SubjectCurriculumProfile eligibility rule
            # _eligible_subjects_for already applies for quota auto-seeding: a subject with no
            # profile rows is shared/legacy and always included, but a subject that DOES have
            # profile rows is only included if one matches this grade's curriculum+tier. Without
            # this gate, subjects scoped to a different tier (e.g. Senior Secondary's Advanced/
            # Core/Essential Mathematics) leaked into every grade's catalog, including Lower and
            # Upper Primary. Falls back to every Subject, unfiltered, when the grade has no
            # curriculum linked yet (legacy/ungrouped grades) — same "don't break old data"
            # fallback get_effective_department/get_effective_is_core use for curriculum=None.
            if grade.curriculum_id:
                eligible = [
                    (subject, effective_is_core)
                    for subject, effective_is_core, *_ in _eligible_subjects_for(grade.curriculum, grade.tier)
                ]
            else:
                eligible = [(sub, sub.is_core) for sub in Subject.live.select_related('department')]
            eligible.sort(key=lambda pair: pair[0].name)

            # 1. Group subjects by department, ordered alphabetically with uncategorized last
            # (rather than dict-insertion order) so the assignment UI's tabs are always
            # arranged the same predictable way regardless of subject creation order. Resolved
            # against THIS grade's curriculum — CBC and 8-4-4 group subjects into different
            # departments (see Department model docstring), so the same subject can land in a
            # different tab depending on which curriculum's grade you're viewing.
            groups = {}
            for sub, effective_is_core in eligible:
                effective_dept = get_effective_department(sub, grade.curriculum, grade.tier)
                key = effective_dept.id if effective_dept else None
                if key not in groups:
                    groups[key] = {
                        'department_id': key,
                        'department_name': effective_dept.name if effective_dept else 'Uncategorized',
                        'subjects': [],
                    }
                groups[key]['subjects'].append({
                    'id': sub.id,
                    'code': sub.code,
                    'name': sub.name,
                    'is_core': effective_is_core
                })
            categorized_subjects = sorted(
                groups.values(), key=lambda g: (g['department_id'] is None, g['department_name'].lower())
            )

            # 2. Fetch the dynamic rules for this specific grade
            # If no rule exists yet, it defaults to min 0, max 99 so it doesn't crash
            rule_data = {'min': 0, 'max': 99}
            if hasattr(grade, 'selection_rule'):
                rule_data = {
                    'min': grade.selection_rule.min_subjects,
                    'max': grade.selection_rule.max_subjects
                }

            return JsonResponse({
                'status': 'success',
                'data': {
                    'grade_name': grade.name,
                    'curriculum_id': grade.curriculum_id,
                    'curriculum_code': grade.curriculum.code if grade.curriculum_id else None,
                    'rules': rule_data,
                    'catalog': categorized_subjects
                }
            })

        except GradeLevel.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'Grade not found'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})



@require_permission('curriculum.view')
def api_student_subject_profile(request, student_id):
    """
    API 2: THE STUDENT PROFILE
    Fetches the subjects a specific student has chosen for the CURRENT active academic year.
    Returns the subjects and their approval status.
    """
    if request.method == 'GET':
        try:
            # 1. Find the current active academic year
            current_year = AcademicYear.objects.filter(is_active=True).first()
            if not current_year:
                return JsonResponse({'status': 'error', 'message': 'No active academic year found in the system.'})

            # 2. Fetch the student's enrollments for this year
            enrollments = StudentSubjectEnrollment.objects.filter(
                student_id=student_id,
                academic_year=current_year
            ).select_related('subject', 'subject__department')
            student_grade = StudentExtra.objects.filter(id=student_id).select_related('cl__grade__curriculum', 'cl__grade__tier').first()
            grade = student_grade.cl.grade if student_grade and student_grade.cl else None

            # 3. Format the data for the React UI
            enrolled_data = []
            for enrollment in enrollments:
                effective_dept = get_effective_department(
                    enrollment.subject, grade.curriculum if grade else None, grade.tier if grade else None
                )
                effective_is_core = get_effective_is_core(
                    enrollment.subject, grade.curriculum if grade else None, grade.tier if grade else None
                )
                enrolled_data.append({
                    'enrollment_id': enrollment.id,
                    'subject_id': enrollment.subject.id,
                    'subject_name': enrollment.subject.name,
                    'department_name': effective_dept.name if effective_dept else None,
                    'is_core': effective_is_core,
                    'status': enrollment.status  # Pending, Approved, or Rejected
                })

            return JsonResponse({
                'status': 'success',
                'data': {
                    'academic_year': current_year.year,
                    'student_id': student_id,
                    'subjects': enrolled_data,
                    # Powers AssignSubjectsPage.tsx's compulsory-tier lock/unlock control: the
                    # frontend can't evaluate is_class_teacher_of_student itself, so the backend
                    # tells it who's allowed to unlock. requires_pathway_choice tells the page
                    # whether to render the SSS pathway picker instead of the subject grid at all.
                    'is_locked': enrollments.filter(status='Approved').exists(),
                    'requires_pathway_choice': grade_requires_pathway_choice(grade),
                    'can_unlock': (
                        _is_admin(request.user) or is_class_teacher_of_student(request.user, student_grade)
                    ) if student_grade else False,
                }
            })

        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


@require_permission('curriculum.edit')
def api_manage_subject_enrollment(request, student_id):
    """
    API 3: THE ADMIN OVERRIDE
    Accepts the final list of approved subject IDs from the Admin.
    Updates the statuses to 'Approved' and marks removed ones as 'Rejected'.
    """
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            # This is the final, approved array of subject IDs sent from React
            approved_subject_ids = data.get('subject_ids', [])

            student = StudentExtra.objects.get(id=student_id)

            if student.cl and student.cl.grade:
                guard = curriculum_edit_guard(student.cl.grade.curriculum, request.user)
                if guard:
                    return guard

            current_year = AcademicYear.objects.filter(is_active=True).first()

            if not current_year:
                return JsonResponse({'status': 'error', 'message': 'No active academic year found.'})

            # 1. Fetch all existing records for this student this year
            existing_enrollments = StudentSubjectEnrollment.objects.filter(
                student=student,
                academic_year=current_year
            )

            # 2. THE AUDIT TRAIL: Any subject that was previously requested but is NOT
            # in the new approved list gets marked as 'Rejected' (instead of deleted).
            existing_enrollments.exclude(subject_id__in=approved_subject_ids).update(status='Rejected')

            # 3. THE APPROVAL ENGINE: Loop through the approved IDs from the frontend
            for sub_id in approved_subject_ids:
                # update_or_create is perfect here:
                # If the student already requested it, it changes status to 'Approved'.
                # If the admin is adding a brand new subject, it creates it as 'Approved'.
                StudentSubjectEnrollment.objects.update_or_create(
                    student=student,
                    academic_year=current_year,
                    subject_id=sub_id,
                    defaults={'status': 'Approved'}
                )

            return JsonResponse({
                'status': 'success',
                'message': f"Subjects successfully locked for {student.get_name}."
            })

        except StudentExtra.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'Student not found.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


def api_student_subjects_overview(request):
    """
    STUDENT SELF-SERVICE: the logged-in student's own compulsory (core, tier-eligible)
    subjects for the active academic year, each annotated with its lock status and — when
    resolvable — the teacher assigned to it for the student's own class. Powers the
    consolidated "My Subjects" page's Compulsory section. Electives deliberately stay on
    their own existing endpoint (api_student_elective_options, below) since that already has
    its own request/withdraw flow and SubjectPool-aware grouping; this endpoint only covers
    the fixed, non-choosable half of a student's subject list.
    """
    if request.method != 'GET':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)

    if not request.user.is_authenticated:
        return JsonResponse({'status': 'error', 'message': 'Authentication required.'}, status=401)

    student = getattr(request.user, 'studentextra', None)
    if not student or not student.cl or not student.cl.grade:
        return JsonResponse({'status': 'error', 'message': 'No student profile or class assignment found.'}, status=403)

    current_year = AcademicYear.objects.filter(is_active=True).first()
    if not current_year:
        return JsonResponse({'status': 'error', 'message': 'No active academic year found.'}, status=404)

    grade = student.cl.grade
    if grade.curriculum_id:
        eligible = _eligible_subjects_for(grade.curriculum, grade.tier)
    else:
        eligible = [(sub, sub.is_core, None, None, None) for sub in Subject.live.select_related('department')]

    enrollments = {
        e.subject_id: e for e in StudentSubjectEnrollment.objects.filter(student=student, academic_year=current_year)
    }
    teacher_by_subject = {
        alloc.subject_id: alloc.teacher.get_name
        for alloc in SubjectAllocation.objects.filter(classroom=student.cl, is_active=True).select_related('teacher__user')
    }

    compulsory = []
    for subject, effective_is_core, *_ in eligible:
        if not effective_is_core:
            continue
        enrollment = enrollments.get(subject.id)
        effective_dept = get_effective_department(subject, grade.curriculum, grade.tier)
        compulsory.append({
            'subject_id': subject.id,
            'subject_name': subject.name,
            'subject_code': subject.code,
            'department_name': effective_dept.name if effective_dept else None,
            'status': enrollment.status if enrollment else None,
            'teacher_name': teacher_by_subject.get(subject.id),
        })
    compulsory.sort(key=lambda s: s['subject_name'])

    return JsonResponse({
        'status': 'success',
        'data': {
            'academic_year': current_year.year,
            'grade_name': grade.name,
            'compulsory': compulsory,
        }
    })


def api_student_elective_options(request):
    """
    STUDENT SELF-SERVICE: lists the elective subjects available to the logged-in student's own
    grade (via SubjectQuota, is_core=False — the same grade-scoping used throughout the exams
    engine) alongside their current enrollment status for the active academic year, if any.

    Deliberately NOT gated by @require_permission — that decorator checks RBAC Role
    assignments, a staff-only concept a student account never has. This is an identity check
    (are you a student, request your own data) matching the same pattern already fixed on
    StudentReportCardAPIView.

    UPGRADED: when the student's grade+curriculum+tier+approved Pathway resolves to a
    CurriculumPreset (see _resolve_curriculum_preset), electives are grouped by that preset's
    SubjectPools (Core Compulsory / Pathway Core / Guided Elective) with each pool's pick
    range — the first real consumer of SubjectPool, which was previously modeled in
    CurriculumHub.tsx but never read anywhere. Grades with no matching preset (8-4-4, or CBC
    grades not yet configured with one) fall back to the original flat is_core=False list,
    returned under the same 'electives' key as before.
    """
    if request.method != 'GET':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)

    if not request.user.is_authenticated:
        return JsonResponse({'status': 'error', 'message': 'Authentication required.'}, status=401)

    student = getattr(request.user, 'studentextra', None)
    if not student or not student.cl or not student.cl.grade:
        return JsonResponse({'status': 'error', 'message': 'No student profile or class assignment found.'}, status=403)

    current_year = AcademicYear.objects.filter(is_active=True).first()
    if not current_year:
        return JsonResponse({'status': 'error', 'message': 'No active academic year found.'}, status=404)

    grade = student.cl.grade
    existing_enrollments = {
        e.subject_id: e for e in StudentSubjectEnrollment.objects.filter(
            student=student, academic_year=current_year
        )
    }

    def _option(subject):
        enrollment = existing_enrollments.get(subject.id)
        effective_dept = get_effective_department(subject, grade.curriculum, grade.tier)
        return {
            'subject_id': subject.id,
            'subject_name': subject.name,
            'subject_code': subject.code,
            'department_name': effective_dept.name if effective_dept else None,
            'status': enrollment.status if enrollment else None,
            'enrollment_id': enrollment.id if enrollment else None,
        }

    selection = _student_approved_selection(student, current_year)
    pathway = selection.pathway if selection else None
    track = selection.track if selection else None
    preset = _resolve_curriculum_preset(request, grade, pathway, track)

    if preset:
        pools = []
        for pool in _pools_for_pathway(preset, pathway, track):
            relevant_subjects = _pool_subjects_for_student(pool, pathway, track)

            def _excluded(s):
                # Always-core subjects (e.g. English, Kiswahili) are auto-assigned, and
                # SYSTEM_MANAGED_MATH_CODES subjects are assigned automatically based on
                # pathway (see _ensure_core_mathematics) -- neither is ever a student pick,
                # so both must be excluded from the shown pick range/list, or e.g. a
                # 6-subject pool with 4 always-core ones would look like it wants the
                # student to choose 5-6 from the 2 actual alternatives shown.
                return get_effective_is_core(s, grade.curriculum, grade.tier) or s.code in SYSTEM_MANAGED_MATH_CODES

            excluded_count = sum(1 for s in relevant_subjects if _excluded(s))
            pools.append({
                'pool_type': pool.pool_type,
                'pool_type_label': pool.get_pool_type_display(),
                'min_subjects': max(0, pool.min_subjects - excluded_count),
                'max_subjects': max(0, pool.max_subjects - excluded_count),
                'subjects': [_option(s) for s in relevant_subjects if not _excluded(s)],
            })

        return JsonResponse({
            'status': 'success',
            'data': {
                'academic_year': current_year.year,
                'grade_name': grade.name,
                'preset_name': preset.name,
                'pools': pools,
                'electives': [],
            }
        })

    elective_quotas = SubjectQuota.objects.filter(grade=grade).select_related('subject', 'subject__department')
    options = [
        _option(quota.subject) for quota in elective_quotas
        if not get_effective_is_core(quota.subject, grade.curriculum, grade.tier)
    ]

    return JsonResponse({
        'status': 'success',
        'data': {
            'academic_year': current_year.year,
            'grade_name': grade.name,
            'preset_name': None,
            'pools': None,
            'electives': options,
        }
    })


def api_student_elective_request(request):
    """
    STUDENT SELF-SERVICE: submit or withdraw a Pending elective choice for the logged-in
    student. POST creates/reopens a Pending request for one subject; DELETE withdraws a
    request the student made themselves, but only while it's still Pending — once Admin has
    Approved or Rejected it, only the Admin approval queue can change it (see
    api_elective_approval_decide), so a student can't silently undo a decision.
    """
    if not request.user.is_authenticated:
        return JsonResponse({'status': 'error', 'message': 'Authentication required.'}, status=401)

    student = getattr(request.user, 'studentextra', None)
    if not student or not student.cl or not student.cl.grade:
        return JsonResponse({'status': 'error', 'message': 'No student profile or class assignment found.'}, status=403)

    current_year = AcademicYear.objects.filter(is_active=True).first()
    if not current_year:
        return JsonResponse({'status': 'error', 'message': 'No active academic year found.'}, status=404)

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            subject_id = data.get('subject_id')
            subject = Subject.objects.get(id=subject_id)
        except (json.JSONDecodeError, Subject.DoesNotExist, TypeError):
            return JsonResponse({'status': 'error', 'message': 'A valid subject_id is required.'}, status=400)

        if get_effective_is_core(subject, student.cl.grade.curriculum, student.cl.grade.tier):
            return JsonResponse({'status': 'error', 'message': 'Core subjects do not require a request.'}, status=400)

        if subject.code in SYSTEM_MANAGED_MATH_CODES:
            return JsonResponse({
                'status': 'error',
                'message': f'{subject.name} is assigned automatically based on your pathway and cannot be requested directly.'
            }, status=400)

        selection = _student_approved_selection(student, current_year)
        pathway = selection.pathway if selection else None
        track = selection.track if selection else None
        preset = _resolve_curriculum_preset(request, student.cl.grade, pathway, track)
        if preset:
            # Pool-driven subjects are validated against the preset's pools below -- they
            # were never meant to carry a SubjectQuota row, so don't gate on one here.
            allowed_subject_ids = {
                s.id for pool in _pools_for_pathway(preset, pathway, track)
                for s in _pool_subjects_for_student(pool, pathway, track)
            }
            if subject.id not in allowed_subject_ids:
                return JsonResponse({
                    'status': 'error',
                    'message': f'{subject.name} is not part of your curriculum structure ({preset.name}).'
                }, status=400)
        else:
            is_valid_elective = SubjectQuota.objects.filter(grade=student.cl.grade, subject=subject).exists()
            if not is_valid_elective:
                return JsonResponse(
                    {'status': 'error', 'message': f'{subject.name} is not offered to your grade.'}, status=400)

        existing = StudentSubjectEnrollment.objects.filter(
            student=student, academic_year=current_year, subject=subject
        ).first()
        if existing and existing.status == 'Approved':
            return JsonResponse({
                'status': 'error', 'message': f'{subject.name} is already approved — no need to request it again.'
            }, status=400)

        enrollment, _ = StudentSubjectEnrollment.objects.update_or_create(
            student=student, academic_year=current_year, subject=subject,
            defaults={'status': 'Pending'}
        )
        return JsonResponse({
            'status': 'success',
            'message': f'Request for {subject.name} submitted for admin approval.',
            'data': {'enrollment_id': enrollment.id, 'status': enrollment.status}
        })

    elif request.method == 'DELETE':
        try:
            data = json.loads(request.body)
            enrollment_id = data.get('enrollment_id')
            enrollment = StudentSubjectEnrollment.objects.get(id=enrollment_id, student=student)
        except (json.JSONDecodeError, StudentSubjectEnrollment.DoesNotExist, TypeError):
            return JsonResponse({'status': 'error', 'message': 'Request not found.'}, status=404)

        if enrollment.status != 'Pending':
            return JsonResponse({
                'status': 'error',
                'message': f'This request has already been {enrollment.status.lower()} and can no longer be withdrawn.'
            }, status=400)

        subject_name = enrollment.subject.name
        enrollment.delete()
        return JsonResponse({'status': 'success', 'message': f'Withdrew your request for {subject_name}.'})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)


def _serialize_preset_combination(c):
    return {
        'id': c.id,
        'name': c.display_name(),
        'code': c.code,
        'subjects': [{'id': s.id, 'name': s.name, 'code': s.code} for s in c.subjects.all()],
    }


def _pathway_catalog(curriculum):
    """
    Shared pathway/track/active-combination serialization, used by both the student
    self-service pathway-options endpoint and the admin-facing equivalent.
    """
    pathways = (
        Pathway.objects.filter(curriculum=curriculum).prefetch_related(
            'tracks', 'tracks__preset_combinations__subjects'
        )
        if curriculum else Pathway.objects.none()
    )
    return [{
        'id': p.id, 'name': p.name, 'description': p.description,
        'tracks': [{
            'id': t.id, 'name': t.name, 'description': t.description,
            'preset_combinations': [_serialize_preset_combination(c) for c in t.preset_combinations.filter(is_active=True)],
        } for t in p.tracks.all()],
    } for p in pathways]


def _serialize_pathway_selection(selection):
    if not selection:
        return None
    return {
        'selection_id': selection.id,
        'pathway_id': selection.pathway_id,
        'pathway_name': selection.pathway.name,
        'track_id': selection.track_id,
        'track_name': selection.track.name if selection.track else None,
        'preset_combination_id': selection.preset_combination_id,
        'preset_combination_name': selection.preset_combination.display_name() if selection.preset_combination else None,
        'status': selection.status,
    }


def _validate_pathway_choice(grade, pathway_id, track_id, preset_combination_id):
    """
    Shared validation for (pathway_id, track_id, preset_combination_id) against a grade's
    curriculum. Returns ((pathway, track, preset_combination), None) on success, or
    (None, JsonResponse) with the error to return directly on failure. Used by both
    api_student_pathway_request (self-service) and api_admin_assign_pathway (override).
    """
    try:
        pathway = Pathway.objects.get(id=pathway_id)
    except (Pathway.DoesNotExist, TypeError, ValueError):
        return None, JsonResponse({'status': 'error', 'message': 'A valid pathway_id is required.'}, status=400)

    if not grade.curriculum_id or pathway.curriculum_id != grade.curriculum_id:
        return None, JsonResponse({'status': 'error', 'message': f'{pathway.name} is not offered to this grade.'}, status=400)

    track = None
    pathway_tracks = list(Track.objects.filter(pathway=pathway))
    if pathway_tracks:
        if not track_id:
            return None, JsonResponse({'status': 'error', 'message': f'{pathway.name} requires a track to also be chosen.'}, status=400)
        track = next((t for t in pathway_tracks if t.id == track_id), None)
        if track is None:
            return None, JsonResponse({'status': 'error', 'message': 'That track is not offered under this pathway.'}, status=400)
    elif track_id:
        return None, JsonResponse({'status': 'error', 'message': f'{pathway.name} does not have tracks to choose from.'}, status=400)

    preset_combination = None
    if preset_combination_id:
        if not track:
            return None, JsonResponse({'status': 'error', 'message': 'A preset combination requires a track to be chosen first.'}, status=400)
        preset_combination = PresetCombination.objects.filter(id=preset_combination_id, track=track, is_active=True).first()
        if preset_combination is None:
            return None, JsonResponse({'status': 'error', 'message': 'That combination is not offered under this track.'}, status=400)

    return (pathway, track, preset_combination), None


def _approve_combo_subjects(student, combo, academic_year):
    """
    Approving a preset-combination selection also approves its 3 subjects as the student's
    electives in one step. Shared by api_decide_pathway_request and api_admin_assign_pathway.
    """
    for subject in combo.subjects.all():
        StudentSubjectEnrollment.objects.update_or_create(
            student=student, subject=subject, academic_year=academic_year,
            defaults={'status': 'Approved'}
        )


def _ensure_core_mathematics(student, combo, academic_year):
    """
    Every SSS student must study mathematics regardless of pathway (per the CBC dossier), and
    assignment is fully automatic -- never a student pick (see SYSTEM_MANAGED_MATH_CODES,
    which keeps these two subjects out of self-service pool requests entirely). If `combo`'s
    subjects don't already include Advanced Mathematics (AMAT) or Core Mathematics (CMAT),
    auto-approve the pathway-appropriate alternative as an extra subject — added on top of
    the combo's 3, never displacing a chosen subject: Core Mathematics for a STEM student who
    didn't pick an Advanced-Math combination, Essential Mathematics for every other pathway.
    Idempotent via update_or_create.
    """
    combo_codes = set(combo.subjects.values_list('code', flat=True))
    if combo_codes & {'AMAT', 'CMAT'}:
        return
    is_stem = 'stem' in (combo.track.pathway.name or '').lower()
    math_code = 'CMAT' if is_stem else 'EMAT'
    try:
        math_subject = Subject.objects.get(code=math_code)
    except Subject.DoesNotExist:
        return
    StudentSubjectEnrollment.objects.update_or_create(
        student=student, subject=math_subject, academic_year=academic_year,
        defaults={'status': 'Approved'}
    )


def _revert_combo_subjects(student, combo, academic_year):
    """Reverse of _approve_combo_subjects, for unlocking a pathway selection."""
    StudentSubjectEnrollment.objects.filter(
        student=student, subject__in=combo.subjects.all(), academic_year=academic_year
    ).update(status='Pending')


def api_student_pathway_options(request):
    """
    STUDENT SELF-SERVICE: lists the Pathways available under the logged-in student's own
    grade's Curriculum, alongside their current pathway selection status for the active
    academic year, if any. Same identity-check pattern as api_student_elective_options —
    deliberately not gated by @require_permission since students never hold RBAC Roles.
    """
    if request.method != 'GET':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)

    if not request.user.is_authenticated:
        return JsonResponse({'status': 'error', 'message': 'Authentication required.'}, status=401)

    student = getattr(request.user, 'studentextra', None)
    if not student or not student.cl or not student.cl.grade:
        return JsonResponse({'status': 'error', 'message': 'No student profile or class assignment found.'}, status=403)

    current_year = AcademicYear.objects.filter(is_active=True).first()
    if not current_year:
        return JsonResponse({'status': 'error', 'message': 'No active academic year found.'}, status=404)

    grade = student.cl.grade
    selection = StudentPathwaySelection.objects.filter(
        student=student, academic_year=current_year
    ).select_related('pathway', 'track', 'preset_combination').first()

    # Pathway choice only happens once, on arrival at the entry grade of a pathway-choice
    # tier (Grade 10 under CBC's Senior Secondary) — later grades in the same tier (11, 12)
    # carry the choice forward and must not be offered the picker again. Still return the
    # student's own `selection` (if any) even when this is False, so a later-grade student
    # can at least see what they locked in, just not change it here.
    requires_choice = grade_requires_pathway_choice(grade)

    return JsonResponse({
        'status': 'success',
        'data': {
            'academic_year': current_year.year,
            'grade_name': grade.name,
            'requires_pathway_choice': requires_choice,
            'pathways': _pathway_catalog(grade.curriculum) if requires_choice else [],
            'selection': _serialize_pathway_selection(selection),
        }
    })


def api_student_pathway_request(request):
    """
    STUDENT SELF-SERVICE: submit or withdraw a Pending Pathway choice for the logged-in
    student — mirrors api_student_elective_request, except a student may only have one
    pathway selection per academic year (StudentPathwaySelection.unique_together), so POST
    upserts on (student, academic_year) rather than allowing many simultaneous requests.
    """
    if not request.user.is_authenticated:
        return JsonResponse({'status': 'error', 'message': 'Authentication required.'}, status=401)

    student = getattr(request.user, 'studentextra', None)
    if not student or not student.cl or not student.cl.grade:
        return JsonResponse({'status': 'error', 'message': 'No student profile or class assignment found.'}, status=403)

    current_year = AcademicYear.objects.filter(is_active=True).first()
    if not current_year:
        return JsonResponse({'status': 'error', 'message': 'No active academic year found.'}, status=404)

    if request.method == 'POST':
        grade = student.cl.grade
        if not grade_requires_pathway_choice(grade):
            return JsonResponse({
                'status': 'error',
                'message': 'Pathway choice is only made once, on arrival at Senior Secondary — it is not available here.'
            }, status=403)

        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'status': 'error', 'message': 'Invalid request body.'}, status=400)

        result, error = _validate_pathway_choice(
            grade, data.get('pathway_id'), data.get('track_id'), data.get('preset_combination_id')
        )
        if error:
            return error
        pathway, track, preset_combination = result

        existing = StudentPathwaySelection.objects.filter(student=student, academic_year=current_year).first()
        if existing and existing.status == 'Approved':
            return JsonResponse({
                'status': 'error',
                'message': f'{existing.pathway.name} is already approved — it can no longer be changed here.'
            }, status=400)

        selection, _ = StudentPathwaySelection.objects.update_or_create(
            student=student, academic_year=current_year,
            defaults={'pathway': pathway, 'track': track, 'preset_combination': preset_combination, 'status': 'Pending'}
        )

        request_summary = (
            f"{student.user.get_full_name() or student.user.username} requested {pathway.name}"
            f"{f' ({track.name})' if track else ''}"
            f"{f' — {preset_combination.display_name()}' if preset_combination else ''}."
        )
        notify_recipients = list(User.objects.filter(
            Q(is_superuser=True) | Q(is_staff=True) | Q(groups__name='ADMIN')
        ).distinct())
        class_teacher = getattr(student.cl, 'class_teacher', None)
        if class_teacher and class_teacher.user_id not in {u.id for u in notify_recipients}:
            notify_recipients.append(class_teacher.user)
        Notification.objects.bulk_create([
            Notification(
                recipient=recipient,
                title='New Pathway Request',
                message=request_summary,
                action_url='/admin-dashboard/pathway-requests',
            ) for recipient in notify_recipients
        ])

        return JsonResponse({
            'status': 'success',
            'message': f'Request for {pathway.name}'
                       f'{f" ({track.name})" if track else ""}'
                       f'{f" — {preset_combination.display_name()}" if preset_combination else ""} submitted for approval.',
            'data': {'selection_id': selection.id, 'status': selection.status}
        })

    elif request.method == 'DELETE':
        try:
            data = json.loads(request.body)
            selection_id = data.get('selection_id')
            selection = StudentPathwaySelection.objects.get(id=selection_id, student=student)
        except (json.JSONDecodeError, StudentPathwaySelection.DoesNotExist, TypeError):
            return JsonResponse({'status': 'error', 'message': 'Request not found.'}, status=404)

        if selection.status != 'Pending':
            return JsonResponse({
                'status': 'error',
                'message': f'This request has already been {selection.status.lower()} and can no longer be withdrawn.'
            }, status=400)

        pathway_name = selection.pathway.name
        selection.delete()
        return JsonResponse({'status': 'success', 'message': f'Withdrew your request for {pathway_name}.'})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)


@require_permission('pathway.view', edit_permission='pathway.edit')
def api_pathway_requests(request):
    """
    APPROVAL QUEUE: lists Pathway selections for review. Admins see every request; a Class
    Teacher only sees requests from students in classes they are the assigned Class Teacher
    of — mirrors TeacherLeaveViewSet.get_queryset's own-records-vs-admin-sees-all shape, but
    scoped through student.cl.class_teacher instead of a direct teacher FK.

    Requires the 'pathway.view'/'pathway.edit' RBAC permissions (module-scoped, like every
    other curriculum endpoint) — a Class Teacher must be granted 'pathway.edit' via their
    Role for this admin-or-class-teacher gate to ever let them through at all, same as
    attendance.edit gates SubmitBatchAttendanceView before its class-teacher check runs.
    """
    if request.method != 'GET':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)

    selections = StudentPathwaySelection.objects.select_related(
        'student__user', 'student__cl', 'pathway', 'track', 'preset_combination', 'academic_year'
    ).prefetch_related('preset_combination__subjects').order_by('-updated_at')

    if not _is_admin(request.user):
        teacher = getattr(request.user, 'teacherextra', None)
        if not teacher:
            return JsonResponse({'status': 'success', 'data': []})
        selections = selections.filter(student__cl__class_teacher=teacher)

    status_param = request.GET.get('status')
    if status_param:
        selections = selections.filter(status=status_param)

    data = [{
        'id': s.id,
        'student_id': s.student_id,
        'student_name': s.student.get_name,
        'student_roll': s.student.roll,
        'class_name': s.student.cl.name if s.student.cl else None,
        'pathway_id': s.pathway_id,
        'pathway_name': s.pathway.name,
        'track_id': s.track_id,
        'track_name': s.track.name if s.track else None,
        'preset_combination_id': s.preset_combination_id,
        'preset_combination_name': s.preset_combination.display_name() if s.preset_combination else None,
        'preset_combination_subjects': (
            [sub.name for sub in s.preset_combination.subjects.all()] if s.preset_combination else []
        ),
        'academic_year': s.academic_year.year,
        'status': s.status,
        'updated_at': s.updated_at.isoformat(),
    } for s in selections]

    return JsonResponse({'status': 'success', 'data': data})


@require_permission('pathway.view', edit_permission='pathway.edit')
def api_decide_pathway_request(request, selection_id):
    """
    Approve or reject one Pathway request. Authorized for an admin OR the specific student's
    assigned Class Teacher — the literal "admin OR class teacher" rule, built the same way
    attendance_views._enforce_class_teacher_or_admin gates the attendance register, using
    rbac.is_class_teacher_of_student since this check is student- rather than stream-scoped.
    """
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)

    try:
        selection = StudentPathwaySelection.objects.select_related(
            'student__cl', 'pathway', 'preset_combination', 'academic_year'
        ).get(id=selection_id)
    except StudentPathwaySelection.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Pathway request not found.'}, status=404)

    if not (_is_admin(request.user) or is_class_teacher_of_student(request.user, selection.student)):
        return JsonResponse({
            'status': 'error',
            'message': "Only an admin or this student's assigned Class Teacher can decide this request."
        }, status=403)

    try:
        data = json.loads(request.body)
        decision = data.get('decision')
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid request body.'}, status=400)

    if decision not in ('Approved', 'Rejected'):
        return JsonResponse({'status': 'error', 'message': "decision must be 'Approved' or 'Rejected'."}, status=400)

    with transaction.atomic():
        selection.status = decision
        selection.save(update_fields=['status', 'updated_at'])

        combo_note = ""
        # Approving a preset-combination request also approves its 3 subjects as the
        # student's electives in one atomic step — that's the whole point of picking a
        # single pre-approved combination instead of requesting 3 subjects separately (see
        # api_student_elective_request). Rejection leaves subject enrollments untouched;
        # there shouldn't be any yet for a combination that was never approved.
        if decision == 'Approved' and selection.preset_combination_id:
            combo = selection.preset_combination
            _approve_combo_subjects(selection.student, combo, selection.academic_year)
            _ensure_core_mathematics(selection.student, combo, selection.academic_year)
            combo_note = f" — combination '{combo.display_name()}' subjects auto-approved"

        write_audit_log(
            operator_id=request.user.id, action_type='UPDATE', module='Curriculum',
            description=f"{decision} pathway '{selection.pathway.name}' for {selection.student.get_name} "
                         f"(decided by: {request.user.username}){combo_note}."
        )

    return JsonResponse({
        'status': 'success',
        'message': f"{selection.pathway.name} {decision.lower()} for {selection.student.get_name}.",
    })


@require_permission('pathway.view', edit_permission='pathway.edit')
def api_admin_pathway_options(request, student_id):
    """
    ADMIN-FACING: same pathway/track/active-combination catalog as
    api_student_pathway_options, but for an arbitrary student — powers the Assign Subjects
    page's Senior Secondary branch.
    """
    if request.method != 'GET':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)

    try:
        student = StudentExtra.objects.select_related('cl__grade__curriculum', 'cl__grade__tier').get(id=student_id)
    except StudentExtra.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Student not found.'}, status=404)

    if not student.cl or not student.cl.grade:
        return JsonResponse({'status': 'error', 'message': 'Student has no class/grade assignment.'}, status=400)

    grade = student.cl.grade
    current_year = AcademicYear.objects.filter(is_active=True).first()
    if not current_year:
        return JsonResponse({'status': 'error', 'message': 'No active academic year found.'}, status=404)

    selection = StudentPathwaySelection.objects.filter(
        student=student, academic_year=current_year
    ).select_related('pathway', 'track', 'preset_combination').first()

    requires_choice = grade_requires_pathway_choice(grade)

    return JsonResponse({
        'status': 'success',
        'data': {
            'academic_year': current_year.year,
            'grade_name': grade.name,
            'requires_pathway_choice': requires_choice,
            'can_unlock': _is_admin(request.user) or is_class_teacher_of_student(request.user, student),
            'pathways': _pathway_catalog(grade.curriculum) if requires_choice else [],
            'selection': _serialize_pathway_selection(selection),
        }
    })


@require_permission('pathway.edit')
def api_admin_assign_pathway(request, student_id):
    """
    ADMIN OVERRIDE for Senior Secondary: directly assigns + approves a student's
    pathway/track/preset combination in one step — no Pending intermediate, mirroring how
    api_manage_subject_enrollment lets an admin directly approve subjects rather than route
    through the student-request queue.
    """
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)

    try:
        student = StudentExtra.objects.select_related('cl__grade__curriculum', 'cl__grade__tier').get(id=student_id)
    except StudentExtra.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Student not found.'}, status=404)

    if not (_is_admin(request.user) or is_class_teacher_of_student(request.user, student)):
        return JsonResponse({
            'status': 'error',
            'message': "Only an admin or this student's assigned Class Teacher can assign a pathway."
        }, status=403)

    if not student.cl or not student.cl.grade:
        return JsonResponse({'status': 'error', 'message': 'Student has no class/grade assignment.'}, status=400)

    grade = student.cl.grade
    if not grade_requires_pathway_choice(grade):
        return JsonResponse({
            'status': 'error',
            'message': f'{grade.name} is not the entry grade of its Senior Secondary tier — pathway choice is only made once, on arrival.'
        }, status=400)

    current_year = AcademicYear.objects.filter(is_active=True).first()
    if not current_year:
        return JsonResponse({'status': 'error', 'message': 'No active academic year found.'}, status=404)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid request body.'}, status=400)

    result, error = _validate_pathway_choice(
        grade, data.get('pathway_id'), data.get('track_id'), data.get('preset_combination_id')
    )
    if error:
        return error
    pathway, track, preset_combination = result

    with transaction.atomic():
        selection, _ = StudentPathwaySelection.objects.update_or_create(
            student=student, academic_year=current_year,
            defaults={'pathway': pathway, 'track': track, 'preset_combination': preset_combination, 'status': 'Approved'}
        )
        combo_note = ""
        if preset_combination:
            _approve_combo_subjects(student, preset_combination, current_year)
            _ensure_core_mathematics(student, preset_combination, current_year)
            combo_note = f" — combination '{preset_combination.display_name()}' subjects auto-approved"

        write_audit_log(
            operator_id=request.user.id, action_type='UPDATE', module='Curriculum',
            description=f"Assigned pathway '{pathway.name}' for {student.get_name} (assigned by: {request.user.username}){combo_note}."
        )

    return JsonResponse({
        'status': 'success',
        'message': f"{pathway.name} assigned and locked for {student.get_name}.",
        'data': {'selection_id': selection.id, 'status': selection.status},
    })


@require_permission('curriculum.edit')
def api_unlock_subject_enrollment(request, student_id):
    """
    Reverts a student's Approved (& Locked) subject enrollments for the current academic
    year back to Pending. Used for the compulsory-tier "Save & Lock" flow's counterpart
    unlock action on the Assign Subjects page.
    """
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)

    try:
        student = StudentExtra.objects.get(id=student_id)
    except StudentExtra.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Student not found.'}, status=404)

    if not (_is_admin(request.user) or is_class_teacher_of_student(request.user, student)):
        return JsonResponse({
            'status': 'error',
            'message': "Only an admin or this student's assigned Class Teacher can unlock subjects."
        }, status=403)

    current_year = AcademicYear.objects.filter(is_active=True).first()
    if not current_year:
        return JsonResponse({'status': 'error', 'message': 'No active academic year found.'}, status=404)

    updated = StudentSubjectEnrollment.objects.filter(
        student=student, academic_year=current_year, status='Approved'
    ).update(status='Pending')

    write_audit_log(
        operator_id=request.user.id, action_type='UPDATE', module='Curriculum',
        description=f"Unlocked {updated} subject(s) for {student.get_name} (unlocked by: {request.user.username})."
    )

    return JsonResponse({'status': 'success', 'is_locked': False})


@require_permission('pathway.edit')
def api_unlock_pathway_selection(request, student_id):
    """
    Reverts a student's Approved (& Locked) pathway selection back to Pending, along with the
    3 subjects its combination auto-approved — keeps the pathway selection and its derived
    subject enrollments from drifting out of sync.
    """
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)

    try:
        student = StudentExtra.objects.get(id=student_id)
    except StudentExtra.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Student not found.'}, status=404)

    if not (_is_admin(request.user) or is_class_teacher_of_student(request.user, student)):
        return JsonResponse({
            'status': 'error',
            'message': "Only an admin or this student's assigned Class Teacher can unlock a pathway."
        }, status=403)

    current_year = AcademicYear.objects.filter(is_active=True).first()
    if not current_year:
        return JsonResponse({'status': 'error', 'message': 'No active academic year found.'}, status=404)

    selection = StudentPathwaySelection.objects.filter(
        student=student, academic_year=current_year, status='Approved'
    ).select_related('preset_combination').first()
    if not selection:
        return JsonResponse({'status': 'error', 'message': 'No approved pathway selection to unlock.'}, status=400)

    with transaction.atomic():
        selection.status = 'Pending'
        selection.save(update_fields=['status', 'updated_at'])
        if selection.preset_combination_id:
            _revert_combo_subjects(student, selection.preset_combination, current_year)

        write_audit_log(
            operator_id=request.user.id, action_type='UPDATE', module='Curriculum',
            description=f"Unlocked pathway '{selection.pathway.name}' for {student.get_name} (unlocked by: {request.user.username})."
        )

    return JsonResponse({'status': 'success', 'is_locked': False})


@require_permission('curriculum.view', edit_permission='curriculum.edit')
def api_manage_selection_rules(request, grade_id):
    """
    Allows the React frontend to view and edit the minimum and maximum
    subject limits for a specific grade.
    """
    if request.method == 'GET':
        try:
            grade = GradeLevel.objects.get(id=grade_id)
            # Use get_or_create so we don't crash if the admin hasn't set one up yet.
            # Default fallback: min 7, max 8
            rule, created = SubjectSelectionRule.objects.get_or_create(
                grade=grade,
                defaults={'min_subjects': 7, 'max_subjects': 8}
            )

            return JsonResponse({
                'status': 'success',
                'data': {
                    'grade_name': grade.name,
                    'min_subjects': rule.min_subjects,
                    'max_subjects': rule.max_subjects
                }
            })
        except GradeLevel.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'Grade not found.'})

    elif request.method == 'POST':
        try:
            data = json.loads(request.body)
            grade = GradeLevel.objects.get(id=grade_id)

            guard = curriculum_edit_guard(grade.curriculum, request.user)
            if guard:
                return guard

            rule, created = SubjectSelectionRule.objects.get_or_create(grade=grade)

            # Update the rules with the new input from React
            rule.min_subjects = int(data.get('min_subjects', rule.min_subjects))
            rule.max_subjects = int(data.get('max_subjects', rule.max_subjects))

            # Basic validation
            if rule.min_subjects > rule.max_subjects:
                return JsonResponse({'status': 'error', 'message': 'Minimum cannot be greater than Maximum.'})

            rule.save()

            return JsonResponse({
                'status': 'success',
                'message': f'Curriculum rules updated for {grade.name}.'
            })

        except ValueError:
            return JsonResponse({'status': 'error', 'message': 'Please enter valid numbers.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method.'})


@require_permission('curriculum.view')
def api_get_academic_years(request):
    """
    Fetches all academic years to populate frontend dropdowns dynamically.
    """
    if request.method == 'GET':
        try:
            years = AcademicYear.objects.all().order_by('-year')  # Newest first
            data = []
            for y in years:
                data.append({
                    'id': y.id,
                    'year': y.year,
                    'is_active': y.is_active,
                    'is_archived': y.is_archived
                })
            return JsonResponse({'status': 'success', 'data': data})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})
    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


@require_permission('curriculum.view')
def api_class_pending_subjects(request, stream_id):
    """
    Aggregates subject enrollment statuses for an entire class stream.
    Used for the Batch Approvals dashboard.
    """
    if request.method == 'GET':
        try:
            # We pass the academic year ID as a query parameter from React: ?year_id=X
            year_id = request.GET.get('year_id')
            if not year_id:
                return JsonResponse({'status': 'error', 'message': 'Academic year ID required.'})

            stream = ClassStream.objects.get(id=stream_id)
            students = stream.studentextra_set.filter(status=True)  # Only active students

            data = []
            for student in students:
                # Count the enrollments for this specific student in the selected year
                enrollments = StudentSubjectEnrollment.objects.filter(
                    student=student,
                    academic_year_id=year_id
                )

                total_selected = enrollments.count()
                pending_count = enrollments.filter(status='Pending').count()
                approved_count = enrollments.filter(status='Approved').count()

                data.append({
                    'id': student.id,
                    'name': student.get_name,
                    'roll': student.roll,
                    'total_selected': total_selected,
                    'pending_count': pending_count,
                    'approved_count': approved_count
                })

            return JsonResponse({'status': 'success', 'data': data})

        except ClassStream.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'Class stream not found.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


@require_permission('curriculum.edit')
def api_bulk_approve_subjects(request, stream_id):
    """
    THE FOUR-CHECK VALIDATOR
    Checks Min/Max limits, Category Limits, Exclusion Rules, and (when the student's grade
    resolves to a CurriculumPreset — see _resolve_curriculum_preset) SubjectPool pick counts,
    before approving.
    """
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            student_ids = data.get('student_ids', [])
            year_id = data.get('year_id')

            if not student_ids or not year_id:
                return JsonResponse({'status': 'error', 'message': 'Missing student list or academic year.'})

            # 1. Fetch the Class and Grade
            stream = ClassStream.objects.get(id=stream_id)
            grade = stream.grade

            guard = curriculum_edit_guard(grade.curriculum, request.user)
            if guard:
                return guard

            # 2. Pre-fetch all Grade Policies to make the loop extremely fast
            # Base Limits
            min_subs, max_subs = 7, 8
            if hasattr(grade, 'selection_rule'):
                min_subs = grade.selection_rule.min_subjects
                max_subs = grade.selection_rule.max_subjects

            # Category Limits, keyed by department id (e.g., {3: 1, 1: 2})
            category_limits = {
                limit.department_id: limit.max_subjects
                for limit in grade.category_limits.all()
            }

            # Exclusion Rules (Pairs of forbidden subject IDs)
            exclusion_pairs = [
                set([rule.subject_a.id, rule.subject_b.id])
                for rule in grade.exclusion_rules.all()
            ]

            processed_count = 0
            skipped_students = []

            # Presets vary per student (different students in the same grade can have
            # different approved Pathways/Tracks), so they can't be pre-fetched once like the
            # policies above — cache by (pathway id, track id) instead, to avoid re-resolving
            # per student.
            preset_cache = {}

            def _preset_for(pathway, track):
                key = (pathway.id if pathway else None, track.id if track else None)
                if key not in preset_cache:
                    preset_cache[key] = _resolve_curriculum_preset(request, grade, pathway, track)
                return preset_cache[key]

            # 3. THE FILTER-AND-PROCESS LOOP
            for s_id in student_ids:
                enrollments = StudentSubjectEnrollment.objects.filter(
                    student_id=s_id,
                    academic_year_id=year_id
                ).select_related('subject', 'subject__department', 'student')

                if not enrollments.exists():
                    continue

                student_obj = enrollments[0].student
                student_name = student_obj.get_name
                selected_subjects = [e.subject for e in enrollments]
                selected_subject_ids = set([sub.id for sub in selected_subjects])
                total_selected = len(selected_subjects)

                is_valid = True
                skip_reason = ""

                # --- CHECK 1: Base Limit ---
                if not (min_subs <= total_selected <= max_subs):
                    is_valid = False
                    skip_reason = f"Selected {total_selected} subjects. Must be between {min_subs} and {max_subs}."

                # --- CHECK 2: Category Limits ---
                if is_valid:
                    # Count how many subjects the student picked per department, resolved
                    # against this grade's own curriculum (CBC and 8-4-4 group subjects into
                    # different departments — see Department model docstring).
                    dept_counts = {}
                    dept_names = {}
                    for sub in selected_subjects:
                        effective_dept = get_effective_department(sub, grade.curriculum, grade.tier)
                        dept_id = effective_dept.id if effective_dept else None
                        dept_counts[dept_id] = dept_counts.get(dept_id, 0) + 1
                        dept_names[dept_id] = effective_dept.name if effective_dept else 'Uncategorized'

                    # Verify against the limits
                    for dept_id, count in dept_counts.items():
                        if dept_id in category_limits and count > category_limits[dept_id]:
                            is_valid = False
                            skip_reason = f"Exceeded limit for {dept_names[dept_id]} (Selected {count}, Max {category_limits[dept_id]})."
                            break

                # --- CHECK 3: Mutually Exclusive Clashes ---
                if is_valid:
                    for pair in exclusion_pairs:
                        # If the student's selected IDs contain BOTH IDs from a forbidden pair
                        if pair.issubset(selected_subject_ids):
                            is_valid = False
                            skip_reason = "Subject Clash: Contains mutually exclusive subjects."
                            break

                # --- CHECK 4: Pool Constraints (CBC pathway/pool structure, if configured) ---
                if is_valid:
                    selection = _student_approved_selection(student_obj, year_id)
                    pathway = selection.pathway if selection else None
                    track = selection.track if selection else None
                    preset = _preset_for(pathway, track)
                    if preset:
                        for pool in _pools_for_pathway(preset, pathway, track):
                            pool_subject_ids = {s.id for s in _pool_subjects_for_student(pool, pathway, track)}
                            count = len(selected_subject_ids & pool_subject_ids)
                            if not (pool.min_subjects <= count <= pool.max_subjects):
                                is_valid = False
                                skip_reason = (
                                    f"{pool.get_pool_type_display()}: selected {count}, "
                                    f"must be between {pool.min_subjects} and {pool.max_subjects}."
                                )
                                break

                # --- THE DECISION ---
                if is_valid:
                    # Approve them!
                    enrollments.filter(status='Pending').update(status='Approved')
                    processed_count += 1
                else:
                    # Skip them and record the exact reason
                    skipped_students.append({
                        'name': student_name,
                        'reason': skip_reason
                    })

            # 4. Generate the Summary Response
            if len(skipped_students) == 0:
                message = f"Successfully approved all {processed_count} selected students."
                status_type = "success"
            else:
                message = f"Approved {processed_count} students. Skipped {len(skipped_students)} due to rule violations."
                status_type = "partial_success"

            return JsonResponse({
                'status': status_type,
                'message': message,
                'skipped': skipped_students
            })

        except ClassStream.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'Class stream not found.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method.'})


@require_permission('curriculum.view', edit_permission='curriculum.edit')
def api_manage_category_limits(request, grade_id):
    """
    Handles GET (fetch all), POST (add/update), and DELETE for Category Limits.
    """
    try:
        grade = GradeLevel.objects.get(id=grade_id)
    except GradeLevel.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Grade not found.'})

    if request.method == 'GET':
        limits = SubjectCategoryLimit.objects.filter(grade=grade).select_related('department')
        data = [{
            'id': limit.id,
            'department_id': limit.department_id,
            'department_name': limit.department.name if limit.department_id else None,
            'max_subjects': limit.max_subjects,
        } for limit in limits]
        return JsonResponse({'status': 'success', 'data': data})

    elif request.method == 'POST':
        guard = curriculum_edit_guard(grade.curriculum, request.user)
        if guard:
            return guard
        try:
            data = json.loads(request.body)
            department_id = data.get('department_id')
            max_subjects = int(data.get('max_subjects', 1))

            if not department_id:
                return JsonResponse({'status': 'error', 'message': 'Department is required.'})
            try:
                department = Department.objects.get(id=department_id)
            except Department.DoesNotExist:
                return JsonResponse({'status': 'error', 'message': 'Department not found.'})

            # update_or_create ensures we don't accidentally create two rules for the same department
            limit, created = SubjectCategoryLimit.objects.update_or_create(
                grade=grade,
                department=department,
                defaults={'max_subjects': max_subjects}
            )
            return JsonResponse({'status': 'success', 'message': f'Limit set: Max {max_subjects} for {department.name}.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    elif request.method == 'DELETE':
        guard = curriculum_edit_guard(grade.curriculum, request.user)
        if guard:
            return guard
        try:
            data = json.loads(request.body)
            limit_id = data.get('limit_id')
            SubjectCategoryLimit.objects.filter(id=limit_id, grade=grade).delete()
            return JsonResponse({'status': 'success', 'message': 'Category limit removed.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid method.'})

@require_permission('curriculum.view', edit_permission='curriculum.edit')
def api_manage_exclusion_rules(request, grade_id):
    """
    Handles GET (fetch all), POST (add rule), and DELETE for Subject Exclusions.
    """
    try:
        grade = GradeLevel.objects.get(id=grade_id)
    except GradeLevel.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Grade not found.'})

    if request.method == 'GET':
        rules = SubjectExclusionRule.objects.filter(grade=grade)
        data = [{
            'id': rule.id,
            'subject_a_id': rule.subject_a.id,
            'subject_a_name': rule.subject_a.name,
            'subject_b_id': rule.subject_b.id,
            'subject_b_name': rule.subject_b.name
        } for rule in rules]
        return JsonResponse({'status': 'success', 'data': data})

    elif request.method == 'POST':
        guard = curriculum_edit_guard(grade.curriculum, request.user)
        if guard:
            return guard
        try:
            data = json.loads(request.body)
            subject_a_id = data.get('subject_a_id')
            subject_b_id = data.get('subject_b_id')

            if subject_a_id == subject_b_id:
                return JsonResponse({'status': 'error', 'message': 'Cannot exclude a subject from itself.'})

            sub_a = Subject.objects.get(id=subject_a_id)
            sub_b = Subject.objects.get(id=subject_b_id)

            # --- PREVENT REPETITION (BIDIRECTIONAL CHECK) ---
            exists = SubjectExclusionRule.objects.filter(
                grade=grade
            ).filter(
                (Q(subject_a=sub_a) & Q(subject_b=sub_b)) |
                (Q(subject_a=sub_b) & Q(subject_b=sub_a))
            ).exists()

            if exists:
                return JsonResponse({'status': 'error', 'message': 'This clash rule already exists.'})
            # ------------------------------------------------

            # Create the rule
            SubjectExclusionRule.objects.create(grade=grade, subject_a=sub_a, subject_b=sub_b)

            return JsonResponse({'status': 'success', 'message': f'Rule added: {sub_a.name} excludes {sub_b.name}.'})
        except Subject.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'One or both subjects not found.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': 'Rule may already exist.'})

    elif request.method == 'DELETE':
        guard = curriculum_edit_guard(grade.curriculum, request.user)
        if guard:
            return guard
        try:
            data = json.loads(request.body)
            rule_id = data.get('rule_id')
            SubjectExclusionRule.objects.filter(id=rule_id, grade=grade).delete()
            return JsonResponse({'status': 'success', 'message': 'Exclusion rule removed.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid method.'})
