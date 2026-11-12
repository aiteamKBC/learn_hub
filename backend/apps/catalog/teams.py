"""Small, server-side Microsoft Teams meeting client.

It uses client-credentials and only the configured organiser.  Graph credentials and
meeting host URLs are never returned to the browser; learners receive only joinWebUrl
through the existing 15-minute access gate.
"""

from datetime import timedelta, timezone as dt_timezone

import httpx
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from core.errors import ServiceError

TOKEN_CACHE_KEY = "teams:graph:token"


def _token(client: httpx.Client) -> str:
    token = cache.get(TOKEN_CACHE_KEY)
    if token:
        return token
    if not all((settings.GRAPH_TENANT_ID, settings.GRAPH_CLIENT_ID, settings.GRAPH_CLIENT_SECRET)):
        raise ServiceError("teams_not_configured", "Microsoft Teams is not configured yet. Add the Graph app settings.")
    response = client.post(
        f"https://login.microsoftonline.com/{settings.GRAPH_TENANT_ID}/oauth2/v2.0/token",
        data={"client_id": settings.GRAPH_CLIENT_ID, "client_secret": settings.GRAPH_CLIENT_SECRET,
              "scope": settings.GRAPH_SCOPE, "grant_type": "client_credentials"},
    )
    try:
        response.raise_for_status()
        payload = response.json()
        token = payload["access_token"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise ServiceError("teams_auth_failed", "Could not authenticate with Microsoft Teams.", status=502) from exc
    cache.set(TOKEN_CACHE_KEY, token, timeout=max(60, int(payload.get("expires_in", 3600)) - 300))
    return token


def create_meeting(*, lecture) -> dict[str, str]:
    organizer = settings.TEAMS_MEETING_ORGANIZER.strip()
    if not organizer:
        raise ServiceError("teams_not_configured", "Set TEAMS_MEETING_ORGANIZER before creating a Teams session.")
    starts = lecture.live_starts_at
    if timezone.is_naive(starts):
        starts = timezone.make_aware(starts, dt_timezone.utc)
    ends = starts + timedelta(minutes=lecture.live_duration_min)
    body = {"subject": lecture.title, "startDateTime": starts.isoformat(), "endDateTime": ends.isoformat()}
    try:
        with httpx.Client(timeout=20) as client:
            token = _token(client)
            response = client.post(
                f"{settings.GRAPH_BASE_URL}/users/{organizer}/onlineMeetings",
                headers={"Authorization": f"Bearer {token}"}, json=body,
            )
            response.raise_for_status()
            result = response.json()
    except ServiceError:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise ServiceError("teams_create_failed", "Microsoft Teams could not create the meeting. Check Graph permissions and the organiser policy.", status=502) from exc
    if not result.get("id") or not result.get("joinWebUrl"):
        raise ServiceError("teams_create_failed", "Microsoft Teams returned an incomplete meeting.", status=502)
    return {"meeting_id": result["id"], "join_url": result["joinWebUrl"], "organizer": organizer}
