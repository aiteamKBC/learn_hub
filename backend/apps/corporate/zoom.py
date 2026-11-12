"""B2B-05: Zoom webhook processing.

Receives Zoom webhook events, verifies signature, stores raw events,
then dispatches to attendance processing.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging

from django.conf import settings
from django.utils import timezone

from core.tenancy import tenant_context

from .models import ZoomEvent

log = logging.getLogger(__name__)


def verify_signature(payload: bytes, signature: str, timestamp: str) -> bool:
    secret = getattr(settings, "ZOOM_WEBHOOK_SECRET", "")
    if not secret:
        return False
    message = f"v0:{timestamp}:{payload.decode('utf-8')}"
    expected = "v0=" + hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def handle_webhook(payload: bytes, signature: str, timestamp: str) -> str:
    if not verify_signature(payload, signature, timestamp):
        return "invalid_signature"

    data = json.loads(payload)
    event_type = data.get("event", "")
    event_id = data.get("payload", {}).get("object", {}).get("id", "") or data.get("event_ts", "")

    dedupe_key = f"{event_type}:{event_id}:{timestamp}"

    with tenant_context(staff=True):
        existing = ZoomEvent.objects.filter(event_id=dedupe_key).first()
        if existing:
            return "duplicate"

        zoom_event = ZoomEvent.objects.create(
            event_id=dedupe_key,
            event_type=event_type,
            meeting_id=str(data.get("payload", {}).get("object", {}).get("id", "")),
            account_id=str(data.get("payload", {}).get("account_id", "")),
            payload=data,
        )

    try:
        with tenant_context(staff=True):
            _dispatch(zoom_event, data)
            ZoomEvent.objects.filter(pk=zoom_event.pk).update(
                processed_at=timezone.now(),
                error="",
            )
    except Exception as exc:
        log.exception("Zoom event %s failed", dedupe_key)
        with tenant_context(staff=True):
            ZoomEvent.objects.filter(pk=zoom_event.pk).update(error=str(exc)[:2000])

    return "processed"


def _dispatch(zoom_event: ZoomEvent, data: dict) -> None:
    event_type = data.get("event", "")
    if event_type in ("meeting.participant_joined", "meeting.participant_left"):
        from .attendance import process_participant_event

        process_participant_event(zoom_event, data)
