from django.shortcuts import render,redirect,reverse
from django.db.models import Sum
from school.models.timetable_models import Timetable
from school import forms
from django.contrib.auth.models import Group
from django.http import HttpResponseRedirect
from django.contrib.auth.decorators import login_required,user_passes_test
from django.conf import settings
from django.core.mail import send_mail

from school.models.models import (
    AdminExtra, TeacherExtra, StudentExtra, ParentExtra, StaffExtra,
    Notice, Event,
)
from school.models.teachers_model import TeacherLeave
from django.contrib.auth.models import User
from django.contrib.auth import login, authenticate
import json
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.contrib import messages

from django.http import JsonResponse

from school.decorators import (
    is_admin, is_teacher, is_student, is_parent, is_school_staff,
     is_approved_student, is_approved_parent
)
from django.contrib.auth import logout
from django.contrib.auth import update_session_auth_hash
from django.db.models import Q
import secrets
from django.utils import timezone
from django.core.cache import cache
from school.models.classSubjects_models import Subject, SubjectAllocation
from school.permissions import api_login_required, api_admin_required
from school.rbac import get_user_permission_codes, is_class_teacher_of_student


@csrf_exempt
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

        return JsonResponse({'status': 'success', 'data': results, 'query': query})

    except Exception as e:
        # Prevent revealing structural database traces to the client on unexpected errors
        return JsonResponse({'status': 'error', 'message': 'An internal search processing fault occurred.'}, status=500)


@csrf_exempt
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
            'permissions': sorted(get_user_permission_codes(request.user)),
        }

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

            # 3. If it matches, safely hash and update the user's password in the database
            request.user.set_password(new_password)
            request.user.save()

            # 4. Keep the user logged in after the password change
            update_session_auth_hash(request, request.user)

            return JsonResponse({'status': 'success', 'message': 'Password updated successfully!'})

        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})


@csrf_exempt
@api_login_required
def api_get_single_user(request, user_type, user_id):
    try:
        if user_type == 'students':
            u = StudentExtra.objects.get(id=user_id)
            pic_url = request.build_absolute_uri(u.profile_pic.url) if u.profile_pic else None
            data = {
                'name': u.get_name, 'first_name': u.user.first_name, 'last_name': u.user.last_name,
                'username': u.user.username, 'email': u.user.email,
                'class': str(u.cl) if u.cl else "Not Assigned", 'mobile': u.mobile, 'address': u.address,
                'roll': u.roll, 'fee': u.fee, 'parent_name': u.parent_name, 'parent_mobile': u.parent_mobile,
                'status': u.status, 'profile_pic': pic_url,
                'enrollment_state': u.enrollment_state, 'enrollment_notes': u.enrollment_notes,
                'viewer_is_class_teacher': is_class_teacher_of_student(request.user, u),
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
                'profile_pic': pic_url,
                'is_class_teacher': bool(homeroom_names),
                'class_teacher_of': ", ".join(homeroom_names) if homeroom_names else None,
                # The real eligibility source every allocation check reads (see
                # TeacherExtra.qualified_subjects) — 'subjects' above is legacy display text only.
                'qualified_subject_ids': list(u.qualified_subjects.values_list('id', flat=True)),
            }
        elif user_type == 'parents':
            u = ParentExtra.objects.get(id=user_id)
            children_display = ", ".join([f"{child.get_name} ({child.roll})" for child in u.students.all()])
            children_rolls = ", ".join([child.roll for child in u.students.all()])
            data = {
                'name': u.get_name, 'first_name': u.user.first_name, 'last_name': u.user.last_name,
                'username': u.user.username, 'email': u.user.email,
                'children_display': children_display,  # <-- Added the readable names
                'children_rolls': children_rolls,
                'mobile': u.mobile, 'relationship': u.relationship,
                'status': u.status, 'profile_pic': None
            }
        elif user_type == 'staff':
            u = StaffExtra.objects.get(id=user_id)
            pic_url = request.build_absolute_uri(u.profile_pic.url) if u.profile_pic else None
            data = {
                'name': u.get_name, 'first_name': u.user.first_name, 'last_name': u.user.last_name,
                'username': u.user.username, 'email': u.user.email,
                'job_title': u.job_title, 'mobile': u.mobile, 'address': u.address,
                'id_number': u.id_number, 'status': u.status, 'profile_pic': pic_url,
            }
        else:
            return JsonResponse({'status': 'error', 'message': 'Invalid user type'})

        return JsonResponse({'status': 'success', 'data': data})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)})


@csrf_exempt
def api_edit_single_user(request, user_type, user_id):
    """
    Modifies profile data structures across students, teachers, and parents.
    Enforces strict type safety and request scrubbing to eliminate 500 Server Crashes.
    """
    # 1. Strict Security Boundary Safeguards using your established structure
    if not request.user.is_authenticated:
        return JsonResponse({'status': 'error', 'message': 'Authentication required.'}, status=401)
    if not is_admin(request.user):
        return JsonResponse({'status': 'error', 'message': 'Admin privileges required.'}, status=403)

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


@csrf_exempt
@api_login_required
def api_get_approved_users(request, user_type):
    data = []
    user = request.user

    # 1. Identify structural RBAC roles cleanly
    is_admin_user = user.is_superuser or user.groups.filter(name='ADMIN').exists()
    is_teacher_user = user.groups.filter(name='TEACHER').exists()
    is_parent_user = user.groups.filter(name='PARENT').exists()
    is_student_user = user.groups.filter(name='STUDENT').exists()

    try:
        # ==========================================
        # 1. FETCH STUDENTS DIRECTORY
        # ==========================================
        if user_type == 'students':
            if is_admin_user or is_teacher_user:
                # Admins and Teachers can view all active students
                users = StudentExtra.objects.filter(status=True).select_related('user', 'cl')
            elif is_parent_user:
                # Parents can only see their own verified, linked children
                parent_profile = getattr(user, 'parentextra', None)
                users = parent_profile.students.filter(status=True).select_related('user', 'cl') if parent_profile else []
            elif is_student_user:
                # Students can only see peers registered in their exact same class stream
                student_profile = getattr(user, 'studentextra', None)
                if student_profile and student_profile.cl:
                    users = StudentExtra.objects.filter(status=True, cl=student_profile.cl).select_related('user', 'cl')
                else:
                    users = StudentExtra.objects.filter(status=True, user=user).select_related('user', 'cl')
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
                })

        # ==========================================
        # 2. FETCH TEACHERS DIRECTORY
        # ==========================================
        elif user_type == 'teachers':
            if is_admin_user or is_teacher_user:
                # Admins and Teachers can view the entire active faculty list
                teachers = TeacherExtra.objects.filter(status=True).select_related('user').prefetch_related('assigned_classes')
            elif is_parent_user:
                # Parents can ONLY see teachers assigned to their children's specific streams
                parent_profile = getattr(user, 'parentextra', None)
                if parent_profile:
                    child_stream_ids = parent_profile.students.filter(status=True).values_list('cl_id', flat=True)
                    allocated_teacher_ids = SubjectAllocation.objects.filter(classroom_id__in=child_stream_ids, is_active=True).values_list('teacher_id', flat=True)
                    teachers = TeacherExtra.objects.filter(status=True, id__in=allocated_teacher_ids).select_related('user').distinct()
                else:
                    teachers = []
            elif is_student_user:
                # Students can ONLY see educators allocated to their personal class stream
                student_profile = getattr(user, 'studentextra', None)
                if student_profile and student_profile.cl:
                    allocated_teacher_ids = SubjectAllocation.objects.filter(classroom=student_profile.cl, is_active=True).values_list('teacher_id', flat=True)
                    teachers = TeacherExtra.objects.filter(status=True, id__in=allocated_teacher_ids).select_related('user').distinct()
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

        # ==========================================
        # 3. FETCH PARENTS DIRECTORY
        # ==========================================
        elif user_type == 'parents':
            if is_admin_user or is_teacher_user:
                # Admins and Teachers can view all active parent records
                parents = ParentExtra.objects.filter(status=True).prefetch_related('students')
            else:
                # Students and Parents are strictly blocked from browsing the parent directory layout for privacy
                return JsonResponse({'status': 'error', 'message': 'Access Denied.'}, status=403)

            for u in parents:
                linked_children = list(u.students.all())
                children = ", ".join([child.get_name for child in linked_children])
                data.append({
                    'id': u.id,
                    'name': u.get_name,
                    'username': u.user.username,
                    'email': u.user.email,
                    'children': children,
                    'relationship': u.relationship,
                    'children_count': len(linked_children),
                })

        # ==========================================
        # 4. FETCH STAFF DIRECTORY (admin-only, like Parents)
        # ==========================================
        elif user_type == 'staff':
            if not is_admin_user:
                return JsonResponse({'status': 'error', 'message': 'Access Denied.'}, status=403)
            staff = StaffExtra.objects.filter(status=True).select_related('user')
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


@csrf_exempt
def api_delete_user(request):
    if not request.user.is_authenticated:
        return JsonResponse({'status': 'error', 'message': 'Authentication required.'}, status=401)
    if not is_admin(request.user):
        return JsonResponse({'status': 'error', 'message': 'Admin privileges required.'}, status=403)

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

            # Deleting the base User automatically cascades and deletes the Extra profile
            obj.user.delete()

            return JsonResponse({'status': 'success'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


@csrf_exempt
def api_get_pending_users(request, user_type):
    if not request.user.is_authenticated:
        return JsonResponse({'status': 'error', 'message': 'Authentication required.'}, status=401)
    if not is_admin(request.user):
        return JsonResponse({'status': 'error', 'message': 'Admin privileges required.'}, status=403)
    
    data = []
    try:
        if user_type == 'students':
            users = StudentExtra.objects.filter(status=False)
            for u in users:
                data.append({'id': u.id, 'name': u.get_name, 'username': u.user.username, 'email': u.user.email, 'class': str(u.cl) if u.cl else "Not Assigned"})

        elif user_type == 'teachers':
            users = TeacherExtra.objects.filter(status=False)
            for u in users:
                data.append({'id': u.id, 'name': u.get_name, 'username': u.user.username, 'email': u.user.email, 'subjects': u.subjects or "N/A"})

        elif user_type == 'parents':
            users = ParentExtra.objects.filter(status=False)
            for u in users:
                # Get names of all linked children
                children = ", ".join([child.get_name for child in u.students.all()])
                data.append({'id': u.id, 'name': u.get_name, 'username': u.user.username, 'email': u.user.email, 'children': children})

        elif user_type == 'admins':
            # Only admins awaiting a first review. Once "approve" is clicked a
            # verification code is generated and they move out of this list until
            # the applicant enters it themselves (see admin_login_view).
            users = AdminExtra.objects.filter(status=False, verification_code__isnull=True)
            for u in users:
                name = f"{u.user.first_name} {u.user.last_name}".strip()
                data.append({'id': u.id, 'name': name, 'username': u.user.username, 'email': u.user.email})

        elif user_type == 'staff':
            users = StaffExtra.objects.filter(status=False)
            for u in users:
                data.append({'id': u.id, 'name': u.get_name, 'username': u.user.username, 'email': u.user.email, 'job_title': u.job_title or "N/A"})

        return JsonResponse({'status': 'success', 'data': data})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)})


@csrf_exempt
def api_process_approval(request):
    """
    Receives a POST request from React containing the user's ID, type, and the action (approve/reject).
    """

    if not request.user.is_authenticated:
        return JsonResponse({'status': 'error', 'message': 'Authentication required.'}, status=401)
    if not is_admin(request.user):
        return JsonResponse({'status': 'error', 'message': 'Admin privileges required.'}, status=403)

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
                    code = f"{secrets.randbelow(1_000_000):06d}"
                    obj.verification_code = code
                    obj.code_generated_at = timezone.now()
                    obj.save()
                    return JsonResponse({'status': 'success', 'verification_code': code})

                obj.status = True
                obj.save()
            elif action == 'reject':
                # Deleting the core User automatically cascades to the Extra models
                user = obj.user
                user.delete()

            return JsonResponse({'status': 'success'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})

    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})


# Purpose: This fetches the live counts and sums directly from your PostgreSQL database
# and sends them to React as a JSON object to populate your charts and cards.
@api_login_required
@api_admin_required
def dashboard_stats(request):
    # Summing up the fees to calculate total revenue
    revenue_aggr = StudentExtra.objects.filter(status=True).aggregate(Sum('fee', default=0))
    revenue = revenue_aggr['fee__sum'] or 0

    # Getting the logged-in admin's name, or defaulting to "Admin" if testing without session
    admin_name = request.user.first_name if request.user.is_authenticated else "Admin"

    data = {
        "student_count": StudentExtra.objects.filter(status=True).count(),
        "teacher_count": TeacherExtra.objects.filter(status=True).count(),
        "parent_count": ParentExtra.objects.filter(status=True).count(),
        "revenue": revenue,
        "admin_name": admin_name,
        "message": "Real-time statistics live from PostgreSQL."
    }
    return JsonResponse(data)


# Purpose: This calculates how many users are waiting for approval (status=False).
# React will use this to show the red alert badge on the Navbar bell icon.
@api_login_required
@api_admin_required
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
# the Django user session, and redirects the user back to the public HTML home page.
def custom_logout_view(request):
    logout(request)
    return redirect('/')


def admin_login_view(request):
    # If already logged in, send them straight to the router
    if request.user.is_authenticated:
        return redirect('afterlogin')

    if request.method == 'POST':
        # --- Step 2 of admin approval: verifying the code an existing admin
        # generated when they clicked "Approve" and relayed to the applicant. ---
        submitted_code = request.POST.get('verification_code')
        if submitted_code:
            verify_email = request.POST.get('verify_email', '')
            try:
                pending_user = User.objects.get(email=verify_email)
                admin_extra = AdminExtra.objects.get(user=pending_user, status=False)
            except (User.DoesNotExist, AdminExtra.DoesNotExist):
                messages.error(request, 'Verification session expired. Please log in again to restart.')
                return render(request, 'school/admin/adminlogin.html')

            if admin_extra.verification_code and submitted_code.strip() == admin_extra.verification_code:
                admin_extra.status = True
                admin_extra.verification_code = None
                admin_extra.code_generated_at = None
                admin_extra.save()

                my_admin_group, _ = Group.objects.get_or_create(name='ADMIN')
                my_admin_group.user_set.add(pending_user)

                messages.success(request, 'Account verified! You can now log in below.', extra_tags='signup_success')
                return render(request, 'school/admin/adminlogin.html')

            messages.error(request, 'Incorrect verification code. Please try again.')
            return render(request, 'school/admin/adminlogin.html', {
                'needs_verification': True,
                'verification_email': verify_email,
            })

        email = request.POST.get('email')
        password = request.POST.get('password')

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            messages.error(request, 'No account found with this email.')
            return render(request, 'school/admin/adminlogin.html')

        auth_user = authenticate(username=user.username, password=password)

        if auth_user is not None and auth_user.groups.filter(name='ADMIN').exists():
            login(request, auth_user)
            return redirect('afterlogin')
        elif auth_user is not None and AdminExtra.objects.filter(user=auth_user, status=False).exists():
            admin_extra = AdminExtra.objects.get(user=auth_user)
            if admin_extra.verification_code:
                # An admin already clicked "Approve" and generated a code for this
                # applicant — prompt them to enter it instead of just blocking them.
                return render(request, 'school/admin/adminlogin.html', {
                    'needs_verification': True,
                    'verification_email': email,
                })
            messages.error(request, 'Your admin account is pending approval by an existing administrator.')
        else:
            messages.error(request, 'Invalid email or password.')

    # GET request: just render the login page
    return render(request, 'school/admin/adminlogin.html')


def home_view(request):
    recent_events = Event.objects.filter(is_active=True).order_by('-start_time')[:3]
    return render(request, 'school/index.html', {'recent_events': recent_events})



#for showing signup/login button for teacher
def adminclick_view(request):
    if request.user.is_authenticated:
        return HttpResponseRedirect('afterlogin')
    return render(request, 'school/admin/adminclick.html')


#for showing signup/login button for teacher
def teacherclick_view(request):
    if request.user.is_authenticated:
        return HttpResponseRedirect('afterlogin')
    return render(request, 'school/teachers/teacherclick.html')


#for showing signup/login button for student
def studentclick_view(request):
    if request.user.is_authenticated:
        return HttpResponseRedirect('afterlogin')
    return render(request, 'school/students/studentclick.html')


def admin_signup_view(request):
    form=forms.AdminSigupForm()
    if request.method=='POST':
        form=forms.AdminSigupForm(request.POST)
        if form.is_valid():
            # The very first admin bootstraps the system with immediate access, since
            # there's no existing admin around yet to approve them or hand out an
            # invite code. Every admin after that needs a valid invite code and sits
            # pending until an existing admin approves them.
            is_bootstrap = not User.objects.filter(groups__name='ADMIN').exists()
            invite_code = request.POST.get('invite_code', '')

            if not is_bootstrap and invite_code != settings.ADMIN_SIGNUP_INVITE_CODE:
                messages.error(request, 'Invalid invite code. Contact an existing administrator for access.')
                return render(request, 'school/admin/adminsignup.html', {'form': form})

            user=form.save()
            user.set_password(user.password)
            user.save()

            admin_extra, _ = AdminExtra.objects.get_or_create(user=user)
            admin_extra.status = is_bootstrap
            admin_extra.save()

            my_admin_group, _ = Group.objects.get_or_create(name='ADMIN')
            if is_bootstrap:
                my_admin_group.user_set.add(user)
                messages.success(request, 'Registration Successful! As the first administrator, you have immediate access.', extra_tags='signup_success')
            else:
                messages.success(request, 'Registration submitted! An existing administrator must approve your account before you can log in.', extra_tags='signup_success')

            return HttpResponseRedirect('adminlogin')
    return render(request, 'school/admin/adminsignup.html', {'form':form})


# school/views.py

def student_signup_view(request):
    form1 = forms.StudentUserForm()
    form2 = forms.StudentExtraForm()

    if request.method == 'POST':
        form1 = forms.StudentUserForm(request.POST)
        form2 = forms.StudentExtraForm(request.POST, request.FILES)

        if form1.is_valid() and form2.is_valid():
            # 1. Prepare User but don't save yet
            user = form1.save(commit=False)
            user.set_password(user.password)

            # --- AUTOMATIC EMAIL GENERATION ---
            first = form1.cleaned_data['first_name'].lower().replace(' ', '')
            last = form1.cleaned_data['last_name'].lower().replace(' ', '')
            domain = "@student.myfantasia.com"
            base_email = f"{first}.{last}{domain}"

            # Check uniqueness in the database
            email = base_email
            counter = 1
            while User.objects.filter(email=email).exists():
                email = f"{first}.{last}{counter}{domain}"
                counter += 1

            user.email = email
            user.save()  # User is now saved with unique email

            # 2. Prepare Student Extra Details
            f2 = form2.save(commit=False)
            f2.user = user

            f2.roll = form1.cleaned_data.get('username')

            f2.status = False  # Account must be approved by admin

            # We don't need to manually map parent_name/mobile anymore
            # because form2.is_valid() handles that automatically if the names match!
            f2.save()

            # 3. Handle Permissions (Groups)
            my_student_group, _ = Group.objects.get_or_create(name='STUDENT')
            my_student_group.user_set.add(user)

            # 4. Trigger Success Popup (on the login page)
            messages.success(request, 'Registration Successful!', extra_tags='signup_success')

            return redirect('studentlogin')  # Redirect to the login page

        else:
            # CRITICAL: If the form fails, this prints the reason in your VS Code terminal
            print("--- FORM VALIDATION ERROR ---")
            print("User Form Errors:", form1.errors)
            print("Student Extra Errors:", form2.errors)

    # Re-renders the page with the typed data and error messages if any
    return render(request, 'school/students/studentsignup.html', {'form1': form1, 'form2': form2})


def student_login_view(request):
    # If already logged in, send them straight to the router
    if request.user.is_authenticated:
        return redirect('afterlogin')

    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')

        auth_user = authenticate(username=username, password=password)

        if auth_user is not None:
            login(request, auth_user)
            return redirect('afterlogin')
        else:
            messages.error(request, 'Invalid admission number or password.')

    # GET request: just render the login page
    return render(request, 'school/students/studentlogin.html')


def teacher_signup_view(request):
    if request.method == 'POST':
        # 1. Extract Text Data from the HTML Form
        first_name = request.POST.get('first_name')
        last_name = request.POST.get('last_name')
        username = request.POST.get('username')
        email = request.POST.get('email')
        password = request.POST.get('password')

        id_number = request.POST.get('id_number')
        mobile = request.POST.get('mobile')
        address = request.POST.get('address')

        # 2. Extract the Uploaded File
        profile_pic = request.FILES.get('profile_pic')

        subjects_list = request.POST.getlist('subjects')
        subjects_str = ", ".join(subjects_list)

        # 3. Create the built-in Django User Object
        user = User.objects.create_user(
            username=username,
            password=password,
            email=email,
            first_name=first_name,
            last_name=last_name
        )

        # 4. Create the TeacherExtra Profile attached to the new User
        teacher = TeacherExtra.objects.create(
            user=user,
            id_number=id_number,
            mobile=mobile,
            address=address,
            profile_pic=profile_pic,
            status=False,  # Automatically blocks dashboard access until Admin approves
            salary=0,  # Default salary
            subjects=subjects_str
        )

        # 5. Add to the TEACHER group
        my_teacher_group, created = Group.objects.get_or_create(name='TEACHER')
        my_teacher_group.user_set.add(user)

        # 6. Auto-Login and Redirect
        auth_user = authenticate(username=username, password=password)
        if auth_user is not None:
            login(request, auth_user)
            return redirect('afterlogin')

    # --- UPDATED: GET REQUEST ---
    # Fetch all subjects and pass them to the template
    subjects = Subject.objects.all().order_by('name')
    return render(request, 'school/teachers/teachersignup.html', {'subjects': subjects})


def staff_signup_view(request):
    """Self-signup for non-teaching staff (librarian, finance officer, secretary, etc).
    Mirrors teacher_signup_view: plain Django auth, no Firebase. status=False until an
    admin approves — and even once approved, this account has zero permissions until an
    admin assigns it a Role on the Roles & Permissions page (see StaffExtra docstring)."""
    if request.method == 'POST':
        first_name = request.POST.get('first_name')
        last_name = request.POST.get('last_name')
        username = request.POST.get('username')
        email = request.POST.get('email')
        password = request.POST.get('password')

        job_title = request.POST.get('job_title')
        id_number = request.POST.get('id_number')
        mobile = request.POST.get('mobile')
        address = request.POST.get('address')

        user = User.objects.create_user(
            username=username,
            password=password,
            email=email,
            first_name=first_name,
            last_name=last_name
        )

        StaffExtra.objects.create(
            user=user,
            job_title=job_title,
            id_number=id_number,
            mobile=mobile,
            address=address,
            status=False,  # Automatically blocks dashboard access until Admin approves
        )

        staff_group, created = Group.objects.get_or_create(name='STAFF')
        staff_group.user_set.add(user)

        auth_user = authenticate(username=username, password=password)
        if auth_user is not None:
            login(request, auth_user)
            return redirect('afterlogin')

    return render(request, 'school/staff/staffsignup.html')


def staffclick_view(request):
    if request.user.is_authenticated:
        return HttpResponseRedirect('afterlogin')
    return render(request, 'school/staff/staffclick.html')


def staff_login_view(request):
    # If already logged in, send them straight to the router
    if request.user.is_authenticated:
        return redirect('afterlogin')

    if request.method == 'POST':
        email = request.POST.get('email')
        password = request.POST.get('password')

        try:
            user = User.objects.get(email=email)
            auth_user = authenticate(username=user.username, password=password)

            if auth_user is not None:
                login(request, auth_user)
                return redirect('afterlogin')
            else:
                messages.error(request, 'Invalid email or password.')

        except User.DoesNotExist:
            messages.error(request, 'No account found with this email.')

    return render(request, 'school/staff/stafflogin.html')



# for aboutus and contact ussssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss
def aboutus_view(request):
    return render(request,'school/pages/aboutus.html')

def events_view(request):
    """
    Renders the Events & Notices page.
    """
    return render(request, 'school/pages/events.html')

def portal_view(request):
    if request.user.is_authenticated:
        return HttpResponseRedirect('afterlogin')
    return render(request, 'school/portal_selection.html')


def contactus_view(request):
    sub = forms.ContactusForm()
    success_popup = False  # Default: hidden

    if request.method == 'POST':
        sub = forms.ContactusForm(request.POST)
        if sub.is_valid():
            email = sub.cleaned_data['Email']
            name = sub.cleaned_data['Name']
            message = sub.cleaned_data['Message']

            # Routed to the school's own inbox (same account the SMTP config sends
            # from) rather than a separate "receiving" address, since none exists yet.
            # Not fail_silently: a genuine SMTP failure here shouldn't look like success
            # to the visitor, but it also must not 500 the page and lose their message —
            # so we catch it and let them know to try again or use the phone/email above.
            try:
                send_mail(
                    subject=f'{name} || {email}',
                    message=message,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[settings.EMAIL_HOST_USER or settings.DEFAULT_FROM_EMAIL],
                    fail_silently=False,
                )
                success_popup = True
                sub = forms.ContactusForm()  # Reset form to blank
            except Exception:
                messages.error(
                    request,
                    "Sorry, your message could not be sent right now. Please try again "
                    "shortly, or reach us directly using the phone number or email above."
                )

    return render(request, 'school/pages/contactus.html', {'form': sub, 'success_popup': success_popup})


def privacy_policy_view(request):
    return render(request, 'school/pages/privacy.html')


def terms_of_service_view(request):
    return render(request, 'school/pages/terms.html')


def system_status_view(request):
    # Real (if minimal) check rather than a hardcoded "all green" board: confirms the
    # primary database is actually reachable right now instead of just asserting it.
    from django.db import connection
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
        database_operational = True
    except Exception:
        database_operational = False

    services = [
        {'name': 'Web Portal & Login', 'operational': True},
        {'name': 'Database', 'operational': database_operational},
        {'name': 'Parent, Student & Teacher Dashboards', 'operational': True},
        {'name': 'Fee Payments (M-PESA)', 'operational': True},
        {'name': 'Results & Report Cards', 'operational': True},
    ]
    all_operational = all(s['operational'] for s in services)

    return render(request, 'school/pages/status.html', {
        'services': services,
        'all_operational': all_operational,
    })


def parentclick_view(request):
    if request.user.is_authenticated:
        return HttpResponseRedirect('afterlogin')
    return render(request,'school/parents/parentclick.html') # You'll need to create this template


def parent_signup_view(request):
    form1 = forms.ParentUserForm()
    form2 = forms.ParentExtraForm()

    if request.method == 'POST':
        form1 = forms.ParentUserForm(request.POST)
        form2 = forms.ParentExtraForm(request.POST)

        if form1.is_valid() and form2.is_valid():
            # 1. Get the verification data entered by the parent
            child_roll = form2.cleaned_data.get('child_roll')
            child_fname = form2.cleaned_data.get('child_first_name').strip().lower()
            child_lname = form2.cleaned_data.get('child_last_name').strip().lower()

            # 2. Database Verification Logic
            try:
                # Check if a student with this admission number exists in the DB
                student_obj = StudentExtra.objects.get(roll=child_roll)

                # Do the names match? (Case-insensitive check)
                db_fname = student_obj.user.first_name.lower()
                db_lname = student_obj.user.last_name.lower()

                if db_fname != child_fname or db_lname != child_lname:
                    messages.error(request,
                                   f"Verification Failed: The names provided do not match the records for Admission No '{child_roll}'.")
                    return render(request, 'school/parents/parentsignup.html', {'form1': form1, 'form2': form2})

            except StudentExtra.DoesNotExist:
                messages.error(request,
                               f"Verification Failed: No student found in the database with Admission No '{child_roll}'.")
                return render(request, 'school/parents/parentsignup.html', {'form1': form1, 'form2': form2})

            # 3. Save the Parent User (including Email)
            user = form1.save(commit=False)
            # Store the raw password before hashing it so we can log them in automatically later
            raw_password = form1.cleaned_data['password']
            user.set_password(raw_password)
            user.email = form1.cleaned_data['email']
            user.save()

            # 4. Save Parent Extra & Link to the validated Student
            parent_extra = form2.save(commit=False)
            parent_extra.user = user
            parent_extra.status = False  # Account needs admin approval
            parent_extra.save()  # MUST BE SAVED BEFORE ADDING MANY-TO-MANY

            # CRITICAL FIX: Use .add() for ManyToMany relationship
            parent_extra.students.add(student_obj)

            # 5. Add to Parent Group
            my_parent_group, _ = Group.objects.get_or_create(name='PARENT')
            my_parent_group.user_set.add(user)

            # --- THE MAGIC FIX: AUTO-LOGIN & INSTANT REDIRECT ---
            # This authenticates the new user behind the scenes
            user = authenticate(username=user.username, password=raw_password)
            if user is not None:
                login(request, user)  # Logs them in immediately
                return redirect('afterlogin')  # Instantly triggers the Wait for Approval Page!

            # (Fallback just in case)
            return HttpResponseRedirect('parentlogin')

        else:
            # Catch standard form validation errors
            print("--- PARENT FORM VALIDATION FAILED ---")
            print("User Form Errors (Form 1):", form1.errors)
            print("Extra Form Errors (Form 2):", form2.errors)

    return render(request, 'school/parents/parentsignup.html', {'form1': form1, 'form2': form2})


@ensure_csrf_cookie
def afterlogin_view(request):
    # Every login flow (admin/teacher/student/parent) funnels through here before landing
    # in the React SPA on a different port. The SPA's POSTs go through DRF's
    # SessionAuthentication, which requires the csrftoken cookie — but nothing else in the
    # login chain ever actually sets it, so without this decorator the first POST any user
    # makes (e.g. creating a Tier) fails with "CSRF Failed: CSRF cookie not set."
    if request.user.is_superuser:
        return redirect('/admin/')

    if is_admin(request.user):
        return redirect('http://localhost:5173/admin-dashboard')

    elif is_teacher(request.user):
        accountapproval=TeacherExtra.objects.all().filter(user_id=request.user.id,status=True)
        if accountapproval:
            return redirect('http://localhost:5173/teacher-dashboard')
        else:
            return render(request, 'school/teachers/teacher_wait_for_approval.html')

    elif is_student(request.user):
        accountapproval=StudentExtra.objects.all().filter(user_id=request.user.id,status=True)
        if accountapproval:
            return redirect('http://localhost:5173/student-dashboard')
        else:
            return render(request, 'school/students/student_wait_for_approval.html')

    # ADD THIS PART:
    elif is_parent(request.user):
        accountapproval=ParentExtra.objects.all().filter(user_id=request.user.id,status=True)
        if accountapproval:
            return redirect('http://localhost:5173/parent-dashboard')
        else:
            return render(request,'school/parents/parent_wait_for_approval.html')

    elif is_school_staff(request.user):
        accountapproval = StaffExtra.objects.all().filter(user_id=request.user.id, status=True)
        if accountapproval:
            return redirect('http://localhost:5173/staff-dashboard')
        else:
            return render(request, 'school/staff/staff_wait_for_approval.html')

    else:
        return redirect('/')


