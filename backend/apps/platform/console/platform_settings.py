"""Console > Settings (mockup 18): typed platform settings from apps.platform.registry,
saved together (Save / Discard), plus logo and favicon uploads. Every change is audited
with its old and new value."""

from datetime import datetime
from typing import Any
from uuid import UUID

from django.db import transaction
from django.utils import timezone
from ninja import Field, Schema

from apps.identity.models import User
from core.errors import ServiceError

from .. import registry, services
from ..models import Setting
from ..services import audit_request
from .common import ConsoleOkOut, router, staff


class ConsoleSettingIn(Schema):
    value: dict | list | str | int | float | bool
    description: str = Field("", max_length=300)
    is_public: bool | None = None


class ConsoleSettingsSaveIn(Schema):
    values: dict[str, Any]


class ConsoleSettingDefOut(Schema):
    key: str
    label: str
    group: str
    kind: str
    value: Any
    default: Any
    public: bool
    min: int | None
    max: int | None
    max_len: int
    choices: list[str]
    updated_at: datetime | None
    updated_by: str | None


class ConsoleSettingsOut(Schema):
    settings: list[ConsoleSettingDefOut]


class ConsoleSettingsSavedOut(Schema):
    changed: list[str]


class ConsoleBrandingUploadIn(Schema):
    filename: str = Field(..., min_length=1, max_length=255)
    size_bytes: int = Field(..., ge=1)


class ConsoleBrandingUploadOut(Schema):
    key: str
    upload_url: str
    method: str
    headers: dict[str, str]
    expires_in: int


class ConsoleBrandingConfirmIn(Schema):
    key: str = Field(..., max_length=200)


class ConsoleBrandingOut(Schema):
    url: str


class ConsoleStaffOut(Schema):
    id: UUID
    name: str
    email: str
    role: str
    active: bool
    joined_at: datetime
    last_login: datetime | None
    is_self: bool


class ConsoleStaffGrantIn(Schema):
    email: str = Field(..., min_length=3, max_length=320)


def _all() -> list[dict]:
    rows = {
        s.key: s for s in Setting.objects.filter(key__in=list(registry.BY_KEY)).select_related("updated_by")
    }
    out = []
    for d in registry.SETTINGS:
        row = rows.get(d.key)
        out.append({
            "key": d.key, "label": d.label, "group": d.group, "kind": d.kind,
            "value": row.value if row else d.default, "default": d.default, "public": d.public, "min": d.min,
            "max": d.max, "max_len": d.max_len, "choices": list(d.choices),
            "updated_at": row.updated_at if row else None,
            "updated_by": (row.updated_by.full_name or row.updated_by.email) if row and row.updated_by else None,
        })  # fmt: skip
    return out


def _staff_row(user: User, request) -> dict:
    return {
        "id": user.id,
        "name": user.full_name or user.email,
        "email": user.email,
        "role": "platform_admin",
        "active": user.is_active,
        "joined_at": user.created_at,
        "last_login": user.last_login,
        "is_self": user.id == request.user.id,
    }


@router.get("/settings", response=ConsoleSettingsOut)
def settings_list(request):
    """Every registered setting with its current value (or default) and limits."""
    staff(request)
    return {"settings": _all()}


@router.put("/settings", response=ConsoleSettingsSavedOut)
def save_settings(request, body: ConsoleSettingsSaveIn):
    """Save several settings at once: all are checked first, so nothing is half-saved."""
    staff(request)
    current = {d["key"]: d["value"] for d in _all()}
    unknown = [k for k in body.values if k not in registry.BY_KEY]
    if unknown:
        raise ServiceError("bad_key", f"Unknown setting: {', '.join(sorted(unknown))}.")
    clean = {k: registry.validate(k, v) for k, v in body.values.items()}
    changed = [k for k, v in clean.items() if current.get(k) != v]
    with transaction.atomic():
        for key in changed:
            services.set_setting(
                key=key, value=clean[key], by=request.user, is_public=registry.BY_KEY[key].public
            )
            audit_request(
                request, "setting.update", "setting", key, {"from": current.get(key), "to": clean[key]}
            )
    return {"changed": changed}


@router.get("/settings/staff", response=list[ConsoleStaffOut])
def staff_list(request):
    staff(request)
    return [
        _staff_row(user, request)
        for user in User.objects.filter(is_staff=True).order_by("full_name", "email")
    ]


@router.post("/settings/staff", response=ConsoleStaffOut)
def grant_staff(request, body: ConsoleStaffGrantIn):
    staff(request)
    email = body.email.strip().lower()
    user = User.objects.filter(email=email, anonymized_at__isnull=True).first()
    if user is None:
        raise ServiceError(
            "user_not_found", "Create the account first, then grant platform access.", status=404
        )
    if not user.is_active:
        raise ServiceError("inactive_user", "Reactivate this account before granting platform access.")
    if not user.is_staff:
        User.objects.filter(pk=user.pk).update(is_staff=True, updated_at=timezone.now())
        user.is_staff = True
        audit_request(
            request, "staff.grant", "user", str(user.id), {"email": user.email, "role": "platform_admin"}
        )
    return _staff_row(user, request)


@router.post("/settings/staff/{user_id}/remove", response=ConsoleOkOut)
def remove_staff(request, user_id: UUID):
    staff(request)
    user = User.objects.filter(pk=user_id, is_staff=True).first()
    if user is None:
        raise ServiceError("staff_not_found", "That platform administrator no longer exists.", status=404)
    if user.id == request.user.id:
        raise ServiceError("self", "You cannot remove your own platform access.")
    if User.objects.filter(is_staff=True, is_active=True).count() <= 1:
        raise ServiceError("last_staff", "Keep at least one active platform administrator.")
    User.objects.filter(pk=user.pk).update(is_staff=False, updated_at=timezone.now())
    audit_request(
        request, "staff.remove", "user", str(user.id), {"email": user.email, "role": "platform_admin"}
    )
    return {"ok": True}


@router.put("/settings/{key}", response=ConsoleOkOut)
def set_setting(request, key: str, body: ConsoleSettingIn):
    staff(request)
    if not key.replace(".", "").replace("_", "").isalnum() or len(key) > 100:
        raise ServiceError("bad_key", "Keys use letters, digits, dots and underscores.")
    old = services.get_setting(key)
    services.set_setting(key=key, value=body.value, by=request.user, description=body.description,
                         is_public=body.is_public)  # fmt: skip
    audit_request(request, "setting.update", "setting", key, {"from": old, "to": body.value})
    return {"ok": True}


@router.post("/settings/branding/{kind}/upload", response=ConsoleBrandingUploadOut)
def branding_upload(request, kind: str, body: ConsoleBrandingUploadIn):
    staff(request)
    return services.start_branding_upload(kind=kind, filename=body.filename, size_bytes=body.size_bytes)


@router.post("/settings/branding/{kind}/confirm", response=ConsoleBrandingOut)
def branding_confirm(request, kind: str, body: ConsoleBrandingConfirmIn):
    staff(request)
    url = services.confirm_branding(kind=kind, key=body.key, by=request.user)
    audit_request(request, "setting.branding", "setting", f"general.{kind}_url", {"uploaded": True})
    return {"url": url}


@router.post("/settings/branding/{kind}/remove", response=ConsoleOkOut)
def branding_remove(request, kind: str):
    staff(request)
    services.remove_branding(kind=kind, by=request.user)
    audit_request(request, "setting.branding", "setting", f"general.{kind}_url", {"removed": True})
    return {"ok": True}
