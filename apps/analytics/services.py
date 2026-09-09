"""Public service surface for the `analytics` app.

Read-mostly aggregate analytics (school/student/term/subject-matrix) --
named in the original spec as the first candidate for true microservice
extraction, precisely because it's read-heavy and has no writers of its
own to keep synchronous.

No models exist yet -- `apps/analytics/views.py`'s SchoolAnalyticsAPIView/
StudentPerformanceAnalyticsAPIView/TermImprovementAnalyticsAPIView/
SubjectMatrixAnalyticsAPIView (relocated here in Track B step 1, previously
in school/views/results_views.py) compute their aggregates on the fly from
`results`/`exams`/`academics` data rather than persisting their own tables.
The views still query school.models.* directly rather than going through
apps.results.services/apps.academics.services -- that deeper services-only
rewiring is intentionally deferred to keep this pilot's blast radius to
"move the code, keep every URL and query identical."

RULE: every function here takes and returns plain dataclasses -- never a
Django model instance or QuerySet.

This app may import services from:
    - apps.results.services
    - apps.academics.services
    - apps.identity.services

Track A/B status: chosen (with `finance`) as the lowest-risk Track B pilot,
since there's no real model to relocate yet.

See receivers.py for this app's event-bus subscriber (TermResultsCompiledEvent).
"""
