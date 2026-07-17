import os
from dotenv import load_dotenv

# Build paths inside the project like this: os.path.join(BASE_DIR, ...)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Loads secrets (SMTP credentials, invite codes, etc.) from a local .env file at the
# project root — see .env.example for the full list of variables this project reads.
# Silently does nothing if .env doesn't exist, so this stays optional in dev.
load_dotenv(os.path.join(BASE_DIR, '.env'))
TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates')
STATIC_DIR = os.path.join(BASE_DIR, 'static')

# Quick-start development settings - unsuitable for production
SECRET_KEY = 'k0ujs9pcw+7qohwas!o7_ept20$c@$)-b=qco8sgviy_f)((bc'
DEBUG = True
ALLOWED_HOSTS = []

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

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels.layers.InMemoryChannelLayer',
        # SWAP POINT for multi-process/production:
        # 'BACKEND': 'channels_redis.core.RedisChannelLayer',
        # 'CONFIG': {'hosts': [('127.0.0.1', 6379)]},
    }
}

# Database


DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'school_db',
        'USER': 'postgres',      # Your Postgres username
        'PASSWORD': 'jordan123', # Your Postgres password
        'HOST': 'localhost',
        'PORT': '5432',
    }
}

CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.db.DatabaseCache',
        'LOCATION': 'auth_token_cache',
    }
}


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
def _env(key, default=''):
    """os.environ.get(), but treats a present-but-blank value (KEY= with nothing after
    it — the common shape of an unfilled .env template) the same as an unset one,
    instead of silently returning ''. Plain os.environ.get(key, default) does NOT do
    this, which is exactly what let DEFAULT_FROM_EMAIL below go quietly blank."""
    return os.environ.get(key) or default


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


# Shared secret an existing admin gives out-of-band to whoever they want to invite as
# a new admin. Required on /adminsignup for every signup except the very first
# (bootstrap) admin. CHANGE THIS before deploying.
ADMIN_SIGNUP_INVITE_CODE = _env('ADMIN_SIGNUP_INVITE_CODE', 'change-this-invite-code')

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
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {'class': 'logging.StreamHandler'},
    },
    'loggers': {
        'school.security': {
            'handlers': ['console'],
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
}