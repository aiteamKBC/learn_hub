"""Bunny Stream status -> MediaAsset (via the platform outbox, after the webhook was verified).

Bunny status codes: 0 queued, 1 processing, 2 encoding, 3 finished, 4 resolution finished
(first quality playable), 5 failed, 6 upload started, 7 upload finished, 8 upload failed,
9 captions generated, 10 title/description generated.
https://docs.bunny.net/docs/stream-webhook
"""

import hashlib
import os
import time

from django.core.cache import cache
from django.utils import timezone

from core.errors import ServiceError
from core.tenancy import tenant_context

from .models import MediaAsset

S = MediaAsset.Status
STATUS = {0: S.PROCESSING, 1: S.PROCESSING, 2: S.PROCESSING, 3: S.READY, 4: S.PLAYABLE, 5: S.FAILED,
          6: S.AWAITING_UPLOAD, 7: S.PROCESSING, 8: S.FAILED}  # fmt: skip
RANK = {S.AWAITING_UPLOAD: 0, S.PROCESSING: 1, S.PLAYABLE: 2, S.READY: 3, S.FAILED: 3}


# Bunny's REST API uses its own codes: 0 created, 1 uploaded, 2 processing, 3 transcoding,
# 4 finished, 5 error, 6 upload failed. https://docs.bunny.net/reference/video_getvideo
API_STATUS = {0: S.AWAITING_UPLOAD, 1: S.PROCESSING, 2: S.PROCESSING, 3: S.PROCESSING, 4: S.READY, 5: S.FAILED,
              6: S.FAILED}  # fmt: skip


def sync_from_bunny(asset: MediaAsset) -> MediaAsset:
    """The builder's fallback when Bunny's webhook can't reach us (a laptop, or a webhook
    not set up yet): ask Bunny about the video while someone is watching its status.
    Forward-only like the webhook; at most once per 5 s per video."""
    from . import bunny

    if asset.status in (S.READY, S.FAILED) or not asset.bunny_video_guid or asset.library is None:
        return asset
    if not cache.add(f"bunny-sync:{asset.id}", 1, timeout=5):
        return asset
    try:
        v = bunny.get_video(asset.library, str(asset.bunny_video_guid))
    except ServiceError:  # unreachable or not configured: keep what we have, the next poll retries
        return asset
    new = API_STATUS.get(int(v.get("status", -1)))
    if new == S.PROCESSING and v.get("availableResolutions"):
        new = S.PLAYABLE  # a first quality can already be played
    fields = {"encode_progress": max(asset.encode_progress, min(100, int(v.get("encodeProgress") or 0)))}
    if v.get("length"):
        fields["duration_sec"] = int(v["length"])
    if new and (RANK[new] > RANK[asset.status] or new == S.FAILED):
        fields["status"] = new
        if new == S.READY:
            fields["encode_progress"] = 100
    with tenant_context(staff=True):
        MediaAsset.objects.filter(pk=asset.pk).update(updated_at=timezone.now(), **fields)
        if fields.get("duration_sec") and not asset.duration_sec:
            fill_lecture_lengths(asset.pk, fields["duration_sec"])
    for k, val in fields.items():
        setattr(asset, k, val)
    return asset


def fill_lecture_lengths(asset_id, seconds: int) -> int:
    """Lectures that got this video before Bunny knew its length were saved with 0:
    give them Bunny's length (only those still at 0; a length set by hand stays)."""
    from .models import Lecture
    from .services import authoring

    with authoring():
        return Lecture.objects.filter(video_id=asset_id, duration_sec=0).update(duration_sec=seconds)


# ---------------------------------------------------------------- parts, key moments, thumbnails
META_TTL_SEC = 10 * 60
THUMB_FRAMES = [f"thumbnail_{i}.jpg" for i in range(1, 6)]  # Bunny's auto-generated frames


def _meta_key(asset) -> str:
    return f"bunny-meta:{asset.bunny_video_guid}"


def video_meta(asset: MediaAsset | None) -> dict:
    """The video's parts (Bunny chapters) and key moments, from Bunny, cached for 10 min
    (the learner's player asks on every lecture). Empty when Bunny can't be reached."""
    from . import bunny

    empty = {"parts": [], "moments": [], "resolutions": [], "captions": []}
    if asset is None or not asset.bunny_video_guid or asset.library is None:
        return empty
    meta = cache.get(_meta_key(asset))
    if meta is None:
        try:
            v = bunny.get_video(asset.library, str(asset.bunny_video_guid))
        except ServiceError:
            return empty  # not cached: the next request tries again
        meta = {
            "parts": sorted(({"title": c.get("title") or "", "start": int(c.get("start") or 0)}
                             for c in v.get("chapters") or []), key=lambda c: c["start"]),
            "moments": sorted(({"label": m.get("label") or "", "timestamp": int(m.get("timestamp") or 0)}
                               for m in v.get("moments") or []), key=lambda m: m["timestamp"]),
            # for the builder: encoded qualities and subtitle tracks
            "resolutions": [r for r in (v.get("availableResolutions") or "").split(",") if r],
            "captions": [{"srclang": c.get("srclang") or "", "label": c.get("label") or ""} for c in v.get("captions") or []],
        }  # fmt: skip
        cache.set(_meta_key(asset), meta, META_TTL_SEC)
    return meta


def save_parts_and_moments(asset: MediaAsset, *, parts: list[dict], moments: list[dict]) -> dict:
    """Validates and saves to Bunny. Each part runs until the next one starts (the last to
    the end of the video), which is how Bunny draws chapters."""
    from core import html

    from . import bunny

    length = asset.duration_sec or 0
    parts = sorted(({"title": html.plain(p["title"], 255).strip(), "start": int(p["start"])} for p in parts),
                   key=lambda p: p["start"])  # fmt: skip
    moments = sorted(({"label": html.plain(m["label"], 255).strip(), "timestamp": int(m["timestamp"])}
                      for m in moments), key=lambda m: m["timestamp"])  # fmt: skip
    for p in parts:
        if not p["title"]:
            raise ServiceError("part_title", "Every part needs a name.")
        if length and p["start"] >= length:
            raise ServiceError("part_start", f"“{p['title']}” starts after the video ends.")
    if len({p["start"] for p in parts}) != len(parts):
        raise ServiceError("part_start", "Two parts can't start at the same second.")
    for m in moments:
        if not m["label"]:
            raise ServiceError("moment_label", "Every key moment needs a label.")
        if length and m["timestamp"] > length:
            raise ServiceError("moment_time", f"“{m['label']}” is after the video ends.")
    chapters = [{"title": p["title"], "start": p["start"],
                 "end": parts[i + 1]["start"] if i + 1 < len(parts) else max(length, p["start"] + 1)}
                for i, p in enumerate(parts)]  # fmt: skip
    bunny.update_video(asset.library, str(asset.bunny_video_guid), chapters=chapters, moments=moments)
    meta = {
        **(cache.get(_meta_key(asset)) or {"resolutions": [], "captions": []}),
        "parts": parts,
        "moments": moments,
    }
    cache.set(_meta_key(asset), meta, META_TTL_SEC)  # learners see the new parts straight away
    return {"parts": parts, "moments": moments}


def forget_meta(asset: MediaAsset) -> None:
    cache.delete(_meta_key(asset))


CAPTION_MAX_BYTES = 1024 * 1024


def add_caption(asset: MediaAsset, *, srclang: str, label: str, content: str) -> None:
    """Subtitles (.srt / .vtt). The one upload that passes through our server: Bunny only
    takes captions through its keyed API. Small text files only, never stored by us."""
    from core import html

    from . import bunny

    data = content.encode()
    if len(data) > CAPTION_MAX_BYTES:
        raise ServiceError("caption_size", "Subtitle files can be up to 1 MB.")
    if "-->" not in content:
        raise ServiceError("caption_format", "That doesn't look like an .srt or .vtt subtitle file.")
    bunny.add_caption(asset.library, str(asset.bunny_video_guid), srclang=srclang.lower(),
                      label=html.plain(label, 60).strip() or srclang, content=data)  # fmt: skip
    forget_meta(asset)


def delete_caption(asset: MediaAsset, srclang: str) -> None:
    from . import bunny

    bunny.delete_caption(asset.library, str(asset.bunny_video_guid), srclang.lower())
    forget_meta(asset)


def thumbnails(asset: MediaAsset) -> dict:
    """Links to the current thumbnail and Bunny's 5 frames. The pull zone allows our site
    as a referrer, so the <img> tags must send one (no token in these links)."""
    base = f"https://{asset.library.cdn_hostname}/{asset.bunny_video_guid}"
    return {
        "current": f"{base}/thumbnail.jpg",
        "frames": [{"name": f, "url": f"{base}/{f}"} for f in THUMB_FRAMES],
    }


def set_thumbnail(asset: MediaAsset, choice: str) -> None:
    from . import bunny

    if choice not in THUMB_FRAMES and not choice.startswith("https://"):
        raise ServiceError("bad_thumbnail", "Pick one of the frames, or use an https:// image link.")
    bunny.set_thumbnail(asset.library, str(asset.bunny_video_guid), choice)


def apply_bunny_status(payload: dict) -> None:
    """Idempotent and order-safe: webhooks can arrive late or twice, so status only moves
    forward (a late 'encoding' never downgrades a ready video). 9/10 are informational."""
    new = STATUS.get(int(payload["status"]))
    with tenant_context(staff=True):
        asset = MediaAsset.objects.select_for_update().filter(bunny_video_guid=payload["video_guid"]).first()
        if asset is None:
            return  # not ours (another environment sharing the library)
        fields = {"bunny_status": int(payload["status"]), "updated_at": timezone.now()}
        if new and (RANK[new] > RANK[asset.status] or new == S.FAILED and asset.status != S.READY):
            fields["status"] = new
            if new == S.READY:
                fields["encode_progress"] = 100
        MediaAsset.objects.filter(pk=asset.pk).update(**fields)
    from apps.platform.services import mark_webhook_processed

    mark_webhook_processed(payload.get("provider", "bunny"), payload.get("dedupe_key", ""))


# ---------------------------------------------------------------- playback
PLAYBACK_TTL_SEC = 2 * 60 * 60


def playback(asset: MediaAsset | None) -> dict | None:
    """A signed Bunny embed URL, valid for 2 hours. The token key stays on the server:
    token = SHA256_hex(token_key + video_guid + expires). https://docs.bunny.net/docs/stream-embed-token-authentication
    Demo assets without a real Bunny video return a placeholder so the player can say so."""
    if asset is None:
        return None
    if not asset.bunny_video_guid or asset.library is None:
        return {"kind": "placeholder", "url": None, "expires_at": None, "duration_sec": asset.duration_sec}
    expires = int(time.time()) + PLAYBACK_TTL_SEC
    key = os.getenv(asset.library.token_key_env, "")
    guid = str(asset.bunny_video_guid)
    url = f"https://iframe.mediadelivery.net/embed/{asset.library.bunny_library_id}/{guid}"
    if key:
        token = hashlib.sha256(f"{key}{guid}{expires}".encode()).hexdigest()
        url += f"?token={token}&expires={expires}"
    return {"kind": "bunny", "url": url, "expires_at": expires, "duration_sec": asset.duration_sec}
