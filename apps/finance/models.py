"""Models for the `finance` app.

Fee/finance tracking (currently a thin stub -- no models yet).

Track A (current phase): this file is intentionally empty. Every model
listed for this app in the modular-monolith plan still physically lives in
school/models/ -- only the services.py boundary has moved. Track B will
relocate the actual model classes here via hand-written state-only
migrations (SeparateDatabaseAndState), never a plain makemigrations.
"""
from django.db import models  # noqa: F401
