"""Certificate files kept with a qualification a company awarded to a person.

The certificate PDF or image is the *evidence* that someone really holds a
qualification (a scanned First Aid card, a signed NVQ certificate...). It lives in
the same private Azure container as lecture files and purchase attachments, and uses
the very same browser -> Azure upload, so nothing streams through our servers:

    1. start_upload   name/type/size checked; an 'awaiting_upload' MediaAsset is made
                      and a 15-minute, write-only link for that one blob is returned
    2. (the browser PUTs the file straight to Azure)
    3. verify         Azure must confirm the blob arrived and its real size/type fit;
                      the asset is then attached to the MemberQualification
    4. download_url   1-hour, read-only link that always downloads

Only PDFs and images are allowed (a certificate is never a spreadsheet). Blobs live
under qualifications/<org>/<member>/. MediaAsset writes go through `authoring()`
because media_assets is a content table (RLS policy content_*).
"""

from __future__ import annotations

import os
import uuid
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.catalog.models import MediaAsset
from apps.catalog.resources import ALLOWED, _ensure_storage, _safe_name
from apps.catalog.services import authoring
from apps.org.models import OrgMember
from core import html, storage
from core.errors import ServiceError

# A certificate is a scan or a photo, never a spreadsheet or an archive.
CERT_KINDS = ("image", "document")


def _prefix(org_id: UUID, member_id: UUID) -> str:
    return f"qualifications/{org_id}/{member_id}/"


def start_upload(*, org_id: UUID, member: OrgMember, user, filename: str, size_bytes: int) -> dict:
    """Check the file and hand back a write-only link straight to Azure."""
    _ensure_storage()
    limit = settings.RESOURCE_MAX_BYTES
    if size_bytes <= 0 or size_bytes > limit:
        raise ServiceError("file_size", f"Files can be up to {limit // (1024 * 1024)} MB.")
    name, ext = _safe_name(filename)
    content_type, kind = ALLOWED[ext]
    if kind not in CERT_KINDS:
        raise ServiceError("file_type", "A certificate must be a PDF or an image (PNG, JPG, WebP).")
    key = f"{_prefix(org_id, member.id)}{uuid.uuid4().hex}/{name}"
    with transaction.atomic(), authoring():
        asset = MediaAsset.objects.create(
            kind=kind,
            status=MediaAsset.Status.AWAITING_UPLOAD,
            uploaded_by=user,
            owner_org_id=org_id,
            storage_key=key,
            mime_type=content_type,
            original_filename=html.plain(filename, 255),
            size_bytes=size_bytes,
        )
    return {
        "asset_id": asset.id,
        "upload_url": storage.upload_url(key),
        "method": "PUT",
        "headers": {"x-ms-blob-type": "BlockBlob", "Content-Type": content_type},
        "expires_in": 15 * 60,
        "max_bytes": limit,
    }


def verify(*, org_id: UUID, asset_id: UUID, user) -> MediaAsset:
    """Confirm the blob really arrived (Azure's word, not the browser's) and return the
    READY asset. Raises if the upload is missing or does not match its type/size."""
    asset = MediaAsset.objects.filter(
        pk=asset_id,
        uploaded_by=user,
        owner_org_id=org_id,
        kind__in=CERT_KINDS,
        storage_key__startswith=f"qualifications/{org_id}/",
    ).first()
    if asset is None:
        raise ServiceError("not_found", "Upload not found.", status=404)
    if asset.status == MediaAsset.Status.AWAITING_UPLOAD:
        found = storage.properties(asset.storage_key)
        if found is None:
            raise ServiceError("not_uploaded", "The file has not finished uploading.")
        content_type = found["content_type"].split(";")[0].strip().lower()
        ok = 0 < found["size"] <= settings.RESOURCE_MAX_BYTES and content_type == asset.mime_type
        with transaction.atomic(), authoring():
            MediaAsset.objects.filter(pk=asset.pk, status=MediaAsset.Status.AWAITING_UPLOAD).update(
                status=MediaAsset.Status.READY if ok else MediaAsset.Status.FAILED,
                size_bytes=found["size"],
                updated_at=timezone.now(),
            )
        if not ok:
            storage.delete(asset.storage_key)
            raise ServiceError("file_rejected", "The uploaded file did not match its type or size limit.")
        asset.refresh_from_db()
    if asset.status != MediaAsset.Status.READY:
        raise ServiceError("file_rejected", "This upload cannot be used.")
    return asset


def download_url(asset: MediaAsset) -> str:
    _ensure_storage()
    filename = asset.original_filename or os.path.basename(asset.storage_key)
    return storage.download_url(asset.storage_key, filename)
