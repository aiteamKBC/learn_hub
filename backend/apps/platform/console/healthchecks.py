"""Health tiles for the console dashboard (mockup 26): database, cache, queue, storage, video,
email and payments. Cheap checks only: one `SELECT 1`, a cache round trip, counts of stuck
jobs, and for the outside services one small authenticated call with a 3 s timeout whose
result is cached for 60 s. Messages are fixed, plain sentences: no keys, URLs or raw errors
ever reach the browser."""

import logging
import os
import time
import uuid
from datetime import timedelta

import httpx
from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.utils import timezone

logger = logging.getLogger(__name__)

TIMEOUT = 3
CACHE_SECONDS = 60
OK, WARN, DOWN = "ok", "warning", "down"

transport = None  # tests inject an httpx.MockTransport


def _tile(key: str, label: str, status: str, detail: str, ms: int | None = None) -> dict:
    return {"key": key, "label": label, "status": status, "detail": detail, "latency_ms": ms}


def _http() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT, transport=transport)


def _cached(key: str, check) -> dict:
    """Run an outside check at most once a minute (all staff share the answer)."""
    hit = cache.get(f"console:health:{key}")
    if hit:
        return hit
    try:
        tile = check()
    except Exception:  # an unreachable service is a red tile, never a 500
        logger.warning("health check %s failed", key, exc_info=True)
        tile = None
    cache.set(f"console:health:{key}", tile or "fail", CACHE_SECONDS)
    return tile or "fail"


def _timed(fn):
    t = time.monotonic()
    result = fn()
    return result, int((time.monotonic() - t) * 1000)


# ---------------------------------------------------------------- the checks
def database() -> dict:
    def ping():
        with connection.cursor() as c:
            c.execute("SELECT 1")
            return c.fetchone()

    try:
        _, ms = _timed(ping)
    except Exception:
        logger.warning("health: database", exc_info=True)
        return _tile("database", "Database", DOWN, "The database did not answer.")
    return _tile("database", "Database", OK if ms < 500 else WARN, "Answering normally." if ms < 500 else "Slow to answer.", ms)  # fmt: skip


def cache_tile() -> dict:
    key, value = f"console:health:ping:{uuid.uuid4().hex}", "1"
    try:
        (_, ms) = _timed(lambda: (cache.set(key, value, 10), cache.get(key)))
        ok = cache.get(key) == value
        cache.delete(key)
    except Exception:
        logger.warning("health: cache", exc_info=True)
        return _tile("cache", "Cache", DOWN, "The cache did not answer.")
    if not ok:
        return _tile("cache", "Cache", DOWN, "The cache is not keeping values.")
    if not getattr(settings, "REDIS_URL", ""):
        return _tile("cache", "Cache", WARN, "Using memory on this server (no Redis).", ms)
    return _tile("cache", "Cache", OK, "Answering normally.", ms)


def queue() -> dict:
    from apps.platform.models import OutboxEvent

    stuck_since = timezone.now() - timedelta(minutes=10)
    pending = OutboxEvent.objects.filter(processed_at__isnull=True)
    stuck = pending.filter(created_at__lt=stuck_since).count()
    failing = pending.filter(attempts__gte=3).count()
    if failing:
        return _tile(
            "queue", "Background jobs", DOWN, f"{failing} job{'s' if failing != 1 else ''} keep failing."
        )
    if stuck:
        return _tile(
            "queue",
            "Background jobs",
            WARN,
            f"{stuck} job{'s' if stuck != 1 else ''} waiting over 10 minutes.",
        )
    return _tile("queue", "Background jobs", OK, "No jobs waiting.")  # fmt: skip


def storage() -> dict:
    from core import storage as blob

    if not blob.configured():
        return _tile("storage", "File storage", WARN, "File storage is not set up.")

    def check():
        with _http() as http:
            _, ms = _timed(lambda: blob.token(http))
        return _tile("storage", "File storage", OK, "Signed in to file storage.", ms)

    tile = _cached("storage", check)
    return tile if tile != "fail" else _tile("storage", "File storage", DOWN, "File storage did not answer.")


def video() -> dict:
    from apps.catalog import bunny
    from apps.catalog.models import VideoLibrary

    library = VideoLibrary.objects.filter(is_default=True).first()
    if library is None or not os.getenv(library.api_key_env, ""):
        return _tile("video", "Video (Bunny)", WARN, "Video uploads are not set up.")

    def check():
        with _http() as http:
            r, ms = _timed(lambda: http.get(
                f"{bunny.API}/library/{library.bunny_library_id}/videos",
                params={"page": 1, "itemsPerPage": 1},
                headers={"AccessKey": os.getenv(library.api_key_env, ""), "accept": "application/json"},
            ))  # fmt: skip
        if r.status_code >= 400:
            return _tile("video", "Video (Bunny)", DOWN, "The video service refused our key.", ms)
        return _tile("video", "Video (Bunny)", OK, "Video library reachable.", ms)

    tile = _cached("video", check)
    return (
        tile if tile != "fail" else _tile("video", "Video (Bunny)", DOWN, "The video service did not answer.")
    )


def email() -> dict:
    if getattr(settings, "MAIL_MODE", "console") != "graph":
        return _tile("email", "Email", WARN, "Emails are written to the server log, not sent.")

    def check():
        from core.mail import GraphEmailBackend

        with _http() as http:
            _, ms = _timed(lambda: GraphEmailBackend()._token(http))
        return _tile("email", "Email", OK, "Signed in to Microsoft 365.", ms)

    tile = _cached("email", check)
    return tile if tile != "fail" else _tile("email", "Email", DOWN, "The email service did not answer.")


def payments() -> dict:
    from apps.commerce.models import StripeEvent

    if not settings.STRIPE_SECRET_KEY:
        return _tile("payments", "Payments (Stripe)", WARN, "Payments are not set up.")
    failing = StripeEvent.objects.filter(processed_at__isnull=True).exclude(error="").count()

    def check():
        with _http() as http:
            r, ms = _timed(
                lambda: http.get("https://api.stripe.com/v1/balance", auth=(settings.STRIPE_SECRET_KEY, ""))
            )
        if r.status_code >= 400:
            return _tile("payments", "Payments (Stripe)", DOWN, "Stripe refused our key.", ms)
        return _tile("payments", "Payments (Stripe)", OK, "Stripe reachable.", ms)  # fmt: skip

    tile = _cached("payments", check)
    if tile == "fail":
        return _tile("payments", "Payments (Stripe)", DOWN, "Stripe did not answer.")
    if failing and tile["status"] == OK:
        n = f"{failing} payment event{'s' if failing != 1 else ''}"
        return {**tile, "status": WARN, "detail": f"{n} could not be processed."}
    return tile


def tiles() -> list[dict]:
    out = [database(), cache_tile(), queue(), storage(), video(), email(), payments()]
    alert(out)
    return out


def alert(rows: list[dict]) -> None:
    """A red tile tells every staff member once an hour per service (the bell + email)."""
    from apps.engagement.notify import notify_staff

    hour = timezone.now().strftime("%Y%m%d%H")
    for t in rows:
        if t["status"] == DOWN:
            notify_staff("staff_health_alert", {"service": t["label"], "detail": t["detail"]},
                         url="/console#health", dedupe=f"health:{t['key']}:{hour}")  # fmt: skip
