"""HTTP endpoints for platform. Thin: validate -> call services/selectors -> return."""

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from django.conf import settings
from django.http import HttpResponseRedirect
from ninja import Router, Schema

from core.errors import ServiceError
from core.webhooks import bunny_signature_valid

from . import services

router = Router(tags=["platform"])


@router.get("/settings", auth=None, response=dict[str, Any])
def public_settings(request):
    """Settings marked public (feature flags the React app needs)."""
    return services.public_settings()


class PlatformBannerOut(Schema):
    id: UUID
    title: str
    body: str
    url: str
    ends_at: datetime | None


@router.get("/banner", auth=None, response=PlatformBannerOut | None)
def banner(request):
    """The announcement shown as a site banner right now (or null)."""
    from apps.engagement.broadcasts import current_banner

    b = current_banner()
    if b is None:
        return None
    return {"id": b.id, "title": b.title, "body": b.body, "url": b.url, "ends_at": b.banner_ends_at}


@router.get("/branding/{kind}", auth=None, include_in_schema=False)
def branding_file(request, kind: str):
    """The uploaded logo or favicon: a short-lived signed link to the private file."""
    return HttpResponseRedirect(services.branding_url(kind))


@router.post("/webhooks/bunny", auth=None, throttle=[], include_in_schema=False)
def bunny_webhook(request):
    """Bunny Stream video status. Signed with the library's Read-Only API key."""
    if not bunny_signature_valid(request, settings.BUNNY_STREAM["READONLY_KEY"]):
        raise ServiceError("bad_signature", "Invalid webhook signature.", status=401)
    try:
        body = json.loads(request.body)
        guid, status = str(body["VideoGuid"]), int(body["Status"])
        library = int(body["VideoLibraryId"])
    except (ValueError, KeyError, TypeError) as exc:
        raise ServiceError("bad_payload", "Unexpected webhook body.") from exc
    new = services.receive_webhook(
        provider="bunny", dedupe_key=f"{guid}:{status}", topic="bunny.video",
        payload={"video_guid": guid, "status": status, "library_id": library},
    )  # fmt: skip
    return {"received": True, "duplicate": not new}
