"""URL routes for the `academics` app.

Track A left this empty (every existing route still lived in
schoolmanagement/Urls/urls.py, pointing at school/views/*). This is the first real route:
list_departments, added directly here rather than in the legacy file since it's genuinely new,
not a relocation.
"""
from django.urls import path

from apps.academics.views import api_list_departments

urlpatterns = [
    path('departments/', api_list_departments, name='api_list_departments'),
]
