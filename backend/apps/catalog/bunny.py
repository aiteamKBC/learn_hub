"""Bunny Stream: create a video and hand the browser a short-lived TUS upload signature.

The browser uploads straight to Bunny (resumable TUS); the file never passes through
our servers and the library API key never reaches the browser. Only the signature
for ONE video, valid for 2 hours, does:
    AuthorizationSignature = SHA256(library_id + api_key + expiration_time + video_id)
https://docs.bunny.net/reference/tus-resumable-uploads
"""

import base64
import hashlib
import os
import time

import httpx

from core.errors import ServiceError

API = "https://video.bunnycdn.com"
TUS_ENDPOINT = f"{API}/tusupload"
UPLOAD_TTL_SEC = 2 * 60 * 60


def _key(library) -> str:
    key = os.getenv(library.api_key_env, "")
    if not key:
        raise ServiceError("video_unavailable", "Video uploads are not configured.", status=503)
    return key


def create_video(library, title: str) -> str:
    """Returns the new video's guid."""
    key = _key(library)
    try:
        # connect fast, retry once on a dropped connection (POST is safe: nothing was created)
        with httpx.Client(
            timeout=httpx.Timeout(15, connect=5), transport=httpx.HTTPTransport(retries=1)
        ) as client:
            r = client.post(
                f"{API}/library/{library.bunny_library_id}/videos",
                headers={"AccessKey": key, "accept": "application/json"},
                json={"title": title[:200]},
            )
    except httpx.HTTPError as exc:
        raise ServiceError(
            "video_unreachable",
            "We couldn't reach the video service. Check your connection and try again.",
            status=503,
        ) from exc
    if r.status_code >= 400:
        raise ServiceError("video_unavailable", "The video service did not accept the upload.", status=502)
    return r.json()["guid"]


def upload_session(library, guid: str) -> dict:
    expires = int(time.time()) + UPLOAD_TTL_SEC
    signature = hashlib.sha256(
        f"{library.bunny_library_id}{_key(library)}{expires}{guid}".encode()
    ).hexdigest()
    return {
        "endpoint": TUS_ENDPOINT,
        "headers": {
            "AuthorizationSignature": signature,
            "AuthorizationExpire": str(expires),
            "VideoId": guid,
            "LibraryId": str(library.bunny_library_id),
        },
        "expires_at": expires,
    }


def get_video(library, guid: str) -> dict:
    """The video's state at Bunny: status (API codes, not webhook codes), encodeProgress, length."""
    try:
        with httpx.Client(timeout=httpx.Timeout(10, connect=5)) as client:
            r = client.get(f"{API}/library/{library.bunny_library_id}/videos/{guid}",
                           headers={"AccessKey": _key(library), "accept": "application/json"})  # fmt: skip
        r.raise_for_status()
    except httpx.HTTPError as exc:
        raise ServiceError("video_unreachable", "We couldn't reach the video service.", status=503) from exc
    return r.json()


def update_video(library, guid: str, *, chapters: list[dict], moments: list[dict]) -> None:
    """Chapters [{title, start, end}] and moments [{label, timestamp}], in seconds; they
    show in Bunny's own player for every viewer."""
    _post(
        library,
        f"/library/{library.bunny_library_id}/videos/{guid}",
        json={"chapters": chapters, "moments": moments},
    )


def set_thumbnail(library, guid: str, thumbnail_url: str) -> None:
    """One of Bunny's frames (thumbnail_1.jpg .. thumbnail_5.jpg) or a public image link."""
    _post(
        library,
        f"/library/{library.bunny_library_id}/videos/{guid}/thumbnail",
        params={"thumbnailUrl": thumbnail_url},
    )


def fetch_video(library, url: str, marker: str) -> str:
    """Bunny downloads the file from `url` itself (a direct video link). The fetch call
    doesn't return the new video's id, so it is created under a unique `marker` title and
    found again by searching for it. Returns the guid."""
    _post(library, f"/library/{library.bunny_library_id}/videos/fetch", json={"url": url, "title": marker})
    for attempt in range(4):
        try:
            with httpx.Client(timeout=httpx.Timeout(10, connect=5)) as client:
                r = client.get(f"{API}/library/{library.bunny_library_id}/videos",
                               params={"search": marker, "itemsPerPage": 5},
                               headers={"AccessKey": _key(library), "accept": "application/json"})  # fmt: skip
            r.raise_for_status()
            match = next((v for v in r.json().get("items") or [] if v.get("title") == marker), None)
        except httpx.HTTPError:
            match = None
        if match:
            return match["guid"]
        time.sleep(1 + attempt)
    raise ServiceError(
        "video_rejected",
        "The video service couldn't fetch that link. Check it is a direct video file.",
        status=502,
    )


def rename_video(library, guid: str, title: str) -> None:
    _post(library, f"/library/{library.bunny_library_id}/videos/{guid}", json={"title": title[:200]})


def add_caption(library, guid: str, *, srclang: str, label: str, content: bytes) -> None:
    _post(library, f"/library/{library.bunny_library_id}/videos/{guid}/captions/{srclang}",
          json={"srclang": srclang, "label": label, "captionsFile": base64.b64encode(content).decode()})  # fmt: skip


def delete_caption(library, guid: str, srclang: str) -> None:
    try:
        with httpx.Client(timeout=httpx.Timeout(15, connect=5)) as client:
            r = client.delete(f"{API}/library/{library.bunny_library_id}/videos/{guid}/captions/{srclang}",
                              headers={"AccessKey": _key(library), "accept": "application/json"})  # fmt: skip
    except httpx.HTTPError as exc:
        raise ServiceError(
            "video_unreachable", "We couldn't reach the video service. Try again.", status=503
        ) from exc
    if r.status_code >= 400 and r.status_code != 404:
        raise ServiceError("video_rejected", "The video service did not accept the change.", status=502)


def _post(library, path: str, **kwargs) -> None:
    try:
        with httpx.Client(timeout=httpx.Timeout(15, connect=5)) as client:
            r = client.post(
                f"{API}{path}", headers={"AccessKey": _key(library), "accept": "application/json"}, **kwargs
            )
    except httpx.HTTPError as exc:
        raise ServiceError(
            "video_unreachable", "We couldn't reach the video service. Try again.", status=503
        ) from exc
    if r.status_code >= 400:
        raise ServiceError("video_rejected", "The video service did not accept the change.", status=502)


def delete_video(library, guid: str) -> None:
    with httpx.Client(timeout=15) as client:
        client.delete(
            f"{API}/library/{library.bunny_library_id}/videos/{guid}", headers={"AccessKey": _key(library)}
        )
