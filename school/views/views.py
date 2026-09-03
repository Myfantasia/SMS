from datetime import timedelta

from django.shortcuts import redirect
from django.db.models import Sum, Count
from apps.timetable.models import Timetable

from apps.identity.models import (
    AdminExtra, TeacherExtra, StudentExtra, ParentExtra, StaffExtra,
    ForcedPasswordChange,
)
from apps.staff.models import TeacherLeave
from django.contrib.auth.models import User, Group
from django.contrib.auth.hashers import make_password
from django.conf import settings
from django.core.mail import send_mail
import json
import re
import secrets

from django.http import JsonResponse

from school.decorators import require_permission
from django.contrib.auth import logout
from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from django.utils import timezone
from django.core.cache import cache
from apps.academics.models import Subject, ClassStream, AcademicYear, grade_requires_pathway_choice
from apps.allocations.models import SubjectAllocation
from apps.students.models import StudentSubjectEnrollment, StudentPathwaySelection
from school.permissions import api_login_required
from school.rbac import get_user_permission_codes, is_class_teacher_of_student
from apps.identity.models import Role, UserRole
from apps.core.services import write_audit_log
from school.views.auth_rate_limit import client_ip, is_student_search_rate_limited
from school.validators import profile_pic_validator


# Mapping from API user_type parameter to canonical module name for audit logs
_USER_TYPE_MODULE = {
    'students': 'Student',
    'teachers': 'Teacher',
    'parents': 'Parent',
    'staff': 'Staff',
}


@api_login_required
def api_global_search(request):
    """
    Unified global search portal. Scopes visibility dynamically based on user roles
    to guarantee child privacy, data security, and tailored relation-aware results.
    """
    query = request.GET.get('q', '').strip()
    if not query:
        return JsonResponse({'status': 'success', 'data': [], 'query': query})

    results = []
    user = request.user

    # Identify structural RBAC roles cleanly
    is_admin_user = user.is_superuser or user.groups.filter(name='ADMIN').exists()
    is_teacher_user = user.groups.filter(name='TEACHER').exists()
    is_parent_user = user.groups.filter(name='PARENT').exists()
    is_student_user = user.groups.filter(name='STUDENT').exists()

    try:
        # ==========================================
        # 1. SEARCH STUDENTS (Role-Scoped Context)
        # ==========================================
        student_filter = (
                Q(user__first_name__icontains=query) |
                Q(user__last_name__icontains=query) |
                Q(user__username__icontains=query) |
                Q(roll__icontains=query)
        )

        if is_admin_user or is_teacher_user:
            # Administrators and educators can look up any student in the institution
            students = StudentExtra.objects.filter(student_filter).select_related('user', 'cl')
        elif is_parent_user:
            # Parents can only look up their verified, linked children matching the query
            parent_profile = getattr(user, 'parentextra', None)
            if parent_profile:
                students = parent_profile.students.filter(student_filter).select_related('user', 'cl')
            else:
                students = []
        elif is_student_user:
            # Students can only find peers registered in their exact same class stream
            student_profile = getattr(user, 'studentextra', None)
            if student_profile and student_profile.cl:
                students = StudentExtra.objects.filter(student_filter, cl=student_profile.cl).select_related('user',
                                                                                                             'cl')
            else:
                students = StudentExtra.objects.filter(student_filter, user=user).select_related('user', 'cl')
        else:
            students = []

        for s in students:
            results.append({
                'id': s.id,
                'name': s.get_name,
                'username': s.user.username,
                'type': 'students',
                'role_label': 'Student'
            })

        # ==========================================
        # 2. SEARCH TEACHERS (Context-Aware Mapping)
        # ==========================================
        teacher_filter = (
                Q(user__first_name__icontains=query) |
                Q(user__last_name__icontains=query) |
                Q(user__username__icontains=query)
        )

        teachers = []
        if is_admin_user or is_teacher_user:
            # Staff can browse the entire faculty list
            teachers = TeacherExtra.objects.filter(teacher_filter).select_related('user')
        elif is_parent_user:
            # Parents can ONLY see teachers assigned to their children's specific streams
            parent_profile = getattr(user, 'parentextra', None)
            if parent_profile:
                child_stream_ids = parent_profile.students.filter(status=True).values_list('cl_id', flat=True)
                allocated_teacher_ids = SubjectAllocation.objects.filter(
                    classroom_id__in=child_stream_ids,
                    is_active=True
                ).values_list('teacher_id', flat=True)

                teachers = TeacherExtra.objects.filter(
                    teacher_filter,
                    id__in=allocated_teacher_ids
                ).select_related('user').distinct()
        elif is_student_user:
            # Students can ONLY search for educators allocated to their personal class stream
            student_profile = getattr(user, 'studentextra', None)
            if student_profile and student_profile.cl:
                allocated_teacher_ids = SubjectAllocation.objects.filter(
                    classroom=student_profile.cl,
                    is_active=True
                ).values_list('teacher_id', flat=True)

                teachers = TeacherExtra.objects.filter(
                    teacher_filter,
                    id__in=allocated_teacher_ids
                ).select_related('user').distinct()

        for t in teachers:
            results.append({
                'id': t.id,
                'name': t.get_name,
                'username': t.user.username,
                'type': 'teachers',
                'role_label': 'Teacher'
            })

        # ==========================================
        # 3. SEARCH PARENTS (Strict Admin Restriction)
        # ==========================================
        if is_admin_user:
            parents = ParentExtra.objects.filter(
                Q(user__first_name__icontains=query) |
                Q(user__last_name__icontains=query) |
                Q(user__username__icontains=query)
            ).select_related('user')

            for p in parents:
                results.append({
                    'id': p.id,
                    'name': p.get_name,
                    'username': p.user.username,
                    'type': 'parents',
                    'role_label': 'Parent'
                })

        # ==========================================
        # 4. SEARCH STAFF (Strict Admin Restriction)
        # ==========================================
        if is_admin_user:
            staff = StaffExtra.objects.filter(
                Q(user__first_name__icontains=query) |
                Q(user__last_name__icontains=query) |
                Q(user__username__icontains=query) |
                Q(job_title__icontains=query)
            ).select_related('user')

            for st in staff:
                results.append({
                    'id': st.id,
                    'name': st.get_name,
                    'username': st.user.username,
                    'type': 'staff',
                    'role_label': st.job_title or 'Staff'
                })

        return JsonResponse({'status': 'success', 'data': results, 'query': query})

    except Exception as e:
        # Prevent revealing structural database traces to the client on unexpected errors
        return JsonResponse({'status': 'error', 'message': 'An internal search processing fault occurred.'}, status=500)


def api_my_profile(request):
    # Ensure they are actually logged in via their session cookie
    if not request.user.is_authenticated:
        return JsonResponse({'status': 'error', 'message': 'You must be logged in to access this.'}, status=401)

    if request.method == 'GET':
        # Determine base role label
        role_label = 'Administrator' if request.user.is_superuser else 'User'

        data = {
            'id': request.user.id,
            'first_name': request.user.first_name,
            'last_name': request.user.last_name,
            'username': request.user.username,
            'email': request.user.email,
            'role': role_label,
            'teacher_id': None,  # Default placeholder for non-teachers
            'subjects': None,  # Default placeholder for non-teachers
            'is_class_teacher': False,  # Default placeholder for non-teachers
            'requires_pathway_choice': False,  # Default placeholder for non-students
            'permissions': sorted(get_user_permission_codes(request.user)),
            'must_change_password': ForcedPasswordChange.objects.filter(user=request.user).exists(),
        }

        # --- Check if this user is an approved student -- only Grade 10 (the entry grade of
        # a pathway-choice tier) sees the "My Pathway" menu item; see
        # apps.academics.models.grade_requires_pathway_choice for why. ---
        try:
            student_profile = StudentExtra.objects.select_related('cl__grade__tier').get(user=request.user)
            data['role'] = 'Student'
            grade = student_profile.cl.grade if student_profile.cl else None
            requires_choice = grade_requires_pathway_choice(grade)
            if requires_choice:
                current_year = AcademicYear.objects.filter(is_active=True).first()
                # Once approved there's nothing left to choose -- keep showing the menu item
                # while Pending/Rejected/absent so the student can still act on it.
                requires_choice = not StudentPathwaySelection.objects.filter(
                    student=student_profile, academic_year=current_year, status='Approved'
                ).exists()
            data['requires_pathway_choice'] = requires_choice
        except StudentExtra.DoesNotExist:
            pass

        # --- NEW: Check if this user is an approved teacher ---
        try:
            teacher_profile = TeacherExtra.objects.get(user=request.user)
            data['role'] = 'Teacher'
            data['teacher_id'] = teacher_profile.id
            data['subjects'] = teacher_profile.subjects or "N/A"
            data['is_class_teacher'] = teacher_profile.assigned_classes.filter(
                is_deleted=False, is_virtual=False
            ).exists()
        except TeacherExtra.DoesNotExist:
            # If they are an admin or student, this safely passes with no crash
            pass

        # --- Check if this user is an approved staff member ---
        try:
            staff_profile = StaffExtra.objects.get(user=request.user)
            data['role'] = 'Staff'
            data['job_title'] = staff_profile.job_title or None
        except StaffExtra.DoesNotExist:
            pass

        return JsonResponse({'status': 'success', 'data': data})

    elif request.method == 'POST':
        try:
            data = json.loads(request.body)
            current_password = data.get('current_password')
            new_password = data.get('new_password')

            # 1. Ensure both fields were provided
            if not current_password or not new_password:
                return JsonResponse({'status': 'error', 'message': 'Both current and new passwords are required.'})

            # 2. Check if the current password matches the database
            if not request.user.check_password(current_password):
                return JsonResponse({'status': 'error', 'message': 'Incorrect current password. Please try again.'})

            # 2b. Self-service change previously set anything as the new password with zero
            # strength checks — run it through the same validators every signup form uses.
            try:
                validate_password(new_password, user=request.user)
            except DjangoValidationError as e:
                return JsonResponse({'status': 'error', 'message': ' '.join(e.messages)})

            # 3. If it matches, safely hash and update the user's password in the database
            request.user.set_password(new_password)
            request.user.save()

            # A temporary/reset password has now been replaced with one only the user
            # knows — the forced-change gate on the dashboard no longer applies.
            ForcedPasswordChange.objects.filter(user=request.user).delete()

            # 4. Keep the user logged in after the password change
            update_session_auth_hash(request, request.user)

            return JsonResponse({'status': 'success', 'message': 'Password updated successfully!'})

        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})


@api_login_required
def api_get_single_user(request, user_type, user_id):
    try:
        if user_type == 'students':
            u = StudentExtra.objects.get(id=user_id)
            pic_url = request.build_absolute_uri(u.profile_pic.url) if u.profile_pic else None

            elective_enrollments = StudentSubjectEnrollment.objects.filter(
                student=u, status='Approved'
            ).select_related('subject').order_by('subject__name')
            elective_subjects = [
                {'id': e.subject_id, 'name': e.subject.name, 'code': e.subject.code}
                for e in elective_enrollments
            ]

            linked_parents = [
                {'id': p.id, 'name': p.user.get_full_name() or p.user.username, 'relationship': p.relationship, 'mobile': p.mobile}
                for p in u.parentextra_set.filter(status=True)
            ]

            data = {
                'name': u.get_name, 'first_name': u.user.first_name, 'last_name': u.user.last_name,
                'username': u.user.username, 'email': u.user.email,
                'class': str(u.cl) if u.cl else "Not Assigned",
                'cl_id': u.cl_id,
                'grade_name': u.cl.grade.name if u.cl and u.cl.grade else None,
                'stream_name': u.cl.name if u.cl else None,
                'mobile': u.mobile, 'address': u.address,
                'roll': u.roll, 'fee': u.fee, 'parent_name': u.parent_name, 'parent_mobile': u.parent_mobile,
                'family_structure': u.family_structure, 'single_parent_type': u.single_parent_type,
                'father_name': u.father_name, 'father_mobile': u.father_mobile,
                'mother_name': u.mother_name, 'mother_mobile': u.mother_mobile,
                'guardian_name': u.guardian_name, 'guardian_mobile': u.guardian_mobile,
                'guardian_relationship': u.guardian_relationship,
                'status': u.status, 'profile_pic': pic_url,
                'enrollment_state': u.enrollment_state, 'enrollment_notes': u.enrollment_notes,
                'viewer_is_class_teacher': is_class_teacher_of_student(request.user, u),
                'elective_subjects': elective_subjects,
                'linked_parents': linked_parents,
            }

        elif user_type == 'teachers':
            u = TeacherExtra.objects.get(id=user_id)
            pic_url = request.build_absolute_uri(u.profile_pic.url) if u.profile_pic else None

            allocations = SubjectAllocation.objects.filter(
                teacher=u,
                is_active=True
            ).select_related('classroom', 'subject')

            allocations_list = [
                {
                    'class_id': alloc.classroom.id,
                    'class_name': alloc.classroom.name,
                    'subject_name': alloc.subject.name,
                    'subject_code': alloc.subject.code if hasattr(alloc.subject, 'code') else ""
                }
                for alloc in allocations
            ]

            homeroom_streams = u.assigned_classes.filter(is_deleted=False)
            homeroom_names = [str(s) for s in homeroom_streams]

            data = {
                'name': u.get_name, 'first_name': u.user.first_name, 'last_name': u.user.last_name,
                'username': u.user.username, 'email': u.user.email,
                'subjects': u.subjects, 'mobile': u.mobile, 'address': u.address,
                'id_number': u.id_number, 'salary': u.salary, 'status': u.status,
                'profile_pic': pic_url, 'joindate': u.joindate,
                'is_class_teacher': bool(homeroom_names),
                'class_teacher_of': ", ".join(homeroom_names) if homeroom_names else None,
                # The real eligibility source every allocation check reads (see
                # TeacherExtra.qualified_subjects) — 'subjects' above is legacy display text only.
                'qualified_subject_ids': list(u.qualified_subjects.values_list('id', flat=True)),
                'qualified_subject_names': list(u.qualified_subjects.values_list('name', flat=True)),
            }
        elif user_type == 'parents':
            u = ParentExtra.objects.get(id=user_id)
            children_qs = u.students.select_related('cl', 'cl__grade')
            children_display = ", ".join([f"{child.get_name} ({child.roll})" for child in children_qs])
            children_rolls = ", ".join([child.roll for child in children_qs])
            children_detail = [
                {
                    'id': child.id, 'name': child.get_name, 'roll': child.roll,
                    'class': str(child.cl) if child.cl else "Not Assigned",
                    'enrollment_state': child.enrollment_state,
                }
                for child in children_qs
            ]
            data = {
                'name': u.get_name, 'first_name': u.user.first_name, 'last_name': u.user.last_name,
                'username': u.user.username, 'email': u.user.email,
                'children_display': children_display,  # <-- Added the readable names
                'children_rolls': children_rolls,
                'children_detail': children_detail,
                'mobile': u.mobile, 'relationship': u.relationship,
                'status': u.status, 'profile_pic': None
            }
        elif user_type == 'staff':
            u = StaffExtra.objects.get(id=user_id)
            pic_url = request.build_absolute_uri(u.profile_pic.url) if u.profile_pic else None
            assigned_roles = list(
                Role.objects.filter(user_assignments__user=u.user).values_list('name', flat=True)
            )
            data = {
                'name': u.get_name, 'first_name': u.user.first_name, 'last_name': u.user.last_name,
                'username': u.user.username, 'email': u.user.email,
                'job_title': u.job_title, 'mobile': u.mobile, 'address': u.address,
                'id_number': u.id_number, 'status': u.status, 'profile_pic': pic_url,
                'joindate': u.joindate,
                'requested_role': u.requested_role.name if u.requested_role else None,
                'assigned_roles': assigned_roles,
            }
        elif user_type == 'admins':
            u = AdminExtra.objects.get(id=user_id)
            data = {
                'name': f"{u.user.first_name} {u.user.last_name}".strip(),
                'first_name': u.user.first_name, 'last_name': u.user.last_name,
                'username': u.user.username, 'email': u.user.email,
                'mobile': u.mobile, 'address': u.address, 'status': u.status,
                'profile_pic': None,
            }
        else:
            return JsonResponse({'status': 'error', 'message': 'Invalid user type'})

        return JsonResponse({'status': 'success', 'data': data})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)})


@require_permission('users.edit')
def api_edit_single_user(request, user_type, user_id):
    """
    Modifies profile data structures across students, teachers, and parents.
    Enforces strict type safety and request scrubbing to eliminate 500 Server Crashes.
    """

    if request.method == 'POST':
        try:
            data = json.loads(request.body)

            def parse_status(status_val):
                if isinstance(status_val, str):
                    return status_val.lower() == 'true'
                return bool(status_val)

            warnings = []

            if user_type == 'students':
                u = StudentExtra.objects.get(id=user_id)

                new_username = data.get('username', u.user.username)
                if new_username != u.user.username:
                    if User.objects.filter(username=new_username).exclude(id=u.user.id).exists():
                        return JsonResponse(
                            {'status': 'error', 'message': f'Username "{new_username}" is already taken.'}, status=400)

                # Update Base Django User Model
                u.user.first_name = data.get('first_name', u.user.first_name)
                u.user.last_name = data.get('last_name', u.user.last_name)
                u.user.username = new_username
                u.user.email = data.get('email', u.user.email)
                u.user.save()

                # Update Student Profile Details with strict type scrubbing
                u.mobile = data.get('mobile', u.mobile)
                u.address = data.get('address', u.address)
                u.roll = data.get('roll', u.roll)
                u.parent_name = data.get('parent_name', u.parent_name)
                u.parent_mobile = data.get('parent_mobile', u.parent_mobile)

                # Structured family fields — if the client sends any of these, they become
                # the source of truth for the parent_name/parent_mobile summary above
                # (refresh_parent_summary() recomputes it) instead of whatever was also
                # sent as the plain parent_name/parent_mobile values.
                structured_fields = [
                    'family_structure', 'single_parent_type',
                    'father_name', 'father_mobile', 'mother_name', 'mother_mobile',
                    'guardian_name', 'guardian_mobile', 'guardian_relationship',
                ]
                if any(f in data for f in structured_fields):
                    for f in structured_fields:
                        if f in data:
                            setattr(u, f, data.get(f) or None)
                    u.refresh_parent_summary()
                if 'status' in data:
                    u.status = parse_status(data['status'])
                if 'enrollment_state' in data and data['enrollment_state'] in dict(StudentExtra.ENROLLMENT_STATUS_CHOICES):
                    u.enrollment_state = data['enrollment_state']
                if 'enrollment_notes' in data:
                    u.enrollment_notes = data.get('enrollment_notes') or None

                # Safe processing for fee numbers (prevent empty string crash)
                incoming_fee = data.get('fee')
                if incoming_fee is not None and incoming_fee != '':
                    try:
                        u.fee = float(incoming_fee)
                    except ValueError:
                        return JsonResponse({'status': 'error', 'message': 'Invalid format for Fee Balance.'},
                                            status=400)
                else:
                    u.fee = 0

                # Handle class stream foreign key mapping safely
                target_class_val = data.get('class_id') or data.get('class')
                if target_class_val is not None and target_class_val != '':
                    try:
                        # Only assign if the incoming value can be safely read as an integer ID
                        u.cl_id = int(target_class_val)
                    except ValueError:
                        # If it's a string name (like "Class 1"), do not try to cast it as an ID
                        pass
                elif target_class_val == "":
                    u.cl = None

                u.save()

            elif user_type == 'teachers':
                u = TeacherExtra.objects.get(id=user_id)

                new_username = data.get('username', u.user.username)
                if new_username != u.user.username:
                    if User.objects.filter(username=new_username).exclude(id=u.user.id).exists():
                        return JsonResponse(
                            {'status': 'error', 'message': f'Username "{new_username}" is already taken.'}, status=400)

                u.user.first_name = data.get('first_name', u.user.first_name)
                u.user.last_name = data.get('last_name', u.user.last_name)
                u.user.username = new_username
                u.user.email = data.get('email', u.user.email)
                u.user.save()

                u.mobile = data.get('mobile', u.mobile)
                u.address = data.get('address', u.address)
                u.id_number = data.get('id_number', u.id_number)
                if 'status' in data:
                    u.status = parse_status(data['status'])

                # Safe processing for salary numbers (prevent empty string crash)
                incoming_salary = data.get('salary')
                if incoming_salary is not None and incoming_salary != '':
                    try:
                        u.salary = float(incoming_salary)
                    except ValueError:
                        return JsonResponse({'status': 'error', 'message': 'Invalid format for Monthly Salary.'},
                                            status=400)
                else:
                    u.salary = 0

                u.save()

                # qualified_subjects (M2M) is the real eligibility source every allocation check
                # reads — editing the legacy free-text 'subjects' field here used to do nothing to
                # it. Mirrors the same set()+legacy-text-resync pattern api_edit_subject already
                # uses from the Subject page's teacher checklist.
                qualified_subject_ids = data.get('qualified_subject_ids')
                if qualified_subject_ids is not None:
                    prior_subject_ids = set(u.qualified_subjects.values_list('id', flat=True))
                    new_subjects = list(Subject.objects.filter(id__in=qualified_subject_ids))
                    new_subject_ids = {s.id for s in new_subjects}

                    dropped_ids = prior_subject_ids - new_subject_ids
                    if dropped_ids:
                        live_allocations = SubjectAllocation.objects.filter(
                            teacher=u, subject_id__in=dropped_ids, is_active=True
                        ).select_related('classroom', 'subject')
                        for alloc in live_allocations:
                            warnings.append(
                                f"{u.get_name} is still actively allocated to teach "
                                f"{alloc.subject.name} in {alloc.classroom.name} — that subject was "
                                f"just removed from their qualifications."
                            )

                    u.qualified_subjects.set(new_subjects)
                    u.subjects = ", ".join(s.name for s in new_subjects)
                    u.save(update_fields=['subjects'])
                elif 'subjects' in data:
                    # No structured id list sent — fall back to the legacy free-text write only.
                    u.subjects = data.get('subjects', u.subjects)
                    u.save(update_fields=['subjects'])

            elif user_type == 'parents':
                u = ParentExtra.objects.get(id=user_id)

                new_username = data.get('username', u.user.username)
                if new_username != u.user.username:
                    if User.objects.filter(username=new_username).exclude(id=u.user.id).exists():
                        return JsonResponse(
                            {'status': 'error', 'message': f'Username "{new_username}" is already taken.'}, status=400)

                u.user.first_name = data.get('first_name', u.user.first_name)
                u.user.last_name = data.get('last_name', u.user.last_name)
                u.user.username = new_username
                u.user.email = data.get('email', u.user.email)
                u.user.save()

                u.mobile = data.get('mobile', u.mobile)
                u.relationship = data.get('relationship', u.relationship)
                if 'status' in data:
                    u.status = parse_status(data['status'])
                u.save()

                if 'children_rolls' in data:
                    rolls = [r.strip() for r in data['children_rolls'].split(',') if r.strip()]
                    linked_students = StudentExtra.objects.filter(roll__in=rolls)
                    u.students.set(linked_students)

            elif user_type == 'staff':
                u = StaffExtra.objects.get(id=user_id)

                new_username = data.get('username', u.user.username)
                if new_username != u.user.username:
                    if User.objects.filter(username=new_username).exclude(id=u.user.id).exists():
                        return JsonResponse(
                            {'status': 'error', 'message': f'Username "{new_username}" is already taken.'}, status=400)

                u.user.first_name = data.get('first_name', u.user.first_name)
                u.user.last_name = data.get('last_name', u.user.last_name)
                u.user.username = new_username
                u.user.email = data.get('email', u.user.email)
                u.user.save()

                u.job_title = data.get('job_title', u.job_title)
                u.mobile = data.get('mobile', u.mobile)
                u.address = data.get('address', u.address)
                u.id_number = data.get('id_number', u.id_number)
                if 'status' in data:
                    u.status = parse_status(data['status'])
                u.save()

            else:
                return JsonResponse({'status': 'error', 'message': 'Invalid user type'}, status=400)

            return JsonResponse({'status': 'success', 'message': 'Profile updated successfully', 'warnings': warnings})

        except Exception as e:
            # Captures any residual runtime faults safely, sending an informative log back
            return JsonResponse({'status': 'error', 'message': f'Internal update error: {str(e)}'}, status=500)

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)


@api_login_required
def api_get_approved_users(request, user_type):
    data = []
    user = request.user

    is_admin_user = user.is_superuser or user.groups.filter(name='ADMIN').exists()
    is_teacher_user = user.groups.filter(name='TEACHER').exists()
    is_parent_user = user.groups.filter(name='PARENT').exists()
    is_student_user = user.groups.filter(name='STUDENT').exists()

    try:
        if user_type == 'students':
            if is_admin_user or is_teacher_user:
                users = StudentExtra.objects.filter(status=True, user__is_active=True).select_related('user', 'cl').order_by('user__first_name', 'user__last_name')
            elif is_parent_user:
                parent_profile = getattr(user, 'parentextra', None)
                users = parent_profile.students.filter(status=True, user__is_active=True).select_related('user', 'cl').order_by('user__first_name', 'user__last_name') if parent_profile else []
            elif is_student_user:
                student_profile = getattr(user, 'studentextra', None)
                if student_profile and student_profile.cl:
                    users = StudentExtra.objects.filter(status=True, user__is_active=True, cl=student_profile.cl).select_related('user', 'cl').order_by('user__first_name', 'user__last_name')
                else:
                    users = StudentExtra.objects.filter(status=True, user__is_active=True, user=user).select_related('user', 'cl')
            else:
                users = []

            for u in users:
                data.append({
                    'id': u.id,
                    'name': u.get_name,
                    'username': u.user.username,
                    'email': u.user.email,
                    'class': str(u.cl) if u.cl else "Not Assigned",
                    'enrollment_state': u.enrollment_state,
                    'grade_name': u.cl.grade.name if u.cl and u.cl.grade else "Not Assigned",
                    'grade_order': u.cl.grade.numeric_order if u.cl and u.cl.grade else 9999,
                })

        elif user_type == 'teachers':
            if is_admin_user or is_teacher_user:
                teachers = TeacherExtra.objects.filter(status=True, user__is_active=True).select_related('user').prefetch_related('assigned_classes').order_by('user__first_name', 'user__last_name')
            elif is_parent_user:
                parent_profile = getattr(user, 'parentextra', None)
                if parent_profile:
                    child_stream_ids = parent_profile.students.filter(status=True, user__is_active=True).values_list('cl_id', flat=True)
                    allocated_teacher_ids = SubjectAllocation.objects.filter(classroom_id__in=child_stream_ids, is_active=True).values_list('teacher_id', flat=True)
                    teachers = TeacherExtra.objects.filter(status=True, user__is_active=True, id__in=allocated_teacher_ids).select_related('user').distinct().order_by('user__first_name', 'user__last_name')
                else:
                    teachers = []
            elif is_student_user:
                student_profile = getattr(user, 'studentextra', None)
                if student_profile and student_profile.cl:
                    allocated_teacher_ids = SubjectAllocation.objects.filter(classroom=student_profile.cl, is_active=True).values_list('teacher_id', flat=True)
                    teachers = TeacherExtra.objects.filter(status=True, user__is_active=True, id__in=allocated_teacher_ids).select_related('user').distinct().order_by('user__first_name', 'user__last_name')
                else:
                    teachers = []
            else:
                teachers = []

            for u in teachers:
                homeroom_streams = u.assigned_classes.filter(is_deleted=False)
                homeroom_names = [str(s) for s in homeroom_streams]
                data.append({
                    'id': u.id,
                    'name': u.get_name,
                    'username': u.user.username,
                    'email': u.user.email,
                    'subjects': u.subjects or "N/A",
                    'is_class_teacher': bool(homeroom_names),
                    'class_teacher_of': ", ".join(homeroom_names) if homeroom_names else None,
                })

        elif user_type == 'parents':
            if is_admin_user or is_teacher_user:
                parents = ParentExtra.objects.filter(status=True, user__is_active=True).prefetch_related('students__user', 'students__cl').select_related('user').order_by('user__first_name', 'user__last_name')
            else:
                return JsonResponse({'status': 'error', 'message': 'Access Denied.'}, status=403)

            for u in parents:
                linked_children = sorted(u.students.all(), key=lambda c: c.get_name.lower())
                children = ", ".join([child.get_name for child in linked_children])
                data.append({
                    'id': u.id,
                    'name': u.get_name,
                    'username': u.user.username,
                    'email': u.user.email,
                    'children': children,
                    'children_detail': [
                        {'id': c.id, 'name': c.get_name, 'class': str(c.cl) if c.cl else 'Not Assigned'}
                        for c in linked_children
                    ],
                    'relationship': u.relationship,
                    'children_count': len(linked_children),
                })

        elif user_type == 'staff':
            if not is_admin_user:
                return JsonResponse({'status': 'error', 'message': 'Access Denied.'}, status=403)
            staff = StaffExtra.objects.filter(status=True, user__is_active=True).select_related('user').order_by('user__first_name', 'user__last_name')
            for u in staff:
                data.append({
                    'id': u.id,
                    'name': u.get_name,
                    'username': u.user.username,
                    'email': u.user.email,
                    'job_title': u.job_title or "N/A",
                })

        return JsonResponse({'status': 'success', 'data': data})

    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)}, status=500)


@require_permission('users.delete')
def api_delete_user(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            user_type = data.get('user_type')
            user_id = data.get('id')

            if user_type == 'students':
                obj = StudentExtra.objects.get(id=user_id)
            elif user_type == 'teachers':
                obj = TeacherExtra.objects.get(id=user_id)
            elif user_type == 'parents':
                obj = ParentExtra.objects.get(id=user_id)
            elif user_type == 'staff':
                obj = StaffExtra.objects.get(id=user_id)
            else:
                return JsonResponse({'status': 'error', 'message': 'Invalid user type'})

            from apps.identity.models import trash_user_account
            trash_user_account(
                obj, operator=request.user,
                module=_USER_TYPE_MODULE.get(user_type, user_type[:-1].capitalize()), label=obj.get_name,
            )

            return JsonResponse({'status': 'success'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


@require_permission('users.view')
def api_get_pending_users(request, user_type):

    data = []
    try:
        if user_type == 'students':
            users = StudentExtra.objects.filter(status=False).select_related('user', 'cl').order_by('user__first_name', 'user__last_name')
            for u in users:
                data.append({'id': u.id, 'name': u.get_name, 'username': u.user.username, 'email': u.user.email, 'class': str(u.cl) if u.cl else "Not Assigned"})

        elif user_type == 'teachers':
            users = TeacherExtra.objects.filter(status=False).select_related('user').order_by('user__first_name', 'user__last_name')
            for u in users:
                data.append({'id': u.id, 'name': u.get_name, 'username': u.user.username, 'email': u.user.email, 'subjects': u.subjects or "N/A"})

        elif user_type == 'parents':
            users = ParentExtra.objects.filter(status=False).select_related('user').prefetch_related('students__user').order_by('user__first_name', 'user__last_name')
            for u in users:
                # Get names of all linked children
                linked_children = sorted(u.students.all(), key=lambda c: c.get_name.lower())
                children = ", ".join([child.get_name for child in linked_children])
                data.append({
                    'id': u.id, 'name': u.get_name, 'username': u.user.username, 'email': u.user.email,
                    'children': children, 'relationship': u.relationship,
                })

        elif user_type == 'admins':
            # Only admins awaiting a first review. Once "approve" is clicked a
            # verification code is generated and they move out of this list until
            # the applicant enters it themselves (see admin_login_view).
            users = AdminExtra.objects.filter(status=False, verification_code__isnull=True).select_related('user').order_by('user__first_name', 'user__last_name')
            for u in users:
                name = f"{u.user.first_name} {u.user.last_name}".strip()
                data.append({'id': u.id, 'name': name, 'username': u.user.username, 'email': u.user.email})

        elif user_type == 'staff':
            users = StaffExtra.objects.filter(status=False).select_related('user').order_by('user__first_name', 'user__last_name')
            for u in users:
                data.append({
                    'id': u.id, 'name': u.get_name, 'username': u.user.username, 'email': u.user.email,
                    'job_title': u.job_title or "N/A",
                    'requested_role': u.requested_role.name if u.requested_role else "None selected",
                })

        return JsonResponse({'status': 'success', 'data': data})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)})


def _generate_admin_verification_code(admin_extra, operator, request, description):
    """
    Generates a fresh 6-digit verification code for a pending admin, stores only its hash
    (see AdminExtra.verification_code), resets any prior guess-attempt lockout, logs the
    event, and returns the raw code — the only place it's ever visible. Shared by the
    approve-admin step (api_process_approval) and the standalone regenerate endpoint
    (api_regenerate_admin_code in admin_invite_views.py) so both stay in lockstep.
    """
    code = f"{secrets.randbelow(1_000_000):06d}"
    admin_extra.verification_code = make_password(code)
    admin_extra.code_generated_at = timezone.now()
    admin_extra.save()
    cache.delete(f'verify_code_attempts:{admin_extra.pk}')
    write_audit_log(
        operator_id=operator.id, action_type='CREATE', module='AdminVerification',
        description=description, ip_address=client_ip(request),
    )
    return code


@require_permission('users.approve')
def api_process_approval(request):
    """
    Receives a POST request from React containing the user's ID, type, and the action (approve/reject).
    """

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            user_type = data.get('user_type')
            user_id = data.get('id')
            action = data.get('action')  # Will be 'approve' or 'reject'

            # Dynamically select the correct database model
            if user_type == 'students':
                obj = StudentExtra.objects.get(id=user_id)
            elif user_type == 'teachers':
                obj = TeacherExtra.objects.get(id=user_id)
            elif user_type == 'parents':
                obj = ParentExtra.objects.get(id=user_id)
            elif user_type == 'admins':
                obj = AdminExtra.objects.get(id=user_id)
            elif user_type == 'staff':
                obj = StaffExtra.objects.get(id=user_id)
            else:
                return JsonResponse({'status': 'error', 'message': 'Invalid user type'})

            if action == 'approve':
                if user_type == 'admins':
                    # Admins get a two-step approval: clicking "approve" does not grant
                    # access by itself. It generates a one-time code that this admin must
                    # relay to the applicant out-of-band; the applicant enters it themselves
                    # on the admin login page to finish activating their own account.
                    code = _generate_admin_verification_code(
                        obj, request.user, request,
                        f"Generated admin verification code for '{obj.user.username}'.",
                    )
                    return JsonResponse({'status': 'success', 'verification_code': code})

                obj.status = True
                obj.save()

                # Staff picked their intended type at signup — auto-assign that Role now
                # so the admin doesn't have to go re-find it on Roles & Permissions. Still
                # just a starting point: freely editable there afterward like any other
                # individual assignment.
                if user_type == 'staff' and obj.requested_role:
                    UserRole.objects.get_or_create(user=obj.user, role=obj.requested_role)

                write_audit_log(
                    operator_id=request.user.id, action_type='APPROVE', module='AccountApproval',
                    description=f"Approved {user_type[:-1]} account for '{obj.user.username}'.",
                    ip_address=client_ip(request),
                )
            elif action == 'reject':
                # Deleting the core User automatically cascades to the Extra models
                user = obj.user
                username = user.username
                write_audit_log(
                    operator_id=request.user.id, action_type='REJECT', module='AccountApproval',
                    description=f"Rejected and deleted {user_type[:-1]} account for '{username}'.",
                    ip_address=client_ip(request),
                )
                user.delete()

            return JsonResponse({'status': 'success'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


# Purpose: Lets an admin create a fully-active account directly from the User Directory
# (Students/Teachers/Parents/Staff), skipping the public self-signup + approval queue
# entirely -- status=True from the moment the row is created. Reuses the same
# Group/Role assignment shape as the public signup views (public_api_views.py) and the
# same random-temp-password + ForcedPasswordChange pattern password_reset_views.py's
# _reset_password_and_notify uses for admin-initiated resets, since this is the same
# "admin hands someone a one-time password out-of-band" situation at account-creation
# time instead of reset time.
@require_permission('users.approve')
def api_admin_create_user(request):
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)

    # multipart/form-data, not JSON -- the optional profile photo upload requires
    # request.FILES, same convention api_signup_teacher/api_signup_student use.
    data = request.POST
    user_type = data.get('user_type')
    if user_type not in ('students', 'teachers', 'parents', 'staff'):
        return JsonResponse({'status': 'error', 'message': 'Invalid user type.'}, status=400)

    first_name = (data.get('first_name') or '').strip()
    last_name = (data.get('last_name') or '').strip()
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip().lower()
    mobile = (data.get('mobile') or '').strip()
    address = (data.get('address') or '').strip()
    profile_pic = request.FILES.get('profile_pic')
    if profile_pic:
        try:
            profile_pic_validator(profile_pic)
        except DjangoValidationError as e:
            return JsonResponse({'status': 'error', 'message': ' '.join(e.messages)}, status=400)

    if not first_name or not last_name:
        return JsonResponse({'status': 'error', 'message': 'First and last name are required.'}, status=400)
    if not username:
        return JsonResponse({'status': 'error', 'message': 'Username is required.'}, status=400)
    if User.objects.filter(username=username).exists():
        return JsonResponse({'status': 'error', 'message': 'This username is already taken.'}, status=400)

    # Students get an auto-generated @student address (they log in with their admission
    # number, not email) exactly like api_signup_student -- everyone else logs in with
    # email, so it's a required field for them.
    if user_type == 'students':
        first_local = _sanitize_email_local_part(first_name)
        last_local = _sanitize_email_local_part(last_name)
        domain = "@student.myfantasia.com"
        email = f"{first_local}.{last_local}{domain}"
        counter = 1
        while User.objects.filter(email=email).exists() and counter < 500:
            email = f"{first_local}.{last_local}{counter}{domain}"
            counter += 1
        if User.objects.filter(email=email).exists():
            email = f"{first_local}.{last_local}.{secrets.token_hex(3)}{domain}"
    else:
        if not email:
            return JsonResponse({'status': 'error', 'message': 'Email is required.'}, status=400)
        if User.objects.filter(email=email).exists():
            return JsonResponse({'status': 'error', 'message': 'An account with this email already exists.'}, status=400)

    # Type-specific required fields, validated before we touch the database so a bad
    # class/role id doesn't leave behind a half-created User.
    class_stream = None
    role = None
    student_ids = []
    if user_type == 'students':
        class_id = data.get('class_stream_id')
        if class_id:
            class_stream = ClassStream.objects.filter(id=class_id).first()
            if not class_stream:
                return JsonResponse({'status': 'error', 'message': 'Selected class was not found.'}, status=400)
    elif user_type == 'parents':
        student_ids = [int(sid) for sid in request.POST.getlist('student_ids') if sid]
        if student_ids:
            found = list(StudentExtra.objects.filter(id__in=student_ids))
            if len(found) != len(set(student_ids)):
                return JsonResponse({'status': 'error', 'message': 'One or more selected students were not found.'}, status=400)
    elif user_type == 'staff':
        role_id = data.get('role_id')
        if role_id:
            role = Role.objects.filter(id=role_id, is_system_role=False).first()
            if not role:
                return JsonResponse({'status': 'error', 'message': 'Selected role was not found.'}, status=400)

    temp_password = secrets.token_urlsafe(9)

    user = User.objects.create_user(
        username=username, email=email, password=temp_password,
        first_name=first_name, last_name=last_name,
    )

    if user_type == 'students':
        student = StudentExtra.objects.create(
            user=user, roll=username, mobile=mobile, address=address,
            fee=data.get('fee') or None, cl=class_stream, status=True,
            profile_pic=profile_pic,
            family_structure=data.get('family_structure') or None,
            single_parent_type=data.get('single_parent_type') or None,
            father_name=data.get('father_name') or None, father_mobile=data.get('father_mobile') or None,
            mother_name=data.get('mother_name') or None, mother_mobile=data.get('mother_mobile') or None,
            guardian_name=data.get('guardian_name') or None, guardian_mobile=data.get('guardian_mobile') or None,
            guardian_relationship=data.get('guardian_relationship') or None,
        )
        student.refresh_parent_summary()
        student.save()
        group_name = 'STUDENT'
    elif user_type == 'teachers':
        subjects_list = request.POST.getlist('subjects')
        teacher = TeacherExtra.objects.create(
            user=user, id_number=data.get('id_number') or None, mobile=mobile, address=address,
            status=True, salary=data.get('salary') or 0, subjects=", ".join(subjects_list),
            profile_pic=profile_pic,
        )
        if subjects_list:
            teacher.qualified_subjects.set(Subject.objects.filter(name__in=subjects_list))
        group_name = 'TEACHER'
        teacher_role = Role.objects.filter(name='Teacher').first()
        if teacher_role:
            UserRole.objects.get_or_create(user=user, role=teacher_role)
    elif user_type == 'parents':
        parent = ParentExtra.objects.create(
            user=user, mobile=mobile, relationship=data.get('relationship') or 'Father', status=True,
        )
        if student_ids:
            parent.students.set(student_ids)
        group_name = 'PARENT'
    else:  # staff
        staff = StaffExtra.objects.create(
            user=user, job_title=data.get('job_title') or '', requested_role=role,
            id_number=data.get('id_number') or None, mobile=mobile, address=address, status=True,
            profile_pic=profile_pic,
        )
        group_name = 'STAFF'
        if role:
            UserRole.objects.get_or_create(user=user, role=role)

    group, _ = Group.objects.get_or_create(name=group_name)
    group.user_set.add(user)

    # A temp password handed over by an admin must not quietly become permanent.
    ForcedPasswordChange.objects.get_or_create(user=user)

    email_sent = False
    if user_type != 'students':
        try:
            send_mail(
                subject='Your MyFantasia account was created',
                message=(
                    f"Hi {first_name},\n\n"
                    f"An administrator ({request.user.get_full_name() or request.user.username}) created a "
                    "MyFantasia account for you.\n\n"
                    f"Username: {username}\n"
                    f"Temporary password: {temp_password}\n\n"
                    "Please log in and set your own new password immediately -- you'll be "
                    "prompted for one automatically.\n\n"
                    "— MyFantasia"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email],
                fail_silently=True,
            )
            email_sent = True
        except Exception:
            pass

    write_audit_log(
        operator_id=request.user.id, action_type='CREATE', module='UserManagement',
        description=f"Created {user_type[:-1]} account for '{username}'.",
        ip_address=client_ip(request),
    )

    return JsonResponse({
        'status': 'success',
        'message': f'{user_type[:-1].capitalize()} account created.',
        'username': username,
        'email': email,
        'temp_password': temp_password,
        'email_sent': email_sent,
    })


# Purpose: This fetches the live counts and sums directly from your PostgreSQL database
# and sends them to React as a JSON object to populate your charts and cards.
@api_login_required
@require_permission('users.view')
def dashboard_stats(request):
    # Summing up the fees to calculate total revenue
    revenue_aggr = StudentExtra.objects.filter(status=True).aggregate(Sum('fee', default=0))
    revenue = revenue_aggr['fee__sum'] or 0

    # Getting the logged-in admin's name, or defaulting to "Admin" if testing without session
    admin_name = request.user.first_name if request.user.is_authenticated else "Admin"

    # "New this month" trend counts for the dashboard stat cards -- real data off each
    # user's date_joined, not a fabricated placeholder.
    thirty_days_ago = timezone.now() - timedelta(days=30)

    data = {
        "student_count": StudentExtra.objects.filter(status=True).count(),
        "teacher_count": TeacherExtra.objects.filter(status=True).count(),
        "parent_count": ParentExtra.objects.filter(status=True).count(),
        "staff_count": StaffExtra.objects.filter(status=True).count(),
        "student_new_30d": StudentExtra.objects.filter(status=True, user__date_joined__gte=thirty_days_ago).count(),
        "teacher_new_30d": TeacherExtra.objects.filter(status=True, user__date_joined__gte=thirty_days_ago).count(),
        "parent_new_30d": ParentExtra.objects.filter(status=True, user__date_joined__gte=thirty_days_ago).count(),
        "staff_new_30d": StaffExtra.objects.filter(status=True, user__date_joined__gte=thirty_days_ago).count(),
        "revenue": revenue,
        "admin_name": admin_name,
        "message": "Real-time statistics live from PostgreSQL."
    }
    return JsonResponse(data)


# Purpose: This calculates how many users are waiting for approval (status=False).
# React will use this to show the red alert badge on the Navbar bell icon.
@api_login_required
@require_permission('users.view')
def pending_approvals_api(request):
    pending_teachers = TeacherExtra.objects.filter(status=False).count()
    pending_students = StudentExtra.objects.filter(status=False).count()
    pending_parents = ParentExtra.objects.filter(status=False).count()
    pending_admins = AdminExtra.objects.filter(status=False, verification_code__isnull=True).count()
    pending_staff = StaffExtra.objects.filter(status=False).count()
    pending_leaves = TeacherLeave.objects.filter(status='Pending').count()

    timetable_warnings = 0

    # Locate all timetables currently marked as Draft or unpublished
    active_draft_timetables = Timetable.objects.exclude(status='Published')
    for t in active_draft_timetables:
        cached_errors = cache.get(f"timetable_errors_{t.id}")
        if cached_errors:
            timetable_warnings += len(cached_errors)

    data = {
        "pending_teachers": pending_teachers,
        "pending_students": pending_students,
        "pending_parents": pending_parents,
        "pending_admins": pending_admins,
        "pending_staff": pending_staff,
        "pending_leaves": pending_leaves,
        "timetable_warnings": timetable_warnings,
        "total_pending": pending_teachers + pending_students + pending_parents + pending_admins + pending_staff + pending_leaves
    }
    return JsonResponse(data)

# Purpose: Accepts a GET request from the React frontend, safely terminates
# the Django user session, and redirects the user back to the public React home page.
# Absolute redirect (not redirect('/')) because '/' on Django's own origin no longer
# serves anything -- the public pages live in the React app now (see
# school/views/public_api_views.py's _resolve_post_login_destination for the equivalent
# post-login routing logic, now JSON-based).
def custom_logout_view(request):
    logout(request)
    return redirect('http://localhost:5173/')


def _sanitize_email_local_part(value):
    """Strips everything but a-z/0-9 from a name before it goes into an auto-generated
    email local-part, so accents/apostrophes/hyphens ("O'Brien", "Anne-Marie") produce a
    clean address instead of one that's merely technically valid."""
    cleaned = re.sub(r'[^a-z0-9]', '', value.lower())
    return cleaned or 'student'


def api_search_students_for_parent_signup(request):
    """Public, pre-login student lookup for the parent signup page's child-linking step.
    Selection-by-ID from these results is what makes linking exact (no more typo-prone
    manual admission-number/name matching) — see ParentExtraForm.selected_student_ids.
    Deliberately minimal fields: no address/mobile/DOB/parent info, just enough to
    recognize the right child. Rate-limited since this is otherwise a scriptable way to
    enumerate every student's name and admission number."""
    if request.method != 'GET':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method.'}, status=405)

    query = request.GET.get('q', '').strip()
    if len(query) < 2:
        return JsonResponse({'status': 'success', 'data': []})

    if is_student_search_rate_limited(request):
        return JsonResponse({'status': 'error', 'message': 'Too many searches — please slow down and try again shortly.'}, status=429)

    students = StudentExtra.objects.filter(
        Q(roll__icontains=query) | Q(user__first_name__icontains=query) | Q(user__last_name__icontains=query)
    ).select_related('user', 'cl').order_by('user__first_name', 'user__last_name')[:8]

    # A student who selected "Both Parents" legitimately has 2 real accounts to link
    # (mother + father) — a student on Single Parent/Guardian (or with no family_structure
    # set yet, e.g. records predating this feature) only ever expects 1. linked_count vs.
    # this capacity is what lets the UI show "1 of 2 parents linked" instead of treating
    # any existing link as a hard "taken" signal for both-parent households.
    linked_counts = dict(
        StudentExtra.objects.filter(id__in=[s.id for s in students])
        .annotate(num_parents=Count('parentextra'))
        .values_list('id', 'num_parents')
    )

    data = []
    for s in students:
        capacity = 2 if s.family_structure == 'both' else 1
        linked = linked_counts.get(s.id, 0)
        data.append({
            'id': s.id,
            'roll': s.roll,
            'first_name': s.user.first_name,
            'last_name': s.user.last_name,
            'class_name': str(s.cl) if s.cl else None,
            'already_linked': linked >= capacity,
            'linked_parent_count': linked,
            'parent_capacity': capacity,
        })

    return JsonResponse({'status': 'success', 'data': data})


