"""URL routes for the `analytics` app.

Track B step 1: the four analytics-domain views physically relocated here
from school/views/results_views.py. Paths kept byte-for-byte identical to
the originals (verified against the frontend's actual call sites in
ResultAnalytics.tsx / StudentAnalyticsModal.tsx / ImprovementModal.tsx /
SubjectModal.tsx) so the frontend needs zero changes.
"""
from django.urls import path

from apps.analytics.views import (
    SchoolAnalyticsAPIView,
    StudentPerformanceAnalyticsAPIView,
    TermImprovementAnalyticsAPIView,
    SubjectMatrixAnalyticsAPIView,
)

urlpatterns = [
    path('api/results/school-analytics/', SchoolAnalyticsAPIView.as_view(), name='school_analytics'),
    path('api/results/student-analytics/', StudentPerformanceAnalyticsAPIView.as_view(), name='student_analytics'),
    path('api/results/improvement-analytics/', TermImprovementAnalyticsAPIView.as_view(), name='improvement-analytics'),
    path('api/results/subject-matrix-analytics/', SubjectMatrixAnalyticsAPIView.as_view(), name='subject-matrix-analytics'),
]
