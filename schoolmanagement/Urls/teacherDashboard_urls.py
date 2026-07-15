from django.urls import path
from school.views.teacher_dashboard_view import TeacherDashboardOverviewAPI

# This helps us reference these URLs easily in other parts of the app.
app_name = 'teacher_api'

urlpatterns = [
    # The Teacher Dashboard Overview Endpoint
    path('dashboard-overview/', TeacherDashboardOverviewAPI.as_view(), name='api_teacher_dashboard_overview'),
]