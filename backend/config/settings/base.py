"""Shared settings. Environment-specific overrides live in dev.py / prod.py."""

import os
from pathlib import Path

import dj_database_url
from celery.schedules import crontab
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / ".env")


def env_list(name: str, default: str = "") -> list[str]:
    return [v.strip() for v in os.getenv(name, default).split(",") if v.strip()]


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "insecure-dev-key")
DEBUG = os.getenv("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

# One Django app per Postgres schema (see docs/STRUCTURE.md).
DOMAIN_APPS = [
    "apps.identity",
    "apps.org",
    "apps.catalog",
    "apps.learning",
    "apps.compliance",
    "apps.commerce",
    "apps.payouts",
    "apps.engagement",
    "apps.analytics",
    "apps.platform",
    "apps.corporate",
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "corsheaders",
    "core",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
    "allauth.socialaccount.providers.microsoft",
    "allauth.mfa",
    "allauth.headless",
    *DOMAIN_APPS,
]

AUTH_USER_MODEL = "identity.User"
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

# --- Sign-in (django-allauth, headless for the React app) ----------------------
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
HEADLESS_ONLY = True  # no server-rendered login pages; React owns every screen
HEADLESS_CLIENTS = ("browser",)  # session cookie + CSRF, same as the rest of the API
HEADLESS_FRONTEND_URLS = {
    "account_confirm_email": f"{FRONTEND_URL}/account/verify-email/{{key}}",
    "account_reset_password": f"{FRONTEND_URL}/account/password/reset",
    "account_reset_password_from_key": f"{FRONTEND_URL}/account/password/reset/key/{{key}}",
    "account_signup": f"{FRONTEND_URL}/account/signup",
    "socialaccount_login_error": f"{FRONTEND_URL}/account/provider/callback",
}
ACCOUNT_USER_MODEL_USERNAME_FIELD = None
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "password1*"]
ACCOUNT_UNIQUE_EMAIL = True
ACCOUNT_EMAIL_VERIFICATION = "mandatory"
ACCOUNT_LOGIN_ON_EMAIL_CONFIRMATION = True
ACCOUNT_PREVENT_ENUMERATION = True  # same responses whether or not an email is registered
ACCOUNT_EMAIL_SUBJECT_PREFIX = "[LearnHub] "
ACCOUNT_RATE_LIMITS = {
    "login_failed": "10/m/ip,5/5m/key",
    "signup": "20/m/ip",
    "reset_password": "20/m/ip,5/m/key",
    "confirm_email": "1/3m/key",
}
SOCIALACCOUNT_EMAIL_AUTHENTICATION = False  # trusted per provider below
SOCIALACCOUNT_EMAIL_AUTHENTICATION_AUTO_CONNECT = True
SOCIALACCOUNT_STORE_TOKENS = False  # we only need identity, never the provider's API
SOCIALACCOUNT_ADAPTER = "apps.identity.adapters.SocialAdapter"
ACCOUNT_ADAPTER = "apps.identity.adapters.AccountAdapter"  # console switches: sign-up, verification
_PROVIDERS = {
    "google": {
        # Google verifies email ownership, so a Google login may join an existing
        # account with the same email. Microsoft personal accounts do not, so it may not.
        "EMAIL_AUTHENTICATION": True,
        "SCOPE": ["openid", "email", "profile"],
        "APPS": [
            {"client_id": os.getenv("GOOGLE_CLIENT_ID", ""), "secret": os.getenv("GOOGLE_CLIENT_SECRET", "")}
        ],
    },
    "microsoft": {
        "TENANT": "common",  # any work/school tenant + personal Microsoft accounts
        "SCOPE": ["openid", "email", "profile", "User.Read"],
        "APPS": [
            {
                # A separate app registration from the mail one (MICROSOFT_* below):
                # sign-in needs delegated scopes and redirect URIs, mail needs Mail.Send.
                "client_id": os.getenv("MICROSOFT_LOGIN_CLIENT_ID", ""),
                "secret": os.getenv("MICROSOFT_LOGIN_CLIENT_SECRET", ""),
                "settings": {"tenant": "common"},
            }
        ],
    },
}
# Only providers with credentials are offered, so the login page never shows a dead button
SOCIALACCOUNT_PROVIDERS = {name: cfg for name, cfg in _PROVIDERS.items() if cfg["APPS"][0]["client_id"]}
MFA_SUPPORTED_TYPES = ["totp", "recovery_codes"]
MFA_TOTP_ISSUER = "LearnHub"
MFA_ADAPTER = "apps.identity.adapters.MFAAdapter"  # issuer = platform name (console)

MIDDLEWARE = [
    "core.middleware.RequestIDMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Console switches: maintenance mode, guest browsing, applications, 2-step (staff bypass)
    "apps.platform.middleware.AccessSwitchMiddleware",
    # Must stay last: opens the per-request transaction and sets app.org_id for RLS.
    "core.tenancy.TenantMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

# --- Database --------------------------------------------------------------
# default -> Neon POOLED host as lms_app (PgBouncer, transaction mode)
# owner   -> Neon DIRECT host as lms_owner; the only connection migrations use
# Run migrations with:  python manage.py migrate --database owner
_app_db = dj_database_url.parse(
    os.getenv("DATABASE_URL", "postgresql://localhost/lms"),
    conn_max_age=60,
    conn_health_checks=True,
)
_app_db["DISABLE_SERVER_SIDE_CURSORS"] = True  # required behind PgBouncer transaction mode
# Tests: the app alias reuses the owner test database (lms_app cannot CREATE DATABASE).
_app_db["TEST"] = {"MIRROR": "owner"}

_owner_db = dj_database_url.parse(
    os.getenv("DATABASE_URL_OWNER") or os.getenv("DATABASE_URL", "postgresql://localhost/lms"),
    conn_max_age=0,
)
# Direct connection, so a session search_path is safe here. Tables created without
# an explicit schema (django-allauth's email/social/MFA tables, Django's sessions,
# permissions, migrations) land in the identity schema, the one place personal data
# lives (decision 8). public stays on the path for extension types (citext, ltree).
_owner_db.setdefault("OPTIONS", {})["options"] = "-c search_path=identity,public"
# Tests: the owner builds the test database first and depends on nothing; the app
# alias (and replica) mirror it. Without this, Django makes owner depend on default
# while default mirrors owner -> "Circular dependency in TEST[DEPENDENCIES]".
_owner_db["TEST"] = {"DEPENDENCIES": []}
# Parallel test runs (one per working area) each use their own test database: two runs
# sharing one get in each other's way. Unset = Django's default name.
if os.getenv("TEST_DB_NAME"):
    _owner_db["TEST"]["NAME"] = os.environ["TEST_DB_NAME"]
if "-pooler" in (_owner_db.get("HOST") or ""):
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured(
        "DATABASE_URL_OWNER must use Neon's DIRECT host (without '-pooler'). "
        "Migrations need a real session; the pooler is only for DATABASE_URL."
    )

DATABASES = {"default": _app_db, "owner": _owner_db}

# Optional read replica (Neon read replica, pooled host, lms_readonly or lms_app).
# Code opts in explicitly with .using(core.db.replica()).
if os.getenv("DATABASE_URL_REPLICA"):
    _replica_db = dj_database_url.parse(
        os.environ["DATABASE_URL_REPLICA"], conn_max_age=60, conn_health_checks=True
    )
    _replica_db["DISABLE_SERVER_SIDE_CURSORS"] = True
    _replica_db["TEST"] = {"MIRROR": "owner"}
    DATABASES["replica"] = _replica_db
DATABASE_ROUTERS = ["core.db.OwnerMigrationsRouter"]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Cache -----------------------------------------------------------------
REDIS_URL = os.getenv("REDIS_URL", "")
if REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": REDIS_URL,
            "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
        }
    }
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# --- Sessions -----------------------------------------------------------------
# With Redis: sessions never touch Postgres (one less write per login/request).
SESSION_ENGINE = (
    "django.contrib.sessions.backends.cache" if REDIS_URL else "django.contrib.sessions.backends.db"
)
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False  # React reads csrftoken and sends it as X-CSRFToken
CSRF_COOKIE_SAMESITE = "Lax"

# --- Auth / i18n / static ---------------------------------------------------
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",  # memory-hard, resists GPU cracking
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "apps.identity.validators.PlatformMinimumLengthValidator"},  # length from console settings
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-gb"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# --- Request limits -------------------------------------------------------------
# Videos go straight to Bunny (TUS), never through Django, so bodies stay small.
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
DATA_UPLOAD_MAX_NUMBER_FIELDS = 1000

ADMIN_URL = os.getenv("DJANGO_ADMIN_URL", "admin/")  # use a non-obvious path in production

# --- API -------------------------------------------------------------------------
NINJA_NUM_PROXIES = int(os.getenv("NINJA_NUM_PROXIES", "0"))  # 1 behind one load balancer
QUERY_BUDGET = int(os.getenv("QUERY_BUDGET", "25"))  # dev warning threshold per request
# A laptop talking to Neon in London pays ~20-80 ms per query, so the dev default is
# generous; production latency is measured by the platform, not this warning.
SLOW_REQUEST_MS = int(os.getenv("SLOW_REQUEST_MS", "1500"))

# --- Background jobs (Celery) ---------------------------------------------------
CELERY_BROKER_URL = REDIS_URL or "memory://"
CELERY_RESULT_BACKEND = None  # results are written to Postgres by the tasks themselves
CELERY_TASK_ALWAYS_EAGER = not REDIS_URL  # no Redis locally -> tasks run inline
CELERY_TASK_ACKS_LATE = True  # a crashed worker's task is retried, not lost
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_TIME_LIMIT = 300
CELERY_TASK_SOFT_TIME_LIMIT = 240
CELERY_TIMEZONE = "UTC"
CELERY_BEAT_SCHEDULE: dict = {
    "secure-partitions": {"task": "core.secure_partitions", "schedule": 60 * 60 * 24},
    "flush-progress-heartbeats": {"task": "learning.flush_heartbeats", "schedule": 60},
    # Everything is UTC (decision 13): statuses roll over just after midnight UTC
    "compliance-nightly": {"task": "compliance.nightly", "schedule": crontab(hour=0, minute=5)},
}

# --- Logging ------------------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"request_id": {"()": "core.logging.RequestIDFilter"}},
    "formatters": {"default": {"format": "%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s"}},
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "default", "filters": ["request_id"]}
    },
    "root": {"handlers": ["console"], "level": os.getenv("LOG_LEVEL", "INFO")},
    "loggers": {
        "django.db.backends": {"level": "WARNING"},
        # request URLs can carry signed links or tokens: never log them
        "httpx": {"level": "WARNING"},
        "httpcore": {"level": "WARNING"},
        "stripe": {"level": "WARNING"},
    },
}

# --- CORS / CSRF (React dev server) -----------------------------------------
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", "http://localhost:5173")

# --- File storage (Azure Blob, see core/storage.py) -----------------------------------
AZURE_STORAGE = {
    "ACCOUNT": os.getenv("AZURE_STORAGE_ACCOUNT_NAME", ""),
    "CONTAINER": os.getenv("AZURE_STORAGE_CONTAINER", "lms-resources"),
    "TENANT_ID": os.getenv("AZURE_STORAGE_TENANT_ID", ""),
    "CLIENT_ID": os.getenv("AZURE_STORAGE_CLIENT_ID", ""),
    "CLIENT_SECRET": os.getenv("AZURE_STORAGE_CLIENT_SECRET", ""),
}
RESOURCE_MAX_BYTES = 100 * 1024 * 1024  # per lecture file
RESOURCES_PER_LECTURE = 20

# --- Bunny Stream -------------------------------------------------------------
BUNNY_STREAM = {
    "LIBRARY_ID": os.getenv("BUNNY_STREAM_LIBRARY_ID", ""),
    "API_KEY": os.getenv("BUNNY_STREAM_API_KEY", ""),
    "TOKEN_KEY": os.getenv("BUNNY_STREAM_TOKEN_KEY", ""),
    "CDN_HOST": os.getenv("BUNNY_STREAM_CDN_HOST", ""),
    "READONLY_KEY": os.getenv("BUNNY_STREAM_READONLY_KEY", ""),  # verifies webhook signatures
    "TOKEN_TTL_SECONDS": 300,
}

TEST_RUNNER = "core.test_runner.NeonTestRunner"  # direct host + leftover-session cleanup for tests

# --- Money (decisions 9-10) ------------------------------------------------------
# Keys come from the Stripe dashboard (Developers > API keys / Webhooks), .env only.
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
BASE_CURRENCY = "GBP"  # price tiers and reporting
FX_DRIFT_REPRICE = 0.05  # re-price a tier in a currency only when FX moved it more than 5%
ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
REFUND_WINDOW_DAYS = 30
CELERY_BEAT_SCHEDULE["fx-rates-daily"] = {  # ECB publishes around 16:00 CET
    "task": "commerce.refresh_fx",
    "schedule": crontab(hour=15, minute=37),
}
CELERY_BEAT_SCHEDULE["purge-unused-files"] = {
    "task": "catalog.purge_unused_files",
    "schedule": crontab(hour=3, minute=41),
}
CELERY_BEAT_SCHEDULE["purge-abandoned-submission-uploads"] = {
    "task": "learning.purge_abandoned_uploads",
    "schedule": crontab(hour=3, minute=53),
}
CELERY_BEAT_SCHEDULE["certificates-expiring"] = {  # learners hear 30 days before a certificate expires
    "task": "learning.certificate_expiry_reminders",
    "schedule": crontab(hour=8, minute=7),
}
CELERY_BEAT_SCHEDULE["expire-stale-checkouts"] = {"task": "commerce.expire_checkouts", "schedule": 60 * 30}

# --- Instructor payouts ------------------------------------------------------------
PAYOUT_MINIMUM_GBP_MINOR = 2500  # balances below £25 roll over to next month
CELERY_BEAT_SCHEDULE[
    "payouts-monthly"
] = {  # daily: the pool on the 1st, payouts on the payout day (settings)
    "task": "payouts.scheduled_run",
    "schedule": crontab(hour=2, minute=17),
}
CELERY_BEAT_SCHEDULE["prune-notifications"] = {
    "task": "engagement.prune_notifications",
    "schedule": crontab(hour=3, minute=41),
}
CELERY_BEAT_SCHEDULE["outbox-dispatch"] = {"task": "platform.dispatch_outbox", "schedule": 30}
CELERY_BEAT_SCHEDULE["outbox-prune"] = {
    "task": "platform.prune_outbox",
    "schedule": crontab(hour=4, minute=13),
}

# --- Email (Microsoft Graph, see core/mail.py) ---------------------------------------
MAIL_MODE = os.getenv("MAIL_MODE", "console")  # console | graph


# Same variable names as Communication Centre (MICROSOFT_*); older GRAPH_* and MAIL_* names still work.
def _env(*names: str, default: str = "") -> str:
    return next((os.environ[n] for n in names if os.environ.get(n)), default)


GRAPH_TENANT_ID = _env("MICROSOFT_TENANT_ID", "GRAPH_TENANT_ID", "MAIL_TENANT_ID")
GRAPH_CLIENT_ID = _env("MICROSOFT_CLIENT_ID", "GRAPH_CLIENT_ID", "MAIL_CLIENT_ID")
GRAPH_CLIENT_SECRET = _env("MICROSOFT_CLIENT_SECRET", "GRAPH_CLIENT_SECRET", "MAIL_CLIENT_SECRET")
GRAPH_SCOPE = _env("MICROSOFT_GRAPH_SCOPE", default="https://graph.microsoft.com/.default")
GRAPH_BASE_URL = _env("MICROSOFT_GRAPH_BASE_URL", default="https://graph.microsoft.com/v1.0").rstrip("/")
GRAPH_SENDER = _env(
    "MICROSOFT_GRAPH_SENDER", "GRAPH_SENDER", "MAIL_SENDER", default="no-reply@example.com"
)  # no-reply mailbox
# Microsoft Teams meetings use the same Entra application credentials as mail, but
# intentionally have their own organiser.  This prevents a content author from
# choosing an arbitrary user in the tenant as the meeting host.
TEAMS_MEETING_ORGANIZER = _env("TEAMS_MEETING_ORGANIZER", default="")
MAIL_ALLOWED_DOMAINS = {
    d.strip().lower() for d in os.getenv("MAIL_ALLOWED_DOMAINS", "").split(",") if d.strip()
}
EMAIL_BACKEND = "core.mail.GraphEmailBackend" if MAIL_MODE == "graph" else "core.mail.SafeConsoleBackend"
DEFAULT_FROM_EMAIL = f"LearnHub <{GRAPH_SENDER}>"
SERVER_EMAIL = GRAPH_SENDER
