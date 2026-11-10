"""Certificate templates (mockup 30): the design a course's certificates are drawn with.

Platform templates are made by staff and are active at once. Instructors' templates wait
for staff approval (status pending); editing one sends it back for approval. A course
uses its own template when that template is active, otherwise the platform default
(see `template_for`). The layout is a small, validated JSON document that the PDF
renderer (learning.certificate_pdf) and the browser preview both read.
"""

import re

from django.db import transaction
from django.db.models import Q

from core import html
from core.errors import ServiceError

from .models import CertificateTemplate, Course, CourseInstructor
from .services import _tell_staff, authoring

STYLES = ("classic", "modern", "minimal")
LAYOUT_DEFAULTS: dict = {
    "style": "classic",  # border and decoration
    "primary": "#4F46E5",  # headings and border
    "accent": "#F59E0B",  # seal and highlights
    "heading": "Certificate of Completion",
    "intro": "This is to certify that",
    "completion": "has successfully completed the course",
    "show_platform": True,  # the platform name at the top
    "show_seal": True,
    "show_cpd": True,
    "show_instructor": True,
}
TEXT_LIMITS = {"heading": 60, "intro": 80, "completion": 80}
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


def clean_layout(layout: dict | None) -> dict:
    """Defaults for anything missing; refuses unknown keys and bad values."""
    layout = dict(layout or {})
    unknown = set(layout) - set(LAYOUT_DEFAULTS)
    if unknown:
        raise ServiceError("bad_layout", f"Unknown layout settings: {', '.join(sorted(unknown))}.")
    out = {**LAYOUT_DEFAULTS, **layout}
    if out["style"] not in STYLES:
        raise ServiceError("bad_layout", "Choose the classic, modern or minimal style.")
    for key in ("primary", "accent"):
        if not isinstance(out[key], str) or not _HEX.match(out[key]):
            raise ServiceError("bad_colour", "Colours are written like #4F46E5.")
        out[key] = out[key].upper()
    for key, limit in TEXT_LIMITS.items():
        out[key] = html.plain(str(out[key]), limit).strip() or LAYOUT_DEFAULTS[key]
    for key in ("show_platform", "show_seal", "show_cpd", "show_instructor"):
        out[key] = bool(out[key])
    return out


def is_platform(template: CertificateTemplate) -> bool:
    return bool(template.created_by.is_staff)


def default_template() -> CertificateTemplate | None:
    return CertificateTemplate.objects.filter(
        is_default=True, status="active", owner_org__isnull=True
    ).first()


def template_for(course: Course) -> CertificateTemplate | None:
    """The template certificates of this course are drawn with RIGHT NOW: the course's
    own (if active), else the platform default. Switching either changes the PDF."""
    if course.certificate_template_id:
        own = CertificateTemplate.objects.filter(pk=course.certificate_template_id, status="active").first()
        if own:
            return own
    return default_template()


def _fields(name: str, signatory_name: str, signatory_title: str) -> dict:
    name = html.plain(name, 120).strip()
    if len(name) < 3:
        raise ServiceError("name_short", "The name needs at least 3 characters.")
    return {"name": name, "signatory_name": html.plain(signatory_name, 120).strip(),
            "signatory_title": html.plain(signatory_title, 120).strip()}  # fmt: skip


def _signature(url: str) -> str:
    """Signature images live in our storage (uploaded through the console); nothing else."""
    if not url:
        return ""
    from core import storage

    if not storage.configured() or not url.startswith(f"{storage.account_url()}/"):
        raise ServiceError("bad_signature", "Upload the signature image here instead of linking to it.")
    return url


@transaction.atomic
def create_template(*, by, name: str, layout: dict | None = None, signatory_name: str = "",
                    signatory_title: str = "", signature_image_url: str = "",
                    show_qr_code: bool = True) -> CertificateTemplate:  # fmt: skip
    """Staff templates are active at once; an instructor's waits for approval."""
    fields = _fields(name, signatory_name, signatory_title)
    with authoring():
        t = CertificateTemplate.objects.create(
            **fields, layout=clean_layout(layout), signature_image_url=_signature(signature_image_url),
            show_qr_code=show_qr_code, created_by=by, status="active" if by.is_staff else "pending",
        )  # fmt: skip
    if t.status == "pending":
        _submitted(t, by)
    return t


@transaction.atomic
def update_template(*, template: CertificateTemplate, by, **changes) -> CertificateTemplate:
    allowed = {"name", "layout", "signatory_name", "signatory_title", "signature_image_url", "show_qr_code"}
    if unknown := set(changes) - allowed:
        raise ServiceError("bad_field", f"Cannot change: {', '.join(sorted(unknown))}.")
    if template.status == "archived":
        raise ServiceError("archived", "Archived templates can't be edited. Duplicate it instead.")
    if any(k in changes for k in ("name", "signatory_name", "signatory_title")):
        fields = _fields(changes.pop("name", template.name), changes.pop("signatory_name", template.signatory_name),
                         changes.pop("signatory_title", template.signatory_title))  # fmt: skip
        for k, v in fields.items():
            setattr(template, k, v)
    if "layout" in changes:
        template.layout = clean_layout(changes.pop("layout"))
    if "signature_image_url" in changes:
        template.signature_image_url = _signature(changes.pop("signature_image_url") or "")
    if "show_qr_code" in changes:
        template.show_qr_code = bool(changes.pop("show_qr_code"))
    resubmit = not by.is_staff and template.status in ("active", "rejected")
    if resubmit:  # an instructor's change is checked again before learners see it
        template.status, template.decision_reason = "pending", ""
    with authoring():
        template.save()
    if resubmit:
        _submitted(template, by)
    return template


def _submitted(t: CertificateTemplate, by) -> None:
    _tell_staff("staff_template_submitted", {"template": t.name, "name": by.full_name or by.email.split("@")[0]},
                url=f"/console/approvals?tab=templates&item={t.id}", dedupe=f"template:{t.id}:{t.updated_at.timestamp()}")  # fmt: skip


@transaction.atomic
def duplicate_template(*, template: CertificateTemplate, by) -> CertificateTemplate:
    return create_template(by=by, name=f"Copy of {template.name}"[:120], layout=template.layout,
                           signatory_name=template.signatory_name, signatory_title=template.signatory_title,
                           signature_image_url=template.signature_image_url, show_qr_code=template.show_qr_code)  # fmt: skip


def _decide(template: CertificateTemplate) -> CertificateTemplate:
    t = CertificateTemplate.objects.select_for_update().select_related("created_by").get(pk=template.pk)
    if t.status != "pending":
        raise ServiceError("not_pending", "Only templates waiting for approval can be decided.")
    return t


@transaction.atomic
def approve_template(*, template: CertificateTemplate) -> CertificateTemplate:
    t = _decide(template)
    t.status, t.decision_reason = "active", ""
    with authoring():
        t.save(update_fields=["status", "decision_reason", "updated_at"])
    _tell_owner(t, "template_approved", {"template": t.name})
    return t


@transaction.atomic
def reject_template(*, template: CertificateTemplate, reason: str) -> CertificateTemplate:
    if len(reason.strip()) < 3:
        raise ServiceError("reason_required", "Give the instructor a reason.")
    t = _decide(template)
    t.status, t.decision_reason = "rejected", html.plain(reason, 300)
    with authoring():
        t.save(update_fields=["status", "decision_reason", "updated_at"])
    _tell_owner(t, "template_rejected", {"template": t.name, "reason": t.decision_reason})
    return t


def _tell_owner(t: CertificateTemplate, code: str, context: dict) -> None:
    from apps.engagement import notify

    notify.notify([t.created_by_id], code, context, url="/studio/courses",
                  dedupe=f"{code}:{t.id}:{t.updated_at.timestamp()}")  # fmt: skip


@transaction.atomic
def set_default(*, template: CertificateTemplate) -> CertificateTemplate:
    """The platform default (used by every course without its own active template)."""
    t = CertificateTemplate.objects.select_for_update().select_related("created_by").get(pk=template.pk)
    if t.status != "active" or t.owner_org_id or not is_platform(t):
        raise ServiceError("not_platform", "Only an active platform template can be the default.")
    with authoring():
        CertificateTemplate.objects.filter(is_default=True).exclude(pk=t.pk).update(is_default=False)
        t.is_default = True
        t.save(update_fields=["is_default", "updated_at"])
    return t


@transaction.atomic
def archive_template(*, template: CertificateTemplate) -> CertificateTemplate:
    if template.is_default:
        raise ServiceError("is_default", "Choose another default template first.")
    with authoring():
        template.status = "archived"
        template.save(update_fields=["status", "updated_at"])
        Course.objects.filter(certificate_template=template).update(certificate_template=None)
    return template


def usable_by(user):
    """Templates this person may put on a course: active platform ones and their own."""
    return CertificateTemplate.objects.filter(owner_org__isnull=True, status="active").filter(
        Q(created_by__is_staff=True) | Q(created_by=user)
    )


@transaction.atomic
def set_course_template(*, course: Course, template_id, by) -> Course:
    """None = the platform default. Staff may pick any active template; an instructor an
    active platform template or one of their own."""
    if template_id is not None:
        allowed = CertificateTemplate.objects.filter(owner_org__isnull=True, status="active")
        if not by.is_staff:
            allowed = usable_by(by)
        if not allowed.filter(pk=template_id).exists():
            raise ServiceError("bad_template", "Choose an approved template.")
    with authoring():
        Course.objects.filter(pk=course.pk).update(certificate_template_id=template_id)
    course.certificate_template_id = template_id
    return course


def course_counts(template_ids: list) -> dict:
    """{template id: number of courses using it} in one query."""
    from django.db.models import Count

    rows = (
        Course.objects.filter(certificate_template_id__in=template_ids, deleted_at__isnull=True)
        .values("certificate_template_id")
        .annotate(n=Count("id"))
    )
    return {r["certificate_template_id"]: r["n"] for r in rows}


def instructor_course_ids(user) -> list:
    return list(CourseInstructor.objects.filter(user=user, can_edit=True).values_list("course_id", flat=True))
