"""Settings, entitlements, audit log and inbound webhooks (platform)."""

import json
import logging

from django.conf import settings as dj
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from core import cache
from core.middleware import request_id_var
from core.tenancy import tenant_context

from . import outbox, registry
from .models import Entitlement, Setting, WebhookEvent

log = logging.getLogger(__name__)
_MISSING = "__missing__"  # cached marker for "no such setting" (survives pickling)


# ---------------------------------------------------------------- settings
def _load_setting(key: str):
    row = Setting.objects.filter(key=key).values_list("value", flat=True)[:1]
    return row[0] if row else _MISSING  # a stored False / 0 / "" is a real value


def get_setting(key: str, default=None):
    """Cached for 60 s; set_setting() invalidates at once. A registered setting with no
    row yet falls back to its registry default (apps.platform.registry)."""
    value = cache.get_or_set("setting", key, lambda: _load_setting(key), timeout=60)
    if value == _MISSING:
        return registry.default(key) if default is None else default
    return value


def set_setting(*, key: str, value, by, description: str = "", is_public: bool | None = None) -> Setting:
    """Staff only (RLS: reference table)."""
    value = registry.validate(key, value)
    defaults = {"value": value, "updated_by": by}
    if description:
        defaults["description"] = description
    if is_public is not None:
        defaults["is_public"] = is_public
    row, _ = Setting.objects.update_or_create(key=key, defaults=defaults)
    cache.bump("setting", key)
    return row


def public_settings() -> dict:
    """Registered public settings (with their defaults) plus any other row marked public."""
    out = {d.key: d.default for d in registry.SETTINGS if d.public}
    stored = dict(Setting.objects.filter(key__in=list(out)).values_list("key", "value"))
    out.update(stored)
    others = Setting.objects.filter(is_public=True).exclude(key__in=list(registry.BY_KEY))
    out.update(dict(others.values_list("key", "value")))  # registered keys follow the registry only
    return out


# ---------------------------------------------------------------- entitlements
def has_feature(feature: str, *, org_id=None, user_id=None, now=None) -> bool:
    now = now or timezone.now()
    qs = Entitlement.objects.filter(feature=feature, starts_at__lte=now).exclude(ends_at__lte=now)
    qs = qs.filter(org_id=org_id) if org_id else qs.filter(user_id=user_id)
    return qs.exists()


def seats(feature: str, *, org_id, now=None) -> int:
    now = now or timezone.now()
    rows = Entitlement.objects.filter(org_id=org_id, feature=feature, starts_at__lte=now).exclude(
        ends_at__lte=now
    )
    return sum(r or 0 for r in rows.values_list("seats", flat=True))


def sync_entitlement(*, feature: str, source: str, source_ref, active: bool, ends_at, org_id=None, user_id=None,
                     seats_count=None) -> None:  # fmt: skip
    """Called from verified payment webhooks (commerce). One row per subscription,
    updated in place: active -> until period end; cancelled -> ends now."""
    now = timezone.now()
    with tenant_context(staff=True):
        Entitlement.objects.update_or_create(
            feature=feature, source=source, source_ref=source_ref,
            defaults={"org_id": org_id, "user_id": user_id, "seats": seats_count, "starts_at": now,
                      "ends_at": ends_at if active else now},
        )  # fmt: skip


def grant(
    *, feature: str, by, org_id=None, user_id=None, ends_at=None, seats_count=None, note: str = ""
) -> Entitlement:
    """Staff: e.g. a free pilot of content protection for a prospect."""
    ent = Entitlement.objects.create(
        feature=feature, source=Entitlement.Source.GRANT, org_id=org_id, user_id=user_id, seats=seats_count,
        starts_at=timezone.now(), ends_at=ends_at, note=note[:300],
    )  # fmt: skip
    audit(
        "entitlement.grant", "entitlement", ent.id, actor_id=by.id, org_id=org_id, data={"feature": feature}
    )
    return ent


# ---------------------------------------------------------------- audit log
def client_ip(request) -> str | None:
    """The real client IP behind NINJA_NUM_PROXIES trusted proxies (never trust more)."""
    hops = dj.NINJA_NUM_PROXIES
    forwarded = [p.strip() for p in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",") if p.strip()]
    if hops and len(forwarded) >= hops:
        return forwarded[-hops]
    return request.META.get("REMOTE_ADDR")


def audit(
    action: str, target_type: str, target_id, *, actor_id=None, org_id=None, data=None, ip=None
) -> None:
    """Append one line. Plain INSERT: the app role can add lines but never read others'
    (outside its company), change or delete them."""
    with connection.cursor() as cur:
        cur.execute(
            "INSERT INTO platform.audit_logs (actor_id, org_id, action, target_type, target_id, ip, request_id, data)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)",
            [actor_id, org_id, action[:80], target_type[:60], str(target_id)[:64], ip, request_id_var.get()[:64],
             json.dumps(data or {}, cls=DjangoJSONEncoder)],
        )  # fmt: skip


def audit_request(request, action: str, target_type: str, target_id, data=None) -> None:
    user = getattr(request, "user", None)
    audit(action, target_type, target_id, actor_id=user.id if user and user.is_authenticated else None,
          org_id=getattr(request, "org_id", None), data=data, ip=client_ip(request))  # fmt: skip


# ---------------------------------------------------------------- inbound webhooks
@transaction.atomic
def receive_webhook(*, provider: str, dedupe_key: str, payload: dict, topic: str) -> bool:
    """Store once and hand to the outbox. Returns False for a duplicate delivery."""
    with tenant_context(staff=True):
        try:
            with transaction.atomic():
                WebhookEvent.objects.create(provider=provider, dedupe_key=dedupe_key[:200], payload=payload)
        except IntegrityError:
            return False
        outbox.publish(topic, {"provider": provider, "dedupe_key": dedupe_key, **payload})
    return True


def mark_webhook_processed(provider: str, dedupe_key: str) -> None:
    with tenant_context(staff=True):
        WebhookEvent.objects.filter(provider=provider, dedupe_key=dedupe_key[:200]).update(
            processed_at=timezone.now()
        )


# ---------------------------------------------------------------- branding (logo, favicon)
BRANDING = {  # kind: (setting with the public path, allowed extensions, max bytes)
    "logo": ("general.logo_url", {".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp",
                                  ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}, 2 * 1024 * 1024),
    "favicon": ("general.favicon_url", {".ico": "image/x-icon", ".png": "image/png", ".svg": "image/svg+xml"},
                512 * 1024),
}  # fmt: skip


def _branding(kind: str):
    from core.errors import ServiceError

    if kind not in BRANDING:
        raise ServiceError("not_found", "Not found.", status=404)
    return BRANDING[kind]


def start_branding_upload(*, kind: str, filename: str, size_bytes: int) -> dict:
    """A 15-minute write-only link for the new logo or favicon (private container)."""
    import os
    import uuid

    from core import storage
    from core.errors import ServiceError

    _, types, limit = _branding(kind)
    if not storage.configured():
        raise ServiceError("files_unavailable", "File uploads are not configured.", status=503)
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in types:
        raise ServiceError("file_type", f"Use {', '.join(e.lstrip('.').upper() for e in types)}.")
    if size_bytes <= 0 or size_bytes > limit:
        raise ServiceError("file_size", f"Files can be up to {limit // 1024} KB.")
    key = f"branding/{kind}/{uuid.uuid4().hex}{ext}"
    return {"key": key, "upload_url": storage.upload_url(key), "method": "PUT",
            "headers": {"x-ms-blob-type": "BlockBlob", "Content-Type": types[ext]}, "expires_in": 900}  # fmt: skip


def confirm_branding(*, kind: str, key: str, by) -> str:
    """Use the uploaded file: Azure must confirm it arrived. Returns the public path."""
    from core import storage
    from core.errors import ServiceError

    setting, _, limit = _branding(kind)
    if not key.startswith(f"branding/{kind}/") or ".." in key or len(key) > 200:
        raise ServiceError("bad_key", "Upload the file again.")
    props = storage.properties(key)
    if props is None:
        raise ServiceError("upload_missing", "The file did not finish uploading. Try again.")
    if props["size"] > limit:
        raise ServiceError("file_size", "The file is too large.")
    set_setting(key=f"branding.{kind}_key", value=key, by=by, description=f"Uploaded {kind}", is_public=False)
    path = f"{registry.BRANDING_PATH}{kind}?v={key.rsplit('/', 1)[-1].split('.')[0][:12]}"
    set_setting(key=setting, value=path, by=by)
    return path


def remove_branding(*, kind: str, by) -> None:
    setting, _, _ = _branding(kind)
    set_setting(key=setting, value="", by=by)
    set_setting(key=f"branding.{kind}_key", value="", by=by, is_public=False)


def branding_url(kind: str) -> str:
    """A 1-hour signed link to the uploaded file (404 when there is none)."""
    from core import storage
    from core.errors import ServiceError

    _branding(kind)
    key = get_setting(f"branding.{kind}_key", "")
    if not key or not storage.configured():
        raise ServiceError("not_found", "No file uploaded.", status=404)
    return storage.download_url(key)
