from django.views.decorators.csrf import csrf_exempt
from school.models.classSubjects_models import (StudentSubjectEnrollment, SubjectSelectionRule,
                     GradeLevel, Subject, ClassStream, SubjectCategoryLimit, SubjectExclusionRule,
                     SubjectQuota, Pathway, CurriculumPreset, SubjectPool, StudentPathwaySelection,
                     SystemAuditLog)
from school.models.models import ( TeacherExtra, StudentExtra, AcademicYear,)
from django.http import JsonResponse
import json
from django.db.models import Q
from school.decorators import require_permission
from school.rbac import curriculum_edit_guard, is_class_teacher_of_student


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


def _resolve_curriculum_preset(grade, pathway):
    """
    Resolves which CurriculumPreset (and therefore which SubjectPool structure) governs a
    student's elective choices, given their grade and their approved Pathway (None for JSS
    or non-CBC grades). Returns None when nothing matches — callers fall back to the flat,
    curriculum-agnostic SubjectQuota-based behavior that predates presets/pools, so 8-4-4
    grades and CBC grades without a configured preset are unaffected.
    """
    if not grade.curriculum_id:
        return None
    return CurriculumPreset.objects.filter(
        curriculum=grade.curriculum, tier=grade.tier, pathway=pathway
    ).prefetch_related('pools__subjects').first()


def _student_approved_pathway(student, academic_year):
    selection = StudentPathwaySelection.objects.filter(
        student=student, academic_year=academic_year, status='Approved'
    ).select_related('pathway').first()
    return selection.pathway if selection else None


@csrf_exempt
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

            if is_admin:
                subjects = Subject.objects.all().order_by('name')
            elif is_teacher:
                teacher = user.teacherextra
                # Single source of truth for eligibility (see TeacherExtra.qualified_subjects)
                subjects = teacher.qualified_subjects.all().order_by('name')
            else:
                subjects = Subject.objects.none()

            data = []
            for sub in subjects:
                teachers = TeacherExtra.objects.filter(qualified_subjects=sub, status=True)
                teacher_names = [t.get_name for t in teachers]

                data.append({
                    'id': sub.id,
                    'code': sub.code,
                    'name': sub.name,
                    'department': sub.department,
                    'is_core': sub.is_core,
                    'allow_double_periods': sub.allow_double_periods,
                    'earliest_allowed_time': sub.earliest_allowed_time.strftime('%H:%M') if sub.earliest_allowed_time else None,
                    'assigned_teachers': teacher_names,
                    'assigned_teacher_ids': [t.id for t in teachers]
                })
            return JsonResponse({'status': 'success', 'data': data})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

@csrf_exempt
@require_permission('curriculum.edit')
def api_add_subject(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            Subject.objects.create(
                code=data['code'].upper(),
                name=data['name'],
                department=data['department'],
                is_core=data.get('is_core', True),
                allow_double_periods=data.get('allow_double_periods', True),
                earliest_allowed_time=data.get('earliest_allowed_time') or None
            )
            return JsonResponse({'status': 'success', 'message': 'Subject added successfully.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})

@csrf_exempt
@require_permission('curriculum.edit')
def api_edit_subject(request, pk):
    if request.method == 'POST' or request.method == 'PUT':
        try:
            data = json.loads(request.body)
            subject = Subject.objects.get(id=pk)
            old_subject_name = subject.name

            subject.code = data.get('code', subject.code).upper()
            subject.name = data.get('name', subject.name)
            subject.department = data.get('department', subject.department)
            subject.is_core = data.get('is_core', subject.is_core)
            subject.allow_double_periods = data.get('allow_double_periods', subject.allow_double_periods)
            if 'earliest_allowed_time' in data:
                subject.earliest_allowed_time = data['earliest_allowed_time'] or None
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

@csrf_exempt
@require_permission('curriculum.edit')
def api_delete_subject(request, pk):
    if request.method == 'POST' or request.method == 'DELETE':
        try:
            subject = Subject.objects.get(id=pk)
            subject.delete()
            return JsonResponse({'status': 'success', 'message': 'Subject permanently deleted.'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})
    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


@csrf_exempt
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
            subjects = Subject.objects.all().order_by('name')

            # 1. Group subjects by department
            categorized_subjects = {}
            for sub in subjects:
                dept = sub.department
                if dept not in categorized_subjects:
                    categorized_subjects[dept] = []

                categorized_subjects[dept].append({
                    'id': sub.id,
                    'code': sub.code,
                    'name': sub.name,
                    'is_core': sub.is_core
                })

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
                    'rules': rule_data,
                    'catalog': categorized_subjects
                }
            })

        except GradeLevel.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'Grade not found'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})



@csrf_exempt
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
            ).select_related('subject')

            # 3. Format the data for the React UI
            enrolled_data = []
            for enrollment in enrollments:
                enrolled_data.append({
                    'enrollment_id': enrollment.id,
                    'subject_id': enrollment.subject.id,
                    'subject_name': enrollment.subject.name,
                    'department': enrollment.subject.department,
                    'is_core': enrollment.subject.is_core,
                    'status': enrollment.status  # Pending, Approved, or Rejected
                })

            return JsonResponse({
                'status': 'success',
                'data': {
                    'academic_year': current_year.year,
                    'student_id': student_id,
                    'subjects': enrolled_data
                }
            })

        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


@csrf_exempt
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


@csrf_exempt
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
        return {
            'subject_id': subject.id,
            'subject_name': subject.name,
            'subject_code': subject.code,
            'department': subject.department,
            'status': enrollment.status if enrollment else None,
            'enrollment_id': enrollment.id if enrollment else None,
        }

    pathway = _student_approved_pathway(student, current_year)
    preset = _resolve_curriculum_preset(grade, pathway)

    if preset:
        pools = [{
            'pool_type': pool.pool_type,
            'pool_type_label': pool.get_pool_type_display(),
            'min_subjects': pool.min_subjects,
            'max_subjects': pool.max_subjects,
            'subjects': [_option(s) for s in pool.subjects.filter(is_core=False)],
        } for pool in preset.pools.all()]

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

    elective_quotas = SubjectQuota.objects.filter(
        grade=grade, subject__is_core=False
    ).select_related('subject')
    options = [_option(quota.subject) for quota in elective_quotas]

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


@csrf_exempt
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

        if subject.is_core:
            return JsonResponse({'status': 'error', 'message': 'Core subjects do not require a request.'}, status=400)

        is_valid_elective = SubjectQuota.objects.filter(grade=student.cl.grade, subject=subject).exists()
        if not is_valid_elective:
            return JsonResponse({'status': 'error', 'message': f'{subject.name} is not offered to your grade.'}, status=400)

        pathway = _student_approved_pathway(student, current_year)
        preset = _resolve_curriculum_preset(student.cl.grade, pathway)
        if preset and not SubjectPool.objects.filter(preset=preset, subjects=subject).exists():
            return JsonResponse({
                'status': 'error',
                'message': f'{subject.name} is not part of your curriculum structure ({preset.name}).'
            }, status=400)

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


@csrf_exempt
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
    pathways = Pathway.objects.filter(curriculum=grade.curriculum) if grade.curriculum_id else Pathway.objects.none()
    selection = StudentPathwaySelection.objects.filter(
        student=student, academic_year=current_year
    ).select_related('pathway').first()

    return JsonResponse({
        'status': 'success',
        'data': {
            'academic_year': current_year.year,
            'grade_name': grade.name,
            'pathways': [{'id': p.id, 'name': p.name, 'description': p.description} for p in pathways],
            'selection': {
                'selection_id': selection.id,
                'pathway_id': selection.pathway_id,
                'pathway_name': selection.pathway.name,
                'status': selection.status,
            } if selection else None,
        }
    })


@csrf_exempt
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
        try:
            data = json.loads(request.body)
            pathway_id = data.get('pathway_id')
            pathway = Pathway.objects.get(id=pathway_id)
        except (json.JSONDecodeError, Pathway.DoesNotExist, TypeError):
            return JsonResponse({'status': 'error', 'message': 'A valid pathway_id is required.'}, status=400)

        grade = student.cl.grade
        if not grade.curriculum_id or pathway.curriculum_id != grade.curriculum_id:
            return JsonResponse({'status': 'error', 'message': f'{pathway.name} is not offered to your grade.'}, status=400)

        existing = StudentPathwaySelection.objects.filter(student=student, academic_year=current_year).first()
        if existing and existing.status == 'Approved':
            return JsonResponse({
                'status': 'error',
                'message': f'{existing.pathway.name} is already approved — it can no longer be changed here.'
            }, status=400)

        selection, _ = StudentPathwaySelection.objects.update_or_create(
            student=student, academic_year=current_year,
            defaults={'pathway': pathway, 'status': 'Pending'}
        )
        return JsonResponse({
            'status': 'success',
            'message': f'Request for {pathway.name} submitted for approval.',
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


@csrf_exempt
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
        'student__user', 'student__cl', 'pathway', 'academic_year'
    ).order_by('-updated_at')

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
        'academic_year': s.academic_year.year,
        'status': s.status,
        'updated_at': s.updated_at.isoformat(),
    } for s in selections]

    return JsonResponse({'status': 'success', 'data': data})


@csrf_exempt
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
        selection = StudentPathwaySelection.objects.select_related('student__cl', 'pathway').get(id=selection_id)
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

    selection.status = decision
    selection.save(update_fields=['status', 'updated_at'])

    SystemAuditLog.objects.create(
        operator=request.user, action_type='UPDATE', module='Curriculum',
        description=f"{decision} pathway '{selection.pathway.name}' for {selection.student.get_name} "
                     f"(decided by: {request.user.username})."
    )

    return JsonResponse({
        'status': 'success',
        'message': f"{selection.pathway.name} {decision.lower()} for {selection.student.get_name}.",
    })


@csrf_exempt
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


@csrf_exempt
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


@csrf_exempt
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


@csrf_exempt
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

            # Category Limits (e.g., {'Technical': 1, 'Languages': 2})
            category_limits = {
                limit.department: limit.max_subjects
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
            # different approved Pathways), so they can't be pre-fetched once like the
            # policies above — cache by pathway id instead, to avoid re-resolving per student.
            preset_cache = {}

            def _preset_for(pathway):
                key = pathway.id if pathway else None
                if key not in preset_cache:
                    preset_cache[key] = _resolve_curriculum_preset(grade, pathway)
                return preset_cache[key]

            # 3. THE FILTER-AND-PROCESS LOOP
            for s_id in student_ids:
                enrollments = StudentSubjectEnrollment.objects.filter(
                    student_id=s_id,
                    academic_year_id=year_id
                ).select_related('subject', 'student')

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
                    # Count how many subjects the student picked per department
                    dept_counts = {}
                    for sub in selected_subjects:
                        dept_counts[sub.department] = dept_counts.get(sub.department, 0) + 1

                    # Verify against the limits
                    for dept, count in dept_counts.items():
                        if dept in category_limits and count > category_limits[dept]:
                            is_valid = False
                            skip_reason = f"Exceeded limit for {dept} (Selected {count}, Max {category_limits[dept]})."
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
                    pathway = _student_approved_pathway(student_obj, year_id)
                    preset = _preset_for(pathway)
                    if preset:
                        for pool in preset.pools.all():
                            pool_subject_ids = set(pool.subjects.values_list('id', flat=True))
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


@csrf_exempt
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
        limits = SubjectCategoryLimit.objects.filter(grade=grade)
        data = [{'id': limit.id, 'department': limit.department, 'max_subjects': limit.max_subjects} for limit in limits]
        return JsonResponse({'status': 'success', 'data': data})

    elif request.method == 'POST':
        guard = curriculum_edit_guard(grade.curriculum, request.user)
        if guard:
            return guard
        try:
            data = json.loads(request.body)
            department = data.get('department')
            max_subjects = int(data.get('max_subjects', 1))

            if not department:
                return JsonResponse({'status': 'error', 'message': 'Department is required.'})

            # update_or_create ensures we don't accidentally create two rules for the same department
            limit, created = SubjectCategoryLimit.objects.update_or_create(
                grade=grade,
                department=department,
                defaults={'max_subjects': max_subjects}
            )
            return JsonResponse({'status': 'success', 'message': f'Limit set: Max {max_subjects} for {department}.'})
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

@csrf_exempt
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
