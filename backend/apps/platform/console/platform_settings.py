"""Console > Settings (mockup 18): typed platform settings from apps.platform.registry,
saved together (Save / Discard), plus logo and favicon uploads. Every change is audited
with its old and new value."""

from datetime import datetime
from typing import Any

from django.db import transaction
from ninja import Field, Schema

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
