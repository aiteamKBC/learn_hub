"""Files attached to support tickets, in the same private Azure container as lecture files
and with the same checks (apps/catalog/resources.py):

    1. start_attachment  staff ask to attach a file to a ticket; name, type and size are
                         checked; a 15-minute, write-only link for one blob comes back
    2. (browser PUTs the file straight to Azure)
    3. claim_attachment  the reply names the upload: it must be the author's own, for this
                         ticket, and Azure must confirm it arrived

Blobs live under tickets/<ticket id>/. Downloads are 1-hour signed links for the
requester (never for internal notes: RLS hides those rows) and staff.
"""

import uuid

from django.conf import settings
from django.db import transaction

from apps.catalog.models import MediaAsset
from apps.catalog.resources import ALLOWED, FILE_KINDS, _ensure_storage, _safe_name
from apps.catalog.services import authoring
from core import html, storage
from core.errors import ServiceError

from .models import Ticket, TicketMessage


def _prefix(ticket: Ticket) -> str:
    return f"tickets/{ticket.id}/"


def start_attachment(*, ticket: Ticket, user, filename: str, size_bytes: int) -> dict:
    if not user.is_staff and user.id != ticket.user_id:
        raise ServiceError("forbidden", "You cannot attach files to this ticket.", status=403)
    _ensure_storage()
    if size_bytes <= 0 or size_bytes > settings.RESOURCE_MAX_BYTES:
        raise ServiceError(
            "file_size", f"Files can be up to {settings.RESOURCE_MAX_BYTES // (1024 * 1024)} MB."
        )
    name, ext = _safe_name(filename)
    content_type, kind = ALLOWED[ext]
    key = f"{_prefix(ticket)}{uuid.uuid4().hex}/{name}"
    with transaction.atomic(), authoring():
        asset = MediaAsset.objects.create(
            kind=kind, status=MediaAsset.Status.AWAITING_UPLOAD, uploaded_by=user, storage_key=key,
            mime_type=content_type, original_filename=html.plain(filename, 255), size_bytes=size_bytes,
        )  # fmt: skip
    return {
        "asset_id": asset.id,
        "upload_url": storage.upload_url(key),
        "method": "PUT",
        "headers": {"x-ms-blob-type": "BlockBlob", "Content-Type": content_type},
        "expires_in": 15 * 60,
        "max_bytes": settings.RESOURCE_MAX_BYTES,
    }


def claim_attachment(*, ticket: Ticket, user, asset_id) -> MediaAsset:
    asset = MediaAsset.objects.filter(
        pk=asset_id, uploaded_by=user, kind__in=FILE_KINDS, storage_key__startswith=_prefix(ticket)
    ).first()
    if asset is None or TicketMessage.objects.filter(attachment=asset).exists():
        raise ServiceError("bad_attachment", "Upload the file again.")
    props = storage.properties(asset.storage_key)
    if props is None:
        raise ServiceError("upload_missing", "The file did not finish uploading. Try again.")
    if props["size"] > settings.RESOURCE_MAX_BYTES:
        raise ServiceError("file_size", "The file is too large.")
    with authoring():
        MediaAsset.objects.filter(pk=asset.pk).update(
            status=MediaAsset.Status.READY, size_bytes=props["size"]
        )
    return asset


def attachment_out(message: TicketMessage) -> dict | None:
    a = message.attachment
    if a is None:
        return None
    return {"id": a.id, "name": a.original_filename or "file", "size_bytes": a.size_bytes or 0}


def download_link(message: TicketMessage) -> str:
    a = message.attachment
    if a is None or not a.storage_key:
        raise ServiceError("not_found", "No file on this message.", status=404)
    _ensure_storage()
    return storage.download_url(a.storage_key, a.original_filename or None)
