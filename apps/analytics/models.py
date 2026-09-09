"""Models for the `analytics` app.

Read-mostly aggregate analytics (school/student/term/subject-matrix) -- first candidate for future extraction.

Track A (current phase): this file is intentionally empty. Every model
listed for this app in the modular-monolith plan still physically lives in
school/models/ -- only the services.py boundary has moved. Track B will
relocate the actual model classes here via hand-written state-only
migrations (SeparateDatabaseAndState), never a plain makemigrations.
"""
from django.db import models  # noqa: F401
