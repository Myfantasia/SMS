from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse
from school.views import views, chat_views
from school.views import views_timetable
from school.views.assignment_teacher_views import TeacherAssignmentAPIView, TeacherGradingAPIView, \
    SubmissionsRosterAPIView, BulkReleaseGradesAPIView, GradeStudentAPIView, \
    TeacherAssignmentDetailAPIView, TeacherSubmissionDetailAPIView, TeacherGradingSaveAPIView, \
    AssignmentClassStreamStudentsAPIView
from school.views.assignment_student_views import StudentAssignmentBoardAPIView, QuizStartAPIView, \
    SubmitAssignmentAPIView, StudentSubmissionReviewAPIView, StudentAssignmentDetailAPIView
from school.views.assignment_parent_views import ParentMonitoringAPIView, ParentSubmissionReviewAPIView

from school.views.exams_views import RapidMarksEntryView, BroadsheetGeneratorView, ExamSelectionDataView, \
    ExamSetupDataView, \
    AddExamTermView, AddExamEventView, GradingRulesView, ActivateTermView, UpdateTermView, DeleteTermView, \
    UpdateExamEventView, DeleteExamEventView, StudentReportCardView, ClassReportCardsAPIView, \
    PublishExamEventView, RevertExamEventView, MissingMarksVerificationView, SaveReportSummaryView

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from school.views.attendance_views import SubmitBatchAttendanceView, AttendanceRosterView, \
    AdminAttendanceOverviewView, EventViewSet, NoticeViewSet, NotificationViewSet

from school.views.results_views import GenerateTermResultsAPIView, BulkGenerateTermResultsAPIView, \
    ClassPerformanceSummaryAPIView, StudentReportCardAPIView, ResultsFilterOptionsAPIView

from school.views.teacherAllocation_view import AllocationMatrixAPIView, RolloverAllocationsAPIView, \
    AutoAllocateDraftAPIView, BulkAutoAllocateAPIView, ClearAllocationsAPIView, api_manage_splitting_rules, \
    api_execute_allocation_splits, GlobalAllocationPolicyAPIView, api_get_stream_teachers, api_get_teacher_allocations, \
    UnpublishAllocationAPIView

from school.views.chat_views import ClassParentsAPI
from school.views.password_reset_views import api_admin_reset_user_password
from school.views import public_api_views as public_api
from apps.content.views import AlumniReviewAdminViewSet, BlogPostAdminViewSet
from school.views import class_views
from school.views.teacher_dashboard_view import TeacherPersonalTimetableAPIView, \
    api_manage_teacher_availability
from school.views import subject_views
from school.views import promotion_views
from school.views import admin_invite_views
from school.views import curriculum_view
from school.views.leave_views import TeacherLeaveViewSet
from school.views.student_dashboard_view import StudentDashboardOverviewAPI
from school.views.parent_dashboard_view import ParentDashboardOverviewAPI
from school.views.student_tasks_view import StudentTaskViewSet
from school.views.rbac_views import RoleViewSet, PermissionViewSet, UserRoleAssignmentAPIView
from school.views.curriculum_view import (
    CurriculumViewSet, PathwayViewSet, CurriculumPresetViewSet, PresetCombinationViewSet,
    SubjectCurriculumProfileViewSet, TierViewSet, TrackViewSet,
)
from school.views.jobs_views import BackgroundJobStatusAPIView
from school.views import trash_views

router = DefaultRouter()
router.register(r'admin/blog-posts', BlogPostAdminViewSet, basename='admin-blogpost')
router.register(r'admin/alumni-reviews', AlumniReviewAdminViewSet, basename='admin-alumnireview')
router.register(r'events', EventViewSet, basename='event')
router.register(r'notices', NoticeViewSet, basename='notice')
router.register(r'notifications', NotificationViewSet, basename='notification')
router.register(r'leaves', TeacherLeaveViewSet, basename='leave')
router.register(r'rbac/roles', RoleViewSet, basename='rbac-role')
router.register(r'rbac/permissions', PermissionViewSet, basename='rbac-permission')
router.register(r'curriculum/curricula', CurriculumViewSet, basename='curriculum')
router.register(r'curriculum/pathways', PathwayViewSet, basename='curriculum-pathway')
router.register(r'curriculum/tracks', TrackViewSet, basename='curriculum-track')
router.register(r'curriculum/tiers', TierViewSet, basename='curriculum-tier')
router.register(r'curriculum/presets', CurriculumPresetViewSet, basename='curriculum-preset')
router.register(r'curriculum/preset-combinations', PresetCombinationViewSet, basename='curriculum-preset-combination')
router.register(r'curriculum/subject-profiles', SubjectCurriculumProfileViewSet, basename='curriculum-subject-profile')

student_router = DefaultRouter()
student_router.register(r'tasks', StudentTaskViewSet, basename='student-task')

urlpatterns = [
    #Admin Dashboard
    path('api/core/', include(router.urls)),
    path('api/core/rbac/assignments/', UserRoleAssignmentAPIView.as_view(), name='rbac-user-assignments'),
    path('api/trash/<str:entity_type>/', trash_views.api_list_trash, name='api_list_trash'),
    path('api/trash/<str:entity_type>/<int:pk>/restore/', trash_views.api_restore_trash_item, name='api_restore_trash_item'),
    path('api/trash/<str:entity_type>/<int:pk>/purge/', trash_views.api_purge_trash_item, name='api_purge_trash_item'),

    path('api/exams/rapid-entry/', RapidMarksEntryView.as_view(), name='rapid-marks-entry'),
    path('api/exams/broadsheet/', BroadsheetGeneratorView.as_view(), name='generate-broadsheet'),
    path('api/exams/selection-data/', ExamSelectionDataView.as_view(), name='exam-selection-data'),

    # Setup Dashboard
    path('api/exams/setup-data/', ExamSetupDataView.as_view(), name='exam-setup-data'),
    path('api/exams/terms/add/', AddExamTermView.as_view(), name='add-exam-term'),
    path('api/exams/events/add/', AddExamEventView.as_view(), name='add-exam-event'),
    path('api/exams/terms/activate/<int:pk>/', ActivateTermView.as_view(), name='activate-term'),

    # Grading Rules Engine
    path('api/exams/grading-rules/', GradingRulesView.as_view(), name='grading-rules'),

    path('attendance/submit/', SubmitBatchAttendanceView.as_view(), name='submit_batch_attendance'),
    path('attendance/roster/<int:class_stream_id>/<str:date>/', AttendanceRosterView.as_view(), name='attendance_roster'),
    path('attendance/overview/', AdminAttendanceOverviewView.as_view(), name='attendance_overview'),

    path('admin/', admin.site.urls),

    path('api/parentsignup/search-students/', views.api_search_students_for_parent_signup, name='api_search_students_for_parent_signup'),

    # logout
    # Purpose: Catches the request from React and triggers our custom logout function
    path('logout', views.custom_logout_view, name='logout'),
    path('logout/', views.custom_logout_view, name='logout_with_slash'),

    # --- Public pages JSON API (React frontend, frontend/src/public/) ---
    # The sole backend surface for the public (pre-login) pages -- the old HTML-
    # rendering views/templates/static assets they replaced were removed once every
    # flow was verified end-to-end (see /home/jordan/.claude/plans/scalable-kindling-lampson.md).
    path('api/public/csrf/', public_api.api_csrf, name='api_public_csrf'),
    path('api/public/home/', public_api.api_home, name='api_public_home'),
    path('api/public/afterlogin/', public_api.api_afterlogin, name='api_public_afterlogin'),
    path('api/public/contact/', public_api.api_contact, name='api_public_contact'),
    path('api/public/system-status/', public_api.api_system_status, name='api_public_system_status'),
    path('api/public/blog/', public_api.api_public_blog_list, name='api_public_blog_list'),
    path('api/public/blog/<slug:slug>/', public_api.api_public_blog_detail, name='api_public_blog_detail'),
    path('api/public/alumni-reviews/', public_api.api_public_alumni_reviews, name='api_public_alumni_reviews'),

    path('api/public/signup/admin/', public_api.api_signup_admin, name='api_public_signup_admin'),
    path('api/public/signup/student/', public_api.api_signup_student, name='api_public_signup_student'),
    path('api/public/signup/student/class-streams/', public_api.api_student_signup_class_streams, name='api_public_student_signup_class_streams'),
    path('api/public/signup/teacher/', public_api.api_signup_teacher, name='api_public_signup_teacher'),
    path('api/public/signup/teacher/subjects/', public_api.api_teacher_signup_subjects, name='api_public_teacher_signup_subjects'),
    path('api/public/signup/staff/', public_api.api_signup_staff, name='api_public_signup_staff'),
    path('api/public/signup/staff/roles/', public_api.api_staff_signup_roles, name='api_public_staff_signup_roles'),
    path('api/public/signup/parent/', public_api.api_signup_parent, name='api_public_signup_parent'),

    path('api/public/login/admin/', public_api.api_login_admin, name='api_public_login_admin'),
    path('api/public/login/student/', public_api.api_login_student, name='api_public_login_student'),
    path('api/public/login/teacher/', public_api.api_login_teacher, name='api_public_login_teacher'),
    path('api/public/login/parent/', public_api.api_login_parent, name='api_public_login_parent'),
    path('api/public/login/staff/', public_api.api_login_staff, name='api_public_login_staff'),

    path('api/public/password-reset/request/', public_api.api_password_reset_request, name='api_public_password_reset_request'),
    path('api/public/password-reset/confirm/<uidb64>/<token>/', public_api.api_password_reset_confirm, name='api_public_password_reset_confirm'),


    # --- NEW: API ENDPOINTS FOR REACT FRONTEND ---
    path('api/dashboard-stats/', views.dashboard_stats, name='dashboard_stats'),
    path('api/pending-approvals/', views.pending_approvals_api, name='pending_approvals_api'),
    path('api/student/dashboard-overview/', StudentDashboardOverviewAPI.as_view(), name='api_student_dashboard_overview'),
    path('api/parent/dashboard-overview/', ParentDashboardOverviewAPI.as_view(), name='api_parent_dashboard_overview'),
    path('', include('apps.finance.urls')),
    path('api/student/', include(student_router.urls)),

# API endpoints for React Approvals Integration
    path('api/pending-users/<str:user_type>/', views.api_get_pending_users, name='api_pending_users'),
    path('api/process-approval/', views.api_process_approval, name='api_process_approval'),
    path('api/admin-create-user/', views.api_admin_create_user, name='api_admin_create_user'),

# API endpoints for Admin Invite Codes & Verification (React "Invite Codes & Verification" tab)
    path('api/admin-invites/', admin_invite_views.api_list_admin_invites, name='api_list_admin_invites'),
    path('api/admin-invites/generate/', admin_invite_views.api_generate_admin_invite, name='api_generate_admin_invite'),
    path('api/admin-invites/<int:pk>/revoke/', admin_invite_views.api_revoke_admin_invite, name='api_revoke_admin_invite'),
    path('api/admin-verification-status/', admin_invite_views.api_admin_verification_status, name='api_admin_verification_status'),
    path('api/admin-verification-status/<int:admin_extra_id>/regenerate/', admin_invite_views.api_regenerate_admin_code, name='api_regenerate_admin_code'),

# API endpoints for React Directories
    path('api/approved-users/<str:user_type>/', views.api_get_approved_users, name='api_approved_users'),
    path('api/delete-user/', views.api_delete_user, name='api_delete_user'),

# API endpoint for viewing a single user profile
    path('api/user/<str:user_type>/<int:user_id>/', views.api_get_single_user, name='api_get_single_user'),

# API endpoint for editing a user profile
    path('api/user/<str:user_type>/<int:user_id>/edit/', views.api_edit_single_user, name='api_edit_single_user'),

# API endpoint for an admin to reset another user's password (students, teachers,
# parents, staff — never another admin)
    path('api/admin/reset-user-password/', api_admin_reset_user_password, name='api_admin_reset_user_password'),

    path('api/my-profile/', views.api_my_profile, name='api_my_profile'),

    path('api/search/', views.api_global_search, name='api_global_search'),

    # ==========================================
    # ACADEMIC HUB, CLASSES & SUBJECTS ENDPOINTS
    # ==========================================
    path('api/academic-hub/', class_views.api_academic_hub_data, name='api_academic_hub'),

    # Classes & Grades
    path('api/manage-classes/', class_views.api_manage_classes, name='api_manage_classes'),
    path('api/academic-hub/add-grade/', class_views.api_add_grade_with_streams, name='api_add_grade'),
    path('api/academic-hub/edit-grade/<int:pk>/', class_views.api_edit_grade, name='api_edit_grade'),
    path('api/add-single-stream/', class_views.api_add_single_stream, name='api_add_single_stream'),
    path('api/academic-hub/edit-stream/<int:pk>/', class_views.api_edit_stream, name='api_edit_stream'),
    path('api/academic-hub/delete-stream/<int:pk>/', class_views.api_delete_stream, name='api_delete_stream'),

    path('api/enrollments/class/<int:stream_id>/', class_views.api_class_enrollments, name='api_class_enrollments'),
    path('api/enrollments/bulk-transfer/', class_views.api_bulk_transfer, name='api_bulk_transfer'),
    path('api/subjects/curriculum-presets/', curriculum_view.api_curriculum_presets, name='api_curriculum_presets'),
    path('api/enrollments/manage-enrollment/<int:student_id>/', class_views.ManageEnrollmentAPIView.as_view(), name='api_manage_enrollment'),

    # Subjects
    path('api/departments/', subject_views.api_manage_departments, name='api_manage_departments'),
    path('api/departments/<int:pk>/', subject_views.api_department_detail, name='api_department_detail'),
    path('api/manage-subjects/', subject_views.api_manage_subjects, name='api_manage_subjects'),
    path('api/manage-subjects/<int:pk>/students/', subject_views.api_subject_students, name='api_subject_students'),
    path('api/academic-hub/add-subject/', subject_views.api_add_subject, name='api_add_subject'),
    path('api/academic-hub/edit-subject/<int:pk>/', subject_views.api_edit_subject, name='api_edit_subject'),
    path('api/academic-hub/delete-subject/<int:pk>/', subject_views.api_delete_subject, name='api_delete_subject'),

    path('api/subjects/catalog/<int:grade_id>/', subject_views.api_subject_catalog, name='subject_catalog'),
    path('api/subjects/student-profile/<int:student_id>/', subject_views.api_student_subject_profile, name='student_subject_profile'),
    path('api/subjects/manage-enrollment/<int:student_id>/', subject_views.api_manage_subject_enrollment, name='manage_subject_enrollment'),
    path('api/subjects/rules/<int:grade_id>/', subject_views.api_manage_selection_rules, name='manage_selection_rules'),
    path('api/academic-years/', subject_views.api_get_academic_years, name='academic_years'),
    path('api/subjects/stream-approvals/<int:stream_id>/', subject_views.api_class_pending_subjects, name='stream_approvals'),
    path('api/subjects/bulk-approve/<int:stream_id>/', subject_views.api_bulk_approve_subjects, name='bulk_approve_subjects'),
    path('api/subjects/category-limits/<int:grade_id>/', subject_views.api_manage_category_limits, name='manage_category_limits'),
    path('api/subjects/exclusion-rules/<int:grade_id>/', subject_views.api_manage_exclusion_rules, name='manage_exclusion_rules'),

    # Student self-service: the consolidated "My Subjects" page's two data sources — the
    # fixed compulsory half, and the choosable elective half (which feeds the existing admin
    # Batch Approvals queue: ManageCurriculum.tsx / api_bulk_approve_subjects).
    path('api/subjects/my-subjects/', subject_views.api_student_subjects_overview, name='student_subjects_overview'),
    path('api/subjects/my-electives/', subject_views.api_student_elective_options, name='student_elective_options'),
    path('api/subjects/my-electives/request/', subject_views.api_student_elective_request, name='student_elective_request'),

    # Student self-service Pathway choice + the admin/class-teacher approval queue for it —
    # same request/approve shape as the electives pair above, but for a student's single SSS
    # Pathway (see StudentPathwaySelection) instead of many subjects.
    path('api/subjects/my-pathway/', subject_views.api_student_pathway_options, name='student_pathway_options'),
    path('api/subjects/my-pathway/request/', subject_views.api_student_pathway_request, name='student_pathway_request'),
    path('api/subjects/pathway-requests/', subject_views.api_pathway_requests, name='pathway_requests'),
    path('api/subjects/pathway-requests/<int:selection_id>/decide/', subject_views.api_decide_pathway_request, name='decide_pathway_request'),

    # Admin-facing (Assign Subjects page): direct pathway assignment for Senior Secondary,
    # and unlock endpoints for both the compulsory-subjects and pathway-selection flows —
    # see tier_requires_pathway_choice() in apps/academics/models.py.
    path('api/subjects/pathway-options/<int:student_id>/', subject_views.api_admin_pathway_options, name='admin_pathway_options'),
    path('api/subjects/pathway-options/<int:student_id>/assign/', subject_views.api_admin_assign_pathway, name='admin_assign_pathway'),
    path('api/subjects/pathway-options/<int:student_id>/unlock/', subject_views.api_unlock_pathway_selection, name='unlock_pathway_selection'),
    path('api/subjects/manage-enrollment/<int:student_id>/unlock/', subject_views.api_unlock_subject_enrollment, name='unlock_subject_enrollment'),

# ==========================================
    # TIMETABLE ENGINE API ROUTES
    # ==========================================
    path('api/timetable/grid/', views_timetable.api_get_global_grid, name='api_get_global_grid'),
    path('api/timetable/buckets/<int:stream_id>/<int:timetable_id>/', views_timetable.api_get_dynamic_buckets, name='api_get_dynamic_buckets'),

    path('api/timetable/save-lesson/', views_timetable.api_save_lesson, name='api_save_lesson'),
    path('api/timetable/remove-lesson/<int:allocation_id>/', views_timetable.api_remove_lesson, name='api_remove_lesson'),
    path('api/timetable/toggle-lesson-lock/<int:allocation_id>/', views_timetable.api_toggle_lesson_lock, name='api_toggle_lesson_lock'),
    path('api/timetable/class-lessons/<int:stream_id>/<int:timetable_id>/', views_timetable.api_get_class_lessons),
    path('api/timetable/master/<int:timetable_id>/', views_timetable.api_get_master_timetable, name='api_get_master_timetable'),

    path('api/timetable/manage-containers/', views_timetable.api_manage_timetables, name='api_manage_timetables'),
    path('api/timetable/manage-slots/', views_timetable.api_manage_timeslots, name='api_manage_timeslots'),
    path('api/timetable/manage-quotas/', views_timetable.api_manage_quotas, name='api_manage_quotas'),
    path('api/timetable/teachers-by-subject/<str:subject_id>/', views_timetable.api_get_teachers_by_subject, name='teachers_by_subject'),
# --- NEW: AUTO GENERATE ROUTE ---
    path('api/timetable/auto-generate/<int:timetable_id>/', views_timetable.api_auto_generate_timetable, name='api_auto_generate_timetable'),
    path('api/timetable/auto-generate-quotas/', views_timetable.api_auto_generate_quotas, name='api_auto_generate_quotas'),
# --- NEW: RESET ROUTES ---
    path('api/timetable/clear-grid/<int:timetable_id>/', views_timetable.api_clear_grid, name='api_clear_grid'),
    path('api/timetable/clear-quotas/', views_timetable.api_clear_quotas, name='api_clear_quotas'),
    path('api/timetable/manage-subject-blocks/', views_timetable.api_manage_subject_blocks, name='api_manage_subject_blocks'),
    path('api/teacher/my-timetable/', TeacherPersonalTimetableAPIView.as_view(), name='api_teacher_my_timetable'),
    path('api/timetable/manage-policies/',  views_timetable.api_manage_policies, name='api_manage_policies'),
    path('api/timetable/teacher-availability/<int:teacher_id>/', api_manage_teacher_availability, name='api_manage_teacher_availability'),
    path('api/timetable/update-status/<int:timetable_id>/', views_timetable.api_update_timetable_status, name='api_update_timetable_status'),
    path('api/timetable/available-substitutes/<int:allocation_id>/<str:target_date>/', views_timetable.api_get_available_substitutes, name='api_get_available_substitutes'),
    path('api/timetable/assign-daily-cover/', views_timetable.api_assign_daily_cover, name='api_assign_daily_cover'),
    path('api/timetable/audit-logs/', views_timetable.api_get_audit_logs),

    #EXAMS
    # Term Edit & Delete routes
    path('api/exams/terms/<int:pk>/update/', UpdateTermView.as_view(), name='update-term'),
    path('api/exams/terms/<int:pk>/delete/', DeleteTermView.as_view(), name='delete-term'),
    path('api/exams/events/<int:pk>/publish/', PublishExamEventView.as_view(), name='publish-exam'),
    path('api/exams/events/<int:pk>/revert/', RevertExamEventView.as_view(), name='revert-exam'),
    # Exam Edit & Delete routes
    path('api/exams/events/<int:pk>/update/', UpdateExamEventView.as_view(), name='update-exam'),
    path('api/exams/events/<int:pk>/delete/', DeleteExamEventView.as_view(), name='delete-exam'),
    path('api/exams/report-card/<int:exam_id>/<int:student_id>/', StudentReportCardView.as_view(), name='student-report-card'),
    path('api/exams/report-card/class/<int:exam_id>/<int:class_id>/', ClassReportCardsAPIView.as_view(), name='class-report-cards'),
    path('api/exams/verify-marks/', MissingMarksVerificationView.as_view(), name='missing-marks-verification'),
    path('api/exams/report-card/save-summary/', SaveReportSummaryView.as_view()),

    #Results
    path('api/jobs/<uuid:job_id>/', BackgroundJobStatusAPIView.as_view(), name='background_job_status'),

    path('api/results/generate/', GenerateTermResultsAPIView.as_view(), name='generate_term_results'),
    path('api/results/bulk-generate/', BulkGenerateTermResultsAPIView.as_view(), name='bulk_generate_term_results'),
    path('api/results/class-summary/', ClassPerformanceSummaryAPIView.as_view(), name='class_summary'),
    path('api/results/report-card/', StudentReportCardAPIView.as_view(), name='student_report_card'),
    path('api/results/filter-options/', ResultsFilterOptionsAPIView.as_view(), name='result_filter_options'),

    path('api/promotion/finalize-term/<int:term_id>/', promotion_views.FinalizeTermAPIView.as_view(), name='finalize_term'),
    path('api/promotion/national-exam/<int:student_id>/', promotion_views.RecordNationalExamAPIView.as_view(), name='record_national_exam'),
    path('api/promotion/promote-students/', promotion_views.PromoteStudentsAPIView.as_view(), name='promote_students'),
    path('api/promotion/promote-student/<int:student_id>/', promotion_views.PromoteSingleStudentAPIView.as_view(), name='promote_single_student'),
    path('api/promotion/readiness/', promotion_views.PromotionReadinessAPIView.as_view(), name='promotion_readiness'),
    path('', include('apps.analytics.urls')),

    #Teacher allocations
    path('api/allocations/matrix/', AllocationMatrixAPIView.as_view(), name='allocation_matrix'),
    path('api/allocations/rollover/', RolloverAllocationsAPIView.as_view(), name='allocation_rollover'),
    path('api/allocations/auto-draft/', AutoAllocateDraftAPIView.as_view(), name='auto_allocate_draft'),
    path('api/allocations/bulk-auto-allocate/', BulkAutoAllocateAPIView.as_view(), name='bulk_auto_allocate'),
    path('api/allocations/clear/', ClearAllocationsAPIView.as_view(), name='clear_allocations'),
    path('api/allocations/unpublish/', UnpublishAllocationAPIView.as_view(), name='unpublish_allocation'),
    path('api/allocations/splitting-rules/<int:grade_id>/', api_manage_splitting_rules, name='api_manage_splitting_rules'),
    path('api/allocations/execute-splits/<int:grade_id>/', api_execute_allocation_splits, name='api_execute_allocation_splits'),
    path('api/allocations/global-policy/', GlobalAllocationPolicyAPIView.as_view(), name='global-policy'),
    path('api/academic-hub/stream-teachers/<int:stream_id>/', api_get_stream_teachers, name='api_get_stream_teachers'),
    path('api/teacher-allocations/<int:teacher_id>/', api_get_teacher_allocations, name='api-teacher-allocations'),


# ==========================================
    # CHAT & MESSAGING API ROUTES
    # ==========================================
    path('api/chat/search/', chat_views.UserSearchAPI.as_view(), name='chat-user-search'),
    path('api/chat/direct/', chat_views.GetOrCreateDirectThreadAPI.as_view(), name='chat-direct-create'),
    path('api/chat/inbox/', chat_views.UserInboxAPI.as_view(), name='chat-user-inbox'),
    path('api/chat/read/<uuid:thread_id>/', chat_views.MarkThreadReadAPI.as_view(), name='chat-mark-read'),
    path('api/chat/admin/group/', chat_views.CreateAdminGroupThreadAPI.as_view(), name='chat-admin-group'),
    path('api/chat/admin/audit/<uuid:thread_id>/', chat_views.AdminAuditLogAPI.as_view(), name='chat-admin-audit'),
    path('api/chat/messages/<uuid:thread_id>/', chat_views.ThreadMessageHistoryAPI.as_view(), name='chat-message-history'),
    path('api/chat/attachments/<uuid:thread_id>/', chat_views.ChatAttachmentUploadAPI.as_view(), name='chat-attachment-upload'),
    path('api/chat/class-parents/<int:stream_id>/', ClassParentsAPI.as_view(), name='chat-class-parents'),
    path('api/chat/leave/<uuid:thread_id>/', chat_views.LeaveConversationAPI.as_view(), name='chat-leave'),
    path('api/chat/participants/<uuid:thread_id>/', chat_views.ThreadParticipantsAPI.as_view(), name='chat-participants'),


# ==========================================
    # ASSIGNMENT & ASSESSMENT ENGINE API ROUTES
    # ==========================================
    path('api/assignments/teacher/', TeacherAssignmentAPIView.as_view(), name='teacher_assignments'),
    path('api/assignments/teacher/grading/', TeacherGradingAPIView.as_view(), name='teacher_grading'),
    path('api/assignments/student/board/', StudentAssignmentBoardAPIView.as_view(), name='student_board'),
    path('api/assignments/student/<int:assignment_id>/', StudentAssignmentDetailAPIView.as_view(), name='student_assignment_detail'),
    path('api/assignments/student/quiz/start/', QuizStartAPIView.as_view(), name='quiz_start'),
    path('api/assignments/student/submit/', SubmitAssignmentAPIView.as_view(), name='student_submit'),
    path('api/assignments/student/review/', StudentSubmissionReviewAPIView.as_view(), name='student_submission_review'),
    path('api/assignments/parent/monitoring/', ParentMonitoringAPIView.as_view(), name='parent_monitoring'),
    path('api/assignments/parent/review/', ParentSubmissionReviewAPIView.as_view(), name='parent_submission_review'),
    path('api/assignments/<int:assignment_id>/submissions-roster/', SubmissionsRosterAPIView.as_view(), name='api-submissions-roster'),
    path('api/assignments/<int:assignment_id>/bulk-release/', BulkReleaseGradesAPIView.as_view(), name='api-bulk-release'),
    path('api/assignments/<int:assignment_id>/grade-student/', GradeStudentAPIView.as_view(), name='api-grade-student'),
    path('api/assignments/teacher/<int:pk>/', TeacherAssignmentDetailAPIView.as_view(), name='teacher_assignment_detail'),
    path('api/assignments/<int:assignment_id>/grade/<int:student_id>/', TeacherSubmissionDetailAPIView.as_view(),
         name='teacher_submission_detail'),
    path('api/assignments/grade/save/<int:submission_id>/', TeacherGradingSaveAPIView.as_view(),
         name='teacher_grading_save'),
    path('api/assignments/class-stream/<int:class_stream_id>/students/', AssignmentClassStreamStudentsAPIView.as_view(),
         name='assignment_class_stream_students'),


    path('.well-known/appspecific/com.chrome.devtools.json',lambda r: JsonResponse({})),
    path('api/teacher/', include('schoolmanagement.Urls.teacherDashboard_urls', namespace='teacher_api')),
]
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)