"""Production settings. Refuses to start when a security-critical value is missing."""

import os

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F401,F403
from .base import (
    ALLOWED_HOSTS,
    DATABASES,
    FRONTEND_URL,
    GRAPH_CLIENT_ID,
    GRAPH_CLIENT_SECRET,
    GRAPH_TENANT_ID,
    MAIL_MODE,
    REDIS_URL,
    SECRET_KEY,
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
)

DEBUG = False

# --- Fail fast on unsafe configuration ----------------------------------------
_problems = []
if SECRET_KEY in ("", "insecure-dev-key", "change-me") or len(SECRET_KEY) < 50:
    _problems.append("DJANGO_SECRET_KEY must be a random value of 50+ characters")
if not ALLOWED_HOSTS:
    _problems.append("DJANGO_ALLOWED_HOSTS is empty")
if not REDIS_URL:
    _problems.append("REDIS_URL is required (cache, sessions, rate limits, Celery)")
if "-pooler" not in DATABASES["default"].get("HOST", ""):
    _problems.append("DATABASE_URL must use the Neon pooled host (-pooler)")
if DATABASES["default"].get("USER") != "lms_app":
    _problems.append("DATABASE_URL must connect as lms_app (no DDL, cannot bypass RLS)")
if MAIL_MODE == "graph" and not (GRAPH_TENANT_ID and GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET):
    _problems.append(
        "MAIL_MODE=graph needs MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET"
    )
if STRIPE_SECRET_KEY and not STRIPE_WEBHOOK_SECRET:
    _problems.append("STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set")
if not FRONTEND_URL.startswith("https://") or "localhost" in FRONTEND_URL or "127.0.0.1" in FRONTEND_URL:
    _problems.append("FRONTEND_URL must be the site's public https address (links in emails use it)")
if _problems:
    raise ImproperlyConfigured("Unsafe production settings: " + "; ".join(_problems))

# --- HTTPS and cookies ------------------------------------------------------------
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = os.getenv("DJANGO_SSL_REDIRECT", "1") == "1"
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = False  # turn on only once every subdomain is HTTPS-only
SILENCED_SYSTEM_CHECKS = ["security.W021"]  # HSTS preload deliberately off (see above)
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
