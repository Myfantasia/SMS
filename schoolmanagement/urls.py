from django.contrib import admin
from django.urls import path
from django.conf import settings
from django.conf.urls.static import static
from django.contrib.auth.views import LoginView, LogoutView
from django.contrib.auth import views as auth_views

from school import views

urlpatterns = [
    path('api/firebase-login/', views.firebase_login_bridge, name='firebase-login'),
    path('api/firebase-admin-signup/', views.firebase_admin_signup_bridge, name='firebase-admin-signup'),

    path('admin/', admin.site.urls),
    path('', views.home_view, name=''),

    path('adminclick', views.adminclick_view, name='adminclick'),
    path('teacherclick', views.teacherclick_view, name='teacherclick'),
    path('studentclick', views.studentclick_view, name='studentclick'),
    path('parentclick', views.parentclick_view, name='parentclick'),

    path('adminsignup', views.admin_signup_view, name='adminsignup'),
    path('studentsignup', views.student_signup_view, name='studentsignup'),
    path('teachersignup', views.teacher_signup_view, name='teachersignup'),
    path('parentsignup', views.parent_signup_view, name='parentsignup'),

    path('adminlogin', LoginView.as_view(template_name='school/admin/adminlogin.html'), name='adminlogin'),
    path('studentlogin', LoginView.as_view(template_name='school/students/studentlogin.html'), name='studentlogin'),
    path('teacherlogin', LoginView.as_view(template_name='school/teachers/teacherlogin.html'), name='teacherlogin'),
    path('parentlogin', LoginView.as_view(template_name='school/parents/parentlogin.html'), name='parentlogin'),

    path('afterlogin', views.afterlogin_view, name='afterlogin'),

    # logout
    # Purpose: Catches the request from React and triggers our custom logout function
    path('logout', views.custom_logout_view, name='logout'),
    path('logout/', views.custom_logout_view, name='logout_with_slash'),

    path('admin-dashboard', views.admin_dashboard_view, name='admin-dashboard'),

    path('admin-teacher', views.admin_teacher_view, name='admin-teacher'),
    path('admin-add-teacher', views.admin_add_teacher_view, name='admin-add-teacher'),
    path('admin-view-teacher', views.admin_view_teacher_view, name='admin-view-teacher'),

    # Teacher approval
    path('admin-approve-teacher', views.admin_approve_teacher_view, name='admin-approve-teacher'),
    path('approve-teacher/<int:pk>', views.approve_teacher_view, name='approve-teacher'),
    path('reject-teacher/<int:pk>', views.reject_teacher_view, name='reject-teacher'),
    path('delete-teacher-from-school/<int:pk>', views.delete_teacher_from_school_view, name='delete-teacher-from-school'),
    path('update-teacher/<int:pk>', views.update_teacher_view, name='update-teacher'),
    path('admin-view-teacher-salary', views.admin_view_teacher_salary_view, name='admin-view-teacher-salary'),

    path('admin-student', views.admin_student_view, name='admin-student'),
    path('admin-add-student', views.admin_add_student_view, name='admin-add-student'),
    path('admin-view-student', views.admin_view_student_view, name='admin-view-student'),

    path('delete-student-from-school/<int:pk>', views.delete_student_from_school_view, name='delete-student-from-school'),
    path('delete-student/<int:pk>', views.delete_student_view, name='delete-student'),
    path('update-student/<int:pk>', views.update_student_view, name='update-student'),

    # Student approval
    path('admin-approve-student', views.admin_approve_student_view, name='admin-approve-student'),
    path('approve-student/<int:pk>', views.approve_student_view, name='approve-student'),
    path('reject-student/<int:pk>', views.reject_student_view, name='reject-student'),
    path('admin-view-student-fee', views.admin_view_student_fee_view, name='admin-view-student-fee'),

    path('admin-attendance', views.admin_attendance_view, name='admin-attendance'),
    path('admin-take-attendance/<str:cl>', views.admin_take_attendance_view, name='admin-take-attendance'),
    path('admin-view-attendance/<str:cl>', views.admin_view_attendance_view, name='admin-view-attendance'),

    path('admin-fee', views.admin_fee_view, name='admin-fee'),
    path('admin-view-fee/<str:cl>', views.admin_view_fee_view, name='admin-view-fee'),
    path('admin-notice', views.admin_notice_view, name='admin-notice'),

    path('teacher-dashboard', views.teacher_dashboard_view, name='teacher-dashboard'),
    path('teacher-attendance', views.teacher_attendance_view, name='teacher-attendance'),
    path('teacher-take-attendance/<str:cl>', views.teacher_take_attendance_view, name='teacher-take-attendance'),
    path('teacher-view-attendance/<str:cl>', views.teacher_view_attendance_view, name='teacher-view-attendance'),
    path('teacher-notice', views.teacher_notice_view, name='teacher-notice'),

    path('student-dashboard', views.student_dashboard_view, name='student-dashboard'),
    path('student-attendance', views.student_attendance_view, name='student-attendance'),

    path('portal', views.portal_view, name='portal'),
    path('aboutus', views.aboutus_view),
    path('contactus', views.contactus_view),
    path('events/', views.events_view, name='events'),
    path('parent-dashboard', views.parent_dashboard_view, name='parent-dashboard'),

    # Admin Parent Management
    path('admin-parent-view', views.admin_parent_view, name='admin-parent-view'),
    path('admin-approve-parent', views.admin_approve_parent_view, name='admin-approve-parent'),
    path('approve-parent/<int:pk>', views.approve_parent_view, name='approve-parent'),
    path('delete-parent/<int:pk>', views.reject_parent_view, name='reject-parent'),

    # Password Reset Paths
    path('password-reset/', auth_views.PasswordResetView.as_view(template_name='school/password_reset/password_reset.html'), name='password_reset'),
    path('password-reset/done/', auth_views.PasswordResetDoneView.as_view(template_name='school/password_reset/password_reset_done.html'), name='password_reset_done'),
    path('password-reset-confirm/<uidb64>/<token>/', auth_views.PasswordResetConfirmView.as_view(template_name='school/password_reset/password_reset_confirm.html'), name='password_reset_confirm'),
    path('password-reset-complete/', auth_views.PasswordResetCompleteView.as_view(template_name='school/password_reset/password_reset_complete.html'), name='password_reset_complete'),


    # --- NEW: API ENDPOINTS FOR REACT FRONTEND ---
    path('api/dashboard-stats/', views.dashboard_stats, name='dashboard_stats'),
    path('api/pending-approvals/', views.pending_approvals_api, name='pending_approvals_api'),

# API endpoints for React Approvals Integration
    path('api/pending-users/<str:user_type>/', views.api_get_pending_users, name='api_pending_users'),
    path('api/process-approval/', views.api_process_approval, name='api_process_approval'),

# API endpoints for React Directories
    path('api/approved-users/<str:user_type>/', views.api_get_approved_users, name='api_approved_users'),
    path('api/delete-user/', views.api_delete_user, name='api_delete_user'),

# API endpoint for viewing a single user profile
    path('api/user/<str:user_type>/<int:user_id>/', views.api_get_single_user, name='api_get_single_user'),

# API endpoint for editing a user profile
    path('api/user/<str:user_type>/<int:user_id>/edit/', views.api_edit_single_user, name='api_edit_single_user'),

    path('api/my-profile/', views.api_my_profile, name='api_my_profile'),

    path('api/search/', views.api_global_search, name='api_global_search'),

    path('api/academic-hub/', views.api_academic_hub_data, name='api_academic_hub'),

    path('api/academic-hub/add-subject/', views.api_add_subject, name='api_add_subject'),
    path('api/academic-hub/add-grade/', views.api_add_grade_with_streams, name='api_add_grade'),

# NEW ROUTES FOR SPECIFIC OPERATIONS
    path('api/manage-classes/', views.api_manage_classes, name='api_manage_classes'),
    path('api/manage-subjects/', views.api_manage_subjects, name='api_manage_subjects'),

    # ... inside your urlpatterns list ...
    path('api/academic-hub/edit-stream/<int:pk>/', views.api_edit_stream, name='api_edit_stream'),
    path('api/academic-hub/delete-stream/<int:pk>/', views.api_delete_stream, name='api_delete_stream'),

    path('api/academic-hub/edit-subject/<int:pk>/', views.api_edit_subject, name='api_edit_subject'),
    path('api/academic-hub/delete-subject/<int:pk>/', views.api_delete_subject, name='api_delete_subject'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)