import os

from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'schoolmanagement.settings')

app = Celery('schoolmanagement')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
# `orchestration` isn't a registered Django app (see .importlinter -- it's the
# composition-root layer, not one of the 14 apps), so Celery's INSTALLED_APPS-based
# autodiscovery above never finds its tasks.py. Register it explicitly instead.
app.autodiscover_tasks(['orchestration'])
