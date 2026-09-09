"""URL routes for the `core` app.

Track A (current phase): empty -- every existing route for this domain
still lives in schoolmanagement/Urls/urls.py, pointing at school/views/*.
Track B moves routes here app-by-app, keeping every path string byte-for-
byte identical (verified against the frontend's actual call sites) so the
frontend needs zero changes.
"""
from django.urls import path

urlpatterns = []
