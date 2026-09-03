import os
import sys
from dotenv import load_dotenv
from django.urls import reverse_lazy

# Build paths inside the project like this: os.path.join(BASE_DIR, ...)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Loads secrets (SMTP credentials, invite codes, etc.) from a local .env file at the
# project root — see .env.example for the full list of variables this project reads.
# Silently does nothing if .env doesn't exist, so this stays optional in dev.
load_dotenv(os.path.join(BASE_DIR, '.env'))
TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates')
STATIC_DIR = os.path.join(BASE_DIR, 'static')


def _env(key, default=''):
    """os.environ.get(), but treats a present-but-blank value (KEY= with nothing after
    it — the common shape of an unfilled .env template) the same as an unset one,
    instead of silently returning ''. Plain os.environ.get(key, default) does NOT do
    this, which is exactly what let DEFAULT_FROM_EMAIL below go quietly blank."""
    return os.environ.get(key) or default


# SECRET_KEY and the DB password used to be hardcoded literals right here, committed to
# git — anyone with repo access effectively had the DB password. Both now come from
# .env (gitignored); the defaults below exist only so a fresh clone without a .env yet
# still runs, and intentionally do NOT reuse the old exposed values — see .env.example.
SECRET_KEY = _env('SECRET_KEY', 'django-insecure-local-dev-only-set-SECRET_KEY-in-.env')
DEBUG = _env('DEBUG', 'True').lower() == 'true'
ALLOWED_HOSTS = [h.strip() for h in _env('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if h.strip()]

# Application definition
INSTALLED_APPS = [

    'daphne',  # must precede django.contrib.staticfiles so runserver becomes ASGI/WS-capable
    'unfold',
    'unfold.contrib.filters',
    'unfold.contrib.forms',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'channels',
    'school',

    # --- Modular monolith apps (Track A: scaffolded, no models relocated yet).
    # Foundation layer first, then everything that depends on it, matching
    # the dependency order in the modular-monolith plan -- listing order here
    # has no functional effect on Django itself, but keeping it consistent
    # with the dependency graph makes the file self-documenting.
    'apps.core',
    'apps.identity',
    'apps.academics',
    'apps.students',
    'apps.staff',
    'apps.allocations',
    'apps.attendance',
    'apps.assignments',
    'apps.messaging',
    'apps.finance',
    'apps.timetable',
    'apps.exams',
    'apps.results',
    'apps.analytics',
    'apps.content',

    'widget_tweaks',
    'rest_framework',
    'corsheaders',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'school.middleware.MaintenanceModeMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
]

# Unfold (the Django admin theme) reads its own "Return to site" / "View site" link from
# this dict's SITE_URL, not from AdminSite.site_url (Django's own default mechanism,
# which Unfold's each_context() override ignores) -- see unfold/sites.py:_get_config.
#
# SIDEBAR["navigation"] replaces Django's default alphabetical-by-app grouping with named
# sections organized by how a Super Admin actually thinks about the system, cutting across
# app boundaries freely -- see docs/superpowers/specs/2026-08-31-django-admin-overhaul-design.md
# Section C. Every entry's "link" resolves against a real registered admin URL; an entry for
# a model that isn't registered would raise NoReverseMatch (school.tests.test_admin_site_config
# is the regression check for this). All ~49 Phase 1/2 models plus the ~30 Phase 3 models are
# now registered and listed here, including the "Platform" group (School, SystemAuditLog,
# BackgroundJob) which was deliberately omitted until Phase 3 registered those models.
UNFOLD = {
    "SITE_URL": "http://localhost:5173/",
    "SITE_HEADER": "SMS Control Center",
    "SITE_TITLE": "SMS Control Center",
    # No custom logo image yet -- SITE_SYMBOL alone gives Unfold a Material Symbols icon
    # to show in the header/favicon slot instead of the default Django icon.
    "SITE_SYMBOL": "school",
    "SIDEBAR": {
        "show_search": True,
        "show_all_applications": True,
        "navigation": [
            {
                "title": "Governance & RBAC",
                "separator": True,
                "items": [
                    {"title": "Roles", "icon": "shield_person", "link": reverse_lazy("admin:identity_role_changelist")},
                    {"title": "Permissions", "icon": "key", "link": reverse_lazy("admin:identity_permission_changelist")},
                    {"title": "User roles", "icon": "assignment_ind", "link": reverse_lazy("admin:identity_userrole_changelist")},
                    {"title": "Admin invite codes", "icon": "mail", "link": reverse_lazy("admin:identity_admininvitecode_changelist")},
                    {"title": "Forced password changes", "icon": "password", "link": reverse_lazy("admin:identity_forcedpasswordchange_changelist")},
                ],
            },
            {
                "title": "People",
                "separator": True,
                "items": [
                    {"title": "Users", "icon": "person", "link": reverse_lazy("admin:auth_user_changelist")},
                    {"title": "Admin extras", "icon": "verified_user", "link": reverse_lazy("admin:identity_adminextra_changelist")},
                    {"title": "Teachers", "icon": "cast_for_education", "link": reverse_lazy("admin:identity_teacherextra_changelist")},
                    {"title": "Students", "icon": "school", "link": reverse_lazy("admin:identity_studentextra_changelist")},
                    {"title": "Parents", "icon": "family_restroom", "link": reverse_lazy("admin:identity_parentextra_changelist")},
                    {"title": "Staff", "icon": "badge", "link": reverse_lazy("admin:identity_staffextra_changelist")},
                ],
            },
            {
                "title": "Rules & Policies",
                "separator": True,
                "items": [
                    {"title": "Quota default rules", "icon": "tune", "link": reverse_lazy("admin:allocations_quotadefaultrule_changelist")},
                    {"title": "Subject selection rules", "icon": "rule", "link": reverse_lazy("admin:academics_subjectselectionrule_changelist")},
                    {"title": "Subject exclusion rules", "icon": "block", "link": reverse_lazy("admin:academics_subjectexclusionrule_changelist")},
                    {"title": "Grading rules", "icon": "grade", "link": reverse_lazy("admin:exams_gradingrule_changelist")},
                    {"title": "Subject splitting rules", "icon": "call_split", "link": reverse_lazy("admin:allocations_subjectsplittingrule_changelist")},
                    {"title": "Global allocation policy", "icon": "policy", "link": reverse_lazy("admin:allocations_globalallocationpolicy_changelist")},
                    {"title": "Timetable pedagogy policy", "icon": "policy", "link": reverse_lazy("admin:timetable_timetablepedagogypolicy_changelist")},
                ],
            },
            {
                "title": "Curriculum Structure",
                "separator": True,
                "items": [
                    {"title": "Grade levels", "icon": "stairs", "link": reverse_lazy("admin:academics_gradelevel_changelist")},
                    {"title": "Tiers", "icon": "layers", "link": reverse_lazy("admin:academics_tier_changelist")},
                    {"title": "Departments", "icon": "corporate_fare", "link": reverse_lazy("admin:academics_department_changelist")},
                    {"title": "Subjects", "icon": "menu_book", "link": reverse_lazy("admin:academics_subject_changelist")},
                    {"title": "Subject curriculum profiles", "icon": "fact_check", "link": reverse_lazy("admin:academics_subjectcurriculumprofile_changelist")},
                    {"title": "Preset combinations", "icon": "tune", "link": reverse_lazy("admin:academics_presetcombination_changelist")},
                    {"title": "Curriculum presets", "icon": "bookmarks", "link": reverse_lazy("admin:academics_curriculumpreset_changelist")},
                    {"title": "Curricula", "icon": "auto_stories", "link": reverse_lazy("admin:academics_curriculum_changelist")},
                    {"title": "Pathways", "icon": "alt_route", "link": reverse_lazy("admin:academics_pathway_changelist")},
                    {"title": "Tracks", "icon": "route", "link": reverse_lazy("admin:academics_track_changelist")},
                    {"title": "Subject category limits", "icon": "filter_9_plus", "link": reverse_lazy("admin:academics_subjectcategorylimit_changelist")},
                    {"title": "Subject pools", "icon": "waves", "link": reverse_lazy("admin:academics_subjectpool_changelist")},
                ],
            },
            {
                "title": "Classes & Enrollment",
                "separator": True,
                "items": [
                    {"title": "Class streams", "icon": "groups", "link": reverse_lazy("admin:academics_classstream_changelist")},
                    {"title": "Academic years", "icon": "event", "link": reverse_lazy("admin:academics_academicyear_changelist")},
                    {"title": "Exam terms", "icon": "date_range", "link": reverse_lazy("admin:academics_examterm_changelist")},
                    {"title": "Time slots", "icon": "schedule", "link": reverse_lazy("admin:academics_timeslot_changelist")},
                    {"title": "Student subject enrollments", "icon": "how_to_reg", "link": reverse_lazy("admin:students_studentsubjectenrollment_changelist")},
                    {"title": "Student pathway selections", "icon": "alt_route", "link": reverse_lazy("admin:students_studentpathwayselection_changelist")},
                ],
            },
            {
                "title": "Allocations & Timetable",
                "separator": True,
                "items": [
                    {"title": "Subject quotas", "icon": "pie_chart", "link": reverse_lazy("admin:allocations_subjectquota_changelist")},
                    {"title": "Subject allocations", "icon": "assignment_turned_in", "link": reverse_lazy("admin:allocations_subjectallocation_changelist")},
                    {"title": "Subject blocks", "icon": "view_module", "link": reverse_lazy("admin:allocations_subjectblock_changelist")},
                    {"title": "Timetables", "icon": "calendar_month", "link": reverse_lazy("admin:timetable_timetable_changelist")},
                    {"title": "Lesson allocations", "icon": "event_note", "link": reverse_lazy("admin:timetable_lessonallocation_changelist")},
                    {"title": "Allocation publish states", "icon": "publish", "link": reverse_lazy("admin:allocations_allocationpublishstate_changelist")},
                    {"title": "Daily cover", "icon": "swap_horizontal_circle", "link": reverse_lazy("admin:timetable_dailycover_changelist")},
                    {"title": "Teacher structural availability", "icon": "event_busy", "link": reverse_lazy("admin:staff_teacherstructuralavailability_changelist")},
                ],
            },
            {
                "title": "Attendance & Leave",
                "separator": True,
                "items": [
                    {"title": "Attendance sessions", "icon": "event_available", "link": reverse_lazy("admin:attendance_attendancesession_changelist")},
                    {"title": "Attendance records", "icon": "checklist", "link": reverse_lazy("admin:attendance_attendancerecord_changelist")},
                    {"title": "Teacher leave", "icon": "beach_access", "link": reverse_lazy("admin:staff_teacherleave_changelist")},
                    {"title": "Long-term relief assignments", "icon": "swap_horiz", "link": reverse_lazy("admin:staff_longtermreliefassignment_changelist")},
                ],
            },
            {
                "title": "Exams & Results",
                "separator": True,
                "items": [
                    {"title": "Exam events", "icon": "quiz", "link": reverse_lazy("admin:exams_examevent_changelist")},
                    {"title": "Exam results", "icon": "grading", "link": reverse_lazy("admin:exams_examresult_changelist")},
                    {"title": "Student report summaries", "icon": "summarize", "link": reverse_lazy("admin:exams_studentreportsummary_changelist")},
                    {"title": "Class exam status", "icon": "fact_check", "link": reverse_lazy("admin:exams_classexamstatus_changelist")},
                    {"title": "Subject term results", "icon": "score", "link": reverse_lazy("admin:results_subjecttermresult_changelist")},
                    {"title": "Student term results", "icon": "assessment", "link": reverse_lazy("admin:results_studenttermresult_changelist")},
                    {"title": "Class performance analytics", "icon": "insights", "link": reverse_lazy("admin:results_classperformanceanalytics_changelist")},
                    {"title": "National exam records", "icon": "workspace_premium", "link": reverse_lazy("admin:students_nationalexamrecord_changelist")},
                ],
            },
            {
                "title": "Assignments",
                "separator": True,
                "items": [
                    {"title": "Assignments", "icon": "assignment", "link": reverse_lazy("admin:assignments_assignment_changelist")},
                    {"title": "Questions", "icon": "help", "link": reverse_lazy("admin:assignments_question_changelist")},
                    {"title": "Question options", "icon": "checklist_rtl", "link": reverse_lazy("admin:assignments_questionoption_changelist")},
                    {"title": "Student submissions", "icon": "upload_file", "link": reverse_lazy("admin:assignments_studentsubmission_changelist")},
                    {"title": "Student answers", "icon": "edit_note", "link": reverse_lazy("admin:assignments_studentanswer_changelist")},
                    {"title": "Assignment groups", "icon": "groups_2", "link": reverse_lazy("admin:assignments_assignmentgroup_changelist")},
                    {"title": "Assignment attachments", "icon": "attach_file", "link": reverse_lazy("admin:assignments_assignmentattachment_changelist")},
                    {"title": "Rubric criteria", "icon": "checklist", "link": reverse_lazy("admin:assignments_rubriccriterion_changelist")},
                    {"title": "Criterion scores", "icon": "scoreboard", "link": reverse_lazy("admin:assignments_criterionscore_changelist")},
                    {"title": "Student tasks", "icon": "task", "link": reverse_lazy("admin:students_studenttask_changelist")},
                ],
            },
            {
                "title": "Communication",
                "separator": True,
                "items": [
                    {"title": "Notices", "icon": "campaign", "link": reverse_lazy("admin:messaging_notice_changelist")},
                    {"title": "Events", "icon": "event", "link": reverse_lazy("admin:messaging_event_changelist")},
                    {"title": "Notifications", "icon": "notifications", "link": reverse_lazy("admin:messaging_notification_changelist")},
                    {"title": "Chat user profiles", "icon": "account_circle", "link": reverse_lazy("admin:messaging_chatuserprofile_changelist")},
                    {"title": "Chat threads", "icon": "forum", "link": reverse_lazy("admin:messaging_chatthread_changelist")},
                    {"title": "Thread participants", "icon": "group", "link": reverse_lazy("admin:messaging_threadparticipant_changelist")},
                    {"title": "Message audit", "icon": "history_edu", "link": reverse_lazy("admin:messaging_messageaudit_changelist")},
                    {"title": "Chat action responses", "icon": "reply", "link": reverse_lazy("admin:messaging_chatactionresponse_changelist")},
                ],
            },
            {
                "title": "Content",
                "separator": True,
                "items": [
                    {"title": "Blog posts", "icon": "article", "link": reverse_lazy("admin:content_blogpost_changelist")},
                    {"title": "Alumni reviews", "icon": "reviews", "link": reverse_lazy("admin:content_alumnireview_changelist")},
                ],
            },
            {
                "title": "Platform",
                "separator": True,
                "items": [
                    {"title": "Schools", "icon": "domain", "link": reverse_lazy("admin:identity_school_changelist")},
                    {"title": "Background jobs", "icon": "sync", "link": reverse_lazy("admin:core_backgroundjob_changelist")},
                    {"title": "System audit log", "icon": "fact_check", "link": reverse_lazy("admin:core_systemauditlog_changelist")},
                ],
            },
        ],
    },
}

CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = [
    "http://localhost:5173",
]

# Ensure CSRF cookie is readable by JavaScript across ports
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_AGE = 60 * 60 * 3  # Sessions expire after 3 hours of inactivity
SESSION_SAVE_EVERY_REQUEST = True  # ...resetting that 3-hour clock on every request (sliding/idle timeout, not absolute-from-login)

# Deliberately a separate flag from DEBUG/MAINTENANCE_MODE (same env-var-driven,
# defaults-off pattern as MAINTENANCE_MODE below) — set this once actually deployed
# behind real HTTPS. Left off by default so local dev (plain http://localhost) is
# never affected: with these on over plain HTTP, the browser would refuse to send
# the session/CSRF cookies back at all, silently breaking every request.
PRODUCTION_SECURITY = os.environ.get('PRODUCTION_SECURITY', 'False').lower() == 'true'
SESSION_COOKIE_SECURE = PRODUCTION_SECURITY
CSRF_COOKIE_SECURE = PRODUCTION_SECURITY
SECURE_SSL_REDIRECT = PRODUCTION_SECURITY
SECURE_CONTENT_TYPE_NOSNIFF = PRODUCTION_SECURITY
X_FRAME_OPTIONS = 'DENY'
if PRODUCTION_SECURITY:
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30  # 30 days — ramp up once confirmed stable
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True


ROOT_URLCONF = 'schoolmanagement.Urls.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [TEMPLATE_DIR,],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'schoolmanagement.wsgi.application'
ASGI_APPLICATION = 'schoolmanagement.asgi.application'

REDIS_URL = _env('REDIS_URL', 'redis://127.0.0.1:6379/0')

# In-memory only works within a single process — group_send/group_add state lived in
# one worker's memory, so chat fan-out silently missed clients connected to any other
# process. Redis makes the channel layer shared across every worker process/machine.
#
# socket_timeout must exceed RedisChannelLayer.brpop_timeout (5s, hardcoded upstream):
# the inbox listener polls via BRPOP with a 5s blocking timeout, and with no socket_timeout
# configured, redis-py defaults ITS read timeout to 5s too — the exact same 5s. Those two
# clocks start at slightly different instants, so under any scheduling jitter (CPU
# contention, GC pause, etc.) the client's read timeout can fire microseconds before
# Redis's own "no message" reply arrives, surfacing as a raw redis.exceptions.TimeoutError
# instead of a graceful empty BRPOP result. Giving the client timeout real headroom over
# the blocking timeout removes the race instead of just narrowing the window.
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {'hosts': [{'address': REDIS_URL, 'socket_timeout': 20}]},
    }
}

# Database


DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': _env('DB_NAME', 'school_db'),
        'USER': _env('DB_USER', 'postgres'),
        'PASSWORD': _env('DB_PASSWORD'),  # No literal fallback — must come from .env now.
        'HOST': _env('DB_HOST', 'localhost'),
        'PORT': _env('DB_PORT', '5432'),
        # Without these, Django opens a brand-new Postgres connection on every single
        # request — the fastest way to exhaust max_connections under concurrent load.
        # CONN_HEALTH_CHECKS pings a reused connection before trusting it, so a
        # connection dropped by the DB server (restart, timeout) doesn't surface as a
        # request-killing error.
        'CONN_MAX_AGE': 60,
        'CONN_HEALTH_CHECKS': True,
    }
}

# Was django.core.cache.backends.db.DatabaseCache — every cache read/write (login
# throttling, verification-code attempt counters, chat rate limiting) was itself a
# Postgres round trip. Redis moves that load off the database entirely and is shared
# across every worker process, unlike a local-memory cache.
CACHES = {
    'default': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': REDIS_URL,
        'OPTIONS': {'CLIENT_CLASS': 'django_redis.client.DefaultClient'},
    }
}

# --------------------------------------------------------
# CELERY (background jobs — timetable generation, bulk allocation, bulk results)
# --------------------------------------------------------
# Same Redis instance as the cache/channel layer above, just a different logical DB
# index so job messages don't mix with cache keys.
CELERY_BROKER_URL = _env('CELERY_BROKER_URL', REDIS_URL.rsplit('/', 1)[0] + '/1')
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
# Tests run the task function inline, synchronously, in the same process — no worker
# process needs to be running for the test suite, and DB assertions made right after
# calling .delay() see the task's writes immediately (same transaction/connection).
CELERY_TASK_ALWAYS_EAGER = 'test' in sys.argv
CELERY_TASK_EAGER_PROPAGATES = True

# All four bulk-operation tasks mutate overlapping data (allocations/timetable rows for
# a whole term/school) — running two of them at once, even on a multi-core worker, is a
# correctness risk, not just a performance one. Routing them onto their own queue lets a
# worker dedicated to that queue be run at --concurrency=1 (strict one-at-a-time), while
# a separate default-queue worker (higher concurrency) stays free for any lighter
# background task added later. See .env.example for the two `celery worker` commands.
CELERY_TASK_ROUTES = {
    'orchestration.tasks.generate_timetable_task': {'queue': 'bulk_ops'},
    'orchestration.tasks.rollover_allocations_task': {'queue': 'bulk_ops'},
    'orchestration.tasks.bulk_auto_allocate_task': {'queue': 'bulk_ops'},
    'orchestration.tasks.bulk_generate_term_results_task': {'queue': 'bulk_ops'},
    'orchestration.tasks.promote_students_task': {'queue': 'bulk_ops'},
}
# If the worker process dies mid-task (OOM kill, deploy restart, crash), acks_late means
# Redis re-delivers the message to another worker instead of silently losing it. Safe to
# redeliver here because every task fully recomputes its result from the current DB state
# (wipe-then-rebuild) rather than applying an incremental diff — the same property that
# already made these safe for a human to just click "Generate" again after a failure.
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True


# Password validation
AUTH_PASSWORD_VALIDATORS = [
    { 'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator', },
    { 'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', },
    { 'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator', },
    { 'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator', },
]

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_L10N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = '/static/'
STATICFILES_DIRS = [ STATIC_DIR, ]

LOGIN_REDIRECT_URL = '/afterlogin'

# --------------------------------------------------------
# EMAIL (password reset, "your password changed" notices, etc.)
# --------------------------------------------------------
# Real delivery requires credentials — set these three env vars and restart the server:
#   EMAIL_HOST_USER=you@gmail.com
#   EMAIL_HOST_PASSWORD=<a Gmail App Password, not your normal password>
#   DEFAULT_FROM_EMAIL=you@gmail.com   (optional — falls back to EMAIL_HOST_USER)
# Gmail App Passwords: myaccount.google.com/apppasswords (requires 2-Step Verification
# enabled on the account first). Any other SMTP provider works too — override EMAIL_HOST/
# EMAIL_PORT/EMAIL_USE_TLS if you're not using Gmail.
# Until those are set, this falls back to printing emails to the console (dev-only —
# nothing is actually delivered), so local development still works with zero setup.
EMAIL_HOST_USER = _env('EMAIL_HOST_USER')
EMAIL_HOST_PASSWORD = _env('EMAIL_HOST_PASSWORD')

if EMAIL_HOST_USER and EMAIL_HOST_PASSWORD:
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
    EMAIL_HOST = _env('EMAIL_HOST', 'smtp.gmail.com')
    EMAIL_PORT = int(_env('EMAIL_PORT', '587'))
    EMAIL_USE_TLS = _env('EMAIL_USE_TLS', 'True').lower() == 'true'
    DEFAULT_FROM_EMAIL = _env('DEFAULT_FROM_EMAIL', EMAIL_HOST_USER)
else:
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
    DEFAULT_FROM_EMAIL = 'no-reply@myfantasia.local'

# Reset links expire in 1 hour (Django's default is 3 days — too long for a school
# system handling student/parent accounts).
PASSWORD_RESET_TIMEOUT = 60 * 60


# Server-side maintenance switch (deliberately NOT toggleable from inside the app — set this
# env var and restart the server). While on, MaintenanceModeMiddleware blocks every request
# except the public marketing pages and the admin login/signup flow; only an authenticated
# admin can reach anything else. See school/middleware.py.
MAINTENANCE_MODE = os.environ.get('MAINTENANCE_MODE', 'False').lower() == 'true'

MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')

# --------------------------------------------------------
# SECURITY EVENT LOGGING
# --------------------------------------------------------
# Without this, a logger not under the 'django' namespace (like school.security,
# used for failed-login/rate-limit/verification-code events — see
# school/views/auth_rate_limit.py) has no configured handler: INFO-level calls
# would be silently dropped, and even WARNING+ would only reach Python's bare
# "handler of last resort" rather than a consistent, filterable stream.
LOGS_DIR = os.path.join(BASE_DIR, 'logs')
os.makedirs(LOGS_DIR, exist_ok=True)

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'security': {'format': '%(asctime)s %(levelname)s %(message)s'},
    },
    'handlers': {
        'console': {'class': 'logging.StreamHandler'},
        # Console-only output disappears once whatever captured stdout (terminal,
        # systemd journal) rotates or the process restarts. This file survives that,
        # sized/rotated so it can't grow unbounded on a long-running server.
        'security_file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': os.path.join(LOGS_DIR, 'security.log'),
            'maxBytes': 5 * 1024 * 1024,
            'backupCount': 5,
            'formatter': 'security',
        },
    },
    'loggers': {
        'school.security': {
            'handlers': ['console', 'security_file'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}

# --------------------------------------------------------
# DJANGO REST FRAMEWORK CONFIGURATION
# --------------------------------------------------------
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework.authentication.SessionAuthentication',
    ),
    # Baseline safety net — previously NO API endpoint in this app had any request-rate
    # limit at all (only login/password-reset had their own hand-rolled throttling).
    # These starting rates are deliberately generous so real usage isn't broken; tune
    # based on observed traffic once deployed. Rides on the Redis cache backend above,
    # not an extra Postgres round trip.
    'DEFAULT_THROTTLE_CLASSES': (
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ),
    'DEFAULT_THROTTLE_RATES': {
        'anon': '60/min',
        'user': '300/min',
        'bulk_ops': '5/min',
        'uploads': '30/min',
        'submissions': '30/min',
    },
}