"""Files kept with a company purchase (contract, purchase order, invoice copy...).

Same private Azure container and the same checks as lecture resources and ticket
attachments (apps/catalog/resources.py: allowed types, size limit, safe names):

    1. start_upload   name, type and size checked; a 15-minute write-only link for one blob
    2. (the browser PUTs the file straight to Azure, with progress)
    3. confirm        Azure must confirm the blob arrived and its real size fits

Blobs live under corporate/<org>/<purchase>/. Rows still "uploading" (an upload that
failed or was abandoned) are never listed and can be deleted by whoever started them.
Downloads are 1-hour signed links; the storage credentials never leave the server.

Who may do what (checked by the caller's scope, and RLS keeps every company apart):
  * platform staff: every company's files; may delete any.
  * company owner/admin: their own company's files; may delete files the company
    uploaded, never ones staff added.
  * managers and learners: nothing (these are commercial documents).
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import transaction

from apps.catalog.resources import ALLOWED, _ensure_storage, _safe_name
from apps.platform.services import audit_request
from core import html, storage
from core.errors import ServiceError

from .models import PurchaseAttachment, SeatPurchase


def _prefix(sp: SeatPurchase) -> str:
    return f"corporate/{sp.org_id}/{sp.id}/"


def start_upload(request, sp: SeatPurchase, *, filename: str, size_bytes: int, by_staff: bool) -> dict:
    _ensure_storage()
    limit = settings.RESOURCE_MAX_BYTES
    if size_bytes <= 0 or size_bytes > limit:
        raise ServiceError("file_size", f"Files can be up to {limit // (1024 * 1024)} MB.")
    name, ext = _safe_name(filename)
    content_type, _kind = ALLOWED[ext]
    key = f"{_prefix(sp)}{uuid.uuid4().hex}/{name}"
    att = PurchaseAttachment.objects.create(
        org_id=sp.org_id,
        seat_purchase=sp,
        storage_key=key,
        filename=html.plain(filename, 255) or name,
        mime_type=content_type,
        size_bytes=size_bytes,
        uploaded_by=request.auth,
        uploaded_by_staff=by_staff,
    )
    return {
        "attachment_id": att.id,
        "upload_url": storage.upload_url(key),
        "method": "PUT",
        "headers": {"x-ms-blob-type": "BlockBlob", "Content-Type": content_type},
        "expires_in": 15 * 60,
        "max_bytes": limit,
    }


@transaction.atomic
def confirm(request, attachment_id) -> PurchaseAttachment:
    att = PurchaseAttachment.objects.select_for_update().filter(pk=attachment_id).first()
    if att is None or att.uploaded_by_id != request.auth.id:
        raise ServiceError("attachment_not_found", "File not found.", status=404)
    if att.status == PurchaseAttachment.Status.READY:
        return att
    props = storage.properties(att.storage_key)
    if props is None:
        raise ServiceError("upload_missing", "The file did not finish uploading. Try again.")
    if props["size"] > settings.RESOURCE_MAX_BYTES:
        storage.delete(att.storage_key)
        att.delete()
        raise ServiceError("file_size", "The file is too large.")
    att.status = PurchaseAttachment.Status.READY
    att.size_bytes = props["size"]
    att.save(update_fields=["status", "size_bytes", "updated_at"])
    audit_request(
        request,
        "attachment_added",
        "purchase_attachment",
        att.id,
        data={"purchase": str(att.seat_purchase_id)},
    )
    return att


def listing(sp: SeatPurchase):
    return (
        PurchaseAttachment.objects.filter(seat_purchase=sp, status=PurchaseAttachment.Status.READY)
        .select_related("uploaded_by")
        .order_by("-created_at")
    )


def download_url(att: PurchaseAttachment) -> str:
    if att.status != PurchaseAttachment.Status.READY:
        raise ServiceError("attachment_not_found", "File not found.", status=404)
    _ensure_storage()
    return storage.download_url(att.storage_key, att.filename)


def can_delete(att: PurchaseAttachment, user, *, is_staff: bool) -> bool:
    if is_staff:
        return True
    if att.status == PurchaseAttachment.Status.UPLOADING:
        return att.uploaded_by_id == user.id
    return not att.uploaded_by_staff


@transaction.atomic
def delete(request, att: PurchaseAttachment, *, is_staff: bool) -> None:
    if not can_delete(att, request.auth, is_staff=is_staff):
        raise ServiceError("forbidden", "You cannot delete this file.", status=403)
    key, att_id, purchase = att.storage_key, att.id, att.seat_purchase_id
    att.delete()
    if storage.configured():
        storage.delete(key)
    audit_request(
        request, "attachment_deleted", "purchase_attachment", att_id, data={"purchase": str(purchase)}
    )


def attachment_out(att: PurchaseAttachment, user, *, is_staff: bool) -> dict:
    return {
        "id": att.id,
        "filename": att.filename,
        "mime_type": att.mime_type,
        "size_bytes": att.size_bytes,
        "uploaded_by_name": att.uploaded_by.full_name or att.uploaded_by.email,
        "uploaded_by_staff": att.uploaded_by_staff,
        "uploaded_at": att.created_at,
        "can_delete": can_delete(att, user, is_staff=is_staff),
    }
