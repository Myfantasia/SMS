import os
import sys
from dotenv import load_dotenv

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
    'school.tasks.generate_timetable_task': {'queue': 'bulk_ops'},
    'school.tasks.rollover_allocations_task': {'queue': 'bulk_ops'},
    'school.tasks.bulk_auto_allocate_task': {'queue': 'bulk_ops'},
    'school.tasks.bulk_generate_term_results_task': {'queue': 'bulk_ops'},
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