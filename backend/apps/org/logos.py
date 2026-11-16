"""Company logos uploaded from the browser (Company settings -> Branding).

Same pipeline as the platform logo (apps.platform.services branding): the browser PUTs
the file straight to the PRIVATE Azure container with a 15-minute write-only link, then
the server checks what arrived and hands back a stable path on our own API. That path
redirects to a 1-hour signed read link, so no storage credential or long-lived link ever
reaches the browser, and no image bytes live in the database.

Saving the branding (PUT /org/company/branding) is what makes a logo live: an upload on
its own changes nothing, so a failed or abandoned upload never replaces the saved logo.
"""

from __future__ import annotations

import logging
import os
import re
import uuid

from core import storage
from core.errors import ServiceError

logger = logging.getLogger(__name__)

TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
         ".svg": "image/svg+xml"}  # fmt: skip
LIMIT = 1024 * 1024  # 1 MB is plenty for a logo
PUBLIC = "/api/v1/org/logos/"  # + <org_id>/<hex>.<ext>
NAME = re.compile(r"^[0-9a-f]{32}\.(png|jpg|jpeg|webp|svg)$")
# SVG is XML that browsers can run code from: anything active is refused outright
SVG_BAD = re.compile(
    rb"<\s*script|<\s*foreignObject|\son[a-z]+\s*=|javascript:|<\s*iframe|<\s*embed|<\s*object|"
    rb"<!ENTITY|<!DOCTYPE|xlink:href\s*=\s*[\"'](?!#)|\shref\s*=\s*[\"'](?!#)",
    re.IGNORECASE,
)


def _key(org_id, name: str) -> str:
    return f"org-logos/{org_id}/{name}"


def public_path(org_id, name: str) -> str:
    return f"{PUBLIC}{org_id}/{name}"


def is_own_logo(org_id, url: str) -> bool:
    """A logo path this company uploaded (other companies' paths are refused)."""
    prefix = f"{PUBLIC}{org_id}/"
    return url.startswith(prefix) and bool(NAME.match(url[len(prefix) :]))


def start_upload(*, org_id, filename: str, size_bytes: int) -> dict:
    if not storage.configured():
        raise ServiceError("files_unavailable", "File uploads are not set up yet.", status=503)
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in TYPES:
        raise ServiceError("file_type", "Use a PNG, JPG, WebP or SVG image.")
    if size_bytes <= 0 or size_bytes > LIMIT:
        raise ServiceError("file_size", "The logo can be up to 1 MB.")
    name = f"{uuid.uuid4().hex}{'.jpg' if ext == '.jpeg' else ext}"
    return {"key": name, "upload_url": storage.upload_url(_key(org_id, name)), "method": "PUT",
            "headers": {"x-ms-blob-type": "BlockBlob", "Content-Type": TYPES[ext]}}  # fmt: skip


def looks_like(data: bytes, ext: str) -> bool:
    """The file's content, not its name: real image bytes, and an SVG with nothing active."""
    if ext == ".png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if ext == ".jpg":
        return data.startswith(b"\xff\xd8\xff")
    if ext == ".webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    if ext == ".svg":
        head = data[:2048].lstrip(b"\xef\xbb\xbf \t\r\n")
        return (
            (head.startswith(b"<svg") or head.startswith(b"<?xml"))
            and b"<svg" in data
            and not SVG_BAD.search(data)
        )
    return False


def confirm(*, org_id, name: str) -> str:
    """Check the uploaded file and return its path. Anything wrong is deleted."""
    if not NAME.match(name or ""):
        raise ServiceError("bad_key", "Upload the logo again.")
    key = _key(org_id, name)
    props = storage.properties(key)
    if props is None:
        raise ServiceError("upload_missing", "The logo did not finish uploading. Try again.")
    if props["size"] > LIMIT:
        storage.delete(key)
        raise ServiceError("file_size", "The logo can be up to 1 MB.")
    if not looks_like(storage.read(key, LIMIT), os.path.splitext(name)[1]):
        storage.delete(key)
        raise ServiceError(
            "file_type", "That file is not a valid image (or the SVG contains scripts or links)."
        )
    return public_path(org_id, name)


def signed(org_id, name: str) -> str:
    if not NAME.match(name) or not storage.configured():
        raise ServiceError("not_found", "Not found.", status=404)
    return storage.download_url(_key(org_id, name))


def forget(org_id, old_url: str, new_url: str) -> None:
    """After a save: the previous uploaded logo is no longer used, so remove the file."""
    if old_url and old_url != new_url and is_own_logo(org_id, old_url):
        try:
            storage.delete(_key(org_id, old_url.rsplit("/", 1)[-1]))
        except Exception:  # noqa: BLE001 - a leftover file is harmless; the save must not fail
            logger.warning("old company logo not deleted", extra={"org_id": str(org_id)})
