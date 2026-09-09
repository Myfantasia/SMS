import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'schoolmanagement.settings')
django.setup()

with open('school/views/subject_views.py', 'r') as f:
    content = f.read()

# We need to update api_manage_departments to handle subjects in POST
# and api_department_detail to handle subjects in PUT

