"""Console > Certificates (mockup 30): templates (create, edit, duplicate, approve, set
default, preview), issued certificates (search, filter, export, verify, revoke, expiry,
download) and which template a course uses."""

import csv
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Literal
from uuid import UUID, uuid4

from django.db.models import Count, Q
from django.http import HttpResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Schema

from apps.catalog import certificates as templates
from apps.catalog.models import CertificateTemplate, Course
from apps.learning import services as learning
from apps.learning.models import Certificate
from core import cursor as keyset
from core import html, storage
from core.errors import ServiceError

from ..services import audit_request
from .common import ConsoleKpiOut, ConsoleOkOut, ConsoleReasonIn, ConsoleStatusOut, clamp, kpi, router, staff

EXPIRY_WINDOW = timedelta(days=30)


# ---------------------------------------------------------------- schemas
class ConsoleCertKpisOut(Schema):
    templates: int
    pending: int
    issued: ConsoleKpiOut  # issued in the last 30 days vs the 30 before; value = all valid certificates
    issued_total: int
    expiring_soon: int


class ConsoleCertLayoutOut(Schema):
    style: str
    primary: str
    accent: str
    heading: str
    intro: str
    completion: str
    show_platform: bool
    show_seal: bool
    show_cpd: bool
    show_instructor: bool


class ConsoleCertTemplateOut(Schema):
    id: UUID
    name: str
    type: str  # platform / instructor
    created_by: str
    courses: int
    status: str
    is_default: bool
    updated_at: datetime
    layout: ConsoleCertLayoutOut
    signatory_name: str
    signatory_title: str
    signature_image_url: str
    signature_preview_url: str  # a short-lived link the browser can show
    show_qr_code: bool
    decision_reason: str


class ConsoleCertLayoutIn(Schema):
    style: Literal["classic", "modern", "minimal"] = "classic"
    primary: str = Field("#4F46E5", pattern=r"^#[0-9A-Fa-f]{6}$")
    accent: str = Field("#F59E0B", pattern=r"^#[0-9A-Fa-f]{6}$")
    heading: str = Field("Certificate of Completion", max_length=60)
    intro: str = Field("This is to certify that", max_length=80)
    completion: str = Field("has successfully completed the course", max_length=80)
    show_platform: bool = True
    show_seal: bool = True
    show_cpd: bool = True
    show_instructor: bool = True


class ConsoleCertTemplateIn(Schema):
    name: str = Field(..., min_length=3, max_length=120)
    layout: ConsoleCertLayoutIn = ConsoleCertLayoutIn()
    signatory_name: str = Field("", max_length=120)
    signatory_title: str = Field("", max_length=120)
    signature_image_url: str = Field("", max_length=500)
    show_qr_code: bool = True


class ConsoleSignatureUploadIn(Schema):
    filename: str = Field(..., max_length=200)
    size_bytes: int = Field(..., gt=0, le=1_000_000)
    content_type: Literal["image/png", "image/jpeg"]


class ConsoleSignatureUploadOut(Schema):
    upload_url: str
    method: str
    headers: dict[str, str]
    url: str  # save this on the template once the upload finishes


class ConsoleIssuedCertOut(Schema):
    id: UUID
    code: str
    recipient_name: str
    email: str
    course_id: UUID
    course_title: str
    issued_at: datetime
    expires_at: datetime | None
    status: str  # valid / expiring / expired / revoked
    revoke_reason: str


class ConsoleIssuedPageOut(Schema):
    items: list[ConsoleIssuedCertOut]
    next_cursor: str | None


class ConsoleCertVerifyOut(Schema):
    found: bool
    code: str
    recipient_name: str = ""
    course_title: str = ""
    issued_at: datetime | None = None
    expires_at: datetime | None = None
    status: str = ""
    certificate_id: UUID | None = None


class ConsoleCertExpiryIn(Schema):
    expires_at: datetime | None = None


class ConsoleCourseTemplateIn(Schema):
    template_id: UUID | None = None  # None = the platform default


class ConsoleCertTemplateIdOut(Schema):
    id: UUID


# ---------------------------------------------------------------- helpers
def _status(c: Certificate, now: datetime) -> str:
    if c.revoked_at:
        return "revoked"
    if c.expires_at and c.expires_at <= now:
        return "expired"
    if c.expires_at and c.expires_at <= now + EXPIRY_WINDOW:
        return "expiring"
    return "valid"


def _preview_url(url: str) -> str:
    if not url or not storage.configured():
        return ""
    prefix = f"{storage.blob_url('')}"
    if not url.startswith(prefix):
        return ""
    from urllib.parse import unquote

    return storage.download_url(unquote(url[len(prefix) :]))


def _template_rows(rows: list[CertificateTemplate]) -> list[dict]:
    counts = templates.course_counts([t.id for t in rows])
    default_courses = Course.objects.filter(deleted_at__isnull=True).filter(
        Q(certificate_template__isnull=True) | ~Q(certificate_template__status="active")
    ).count() if any(t.is_default for t in rows) else 0  # fmt: skip
    return [{"id": t.id, "name": t.name, "type": "platform" if t.created_by.is_staff else "instructor",
             "created_by": "Admin" if t.created_by.is_staff else (t.created_by.full_name or t.created_by.email.split("@")[0]),
             "courses": counts.get(t.id, 0) + (default_courses if t.is_default else 0), "status": t.status,
             "is_default": t.is_default, "updated_at": t.updated_at, "layout": templates.clean_layout(t.layout),
             "signatory_name": t.signatory_name, "signatory_title": t.signatory_title,
             "signature_image_url": t.signature_image_url, "signature_preview_url": _preview_url(t.signature_image_url),
             "show_qr_code": t.show_qr_code, "decision_reason": t.decision_reason} for t in rows]  # fmt: skip


def _template(template_id) -> CertificateTemplate:
    return get_object_or_404(CertificateTemplate.objects.select_related("created_by"), pk=template_id,
                             owner_org__isnull=True)  # fmt: skip


# ---------------------------------------------------------------- overview and templates
@router.get("/certificates/overview", response=ConsoleCertKpisOut)
def overview(request):
    staff(request)
    now = timezone.now()
    k = Certificate.objects.aggregate(
        total=Count("id", filter=Q(revoked_at__isnull=True)),
        recent=Count("id", filter=Q(issued_at__gte=now - timedelta(days=30))),
        before=Count("id", filter=Q(issued_at__gte=now - timedelta(days=60), issued_at__lt=now - timedelta(days=30))),
        expiring=Count("id", filter=Q(revoked_at__isnull=True, expires_at__gt=now, expires_at__lte=now + EXPIRY_WINDOW)),
    )  # fmt: skip
    t = CertificateTemplate.objects.filter(owner_org__isnull=True).aggregate(
        live=Count("id", filter=~Q(status="archived")), pending=Count("id", filter=Q(status="pending"))
    )
    return {"templates": t["live"], "pending": t["pending"], "issued": kpi(k["recent"], k["before"]),
            "issued_total": k["total"], "expiring_soon": k["expiring"]}  # fmt: skip


@router.get("/certificates/templates", response=list[ConsoleCertTemplateOut])
def template_list(request, status: str = ""):
    staff(request)
    qs = CertificateTemplate.objects.filter(owner_org__isnull=True).select_related("created_by")
    if status:
        qs = qs.filter(status=status)
    rows = list(qs.order_by("-is_default", "status", "-updated_at")[:200])
    return _template_rows(rows)


@router.post("/certificates/templates", response=ConsoleCertTemplateOut)
def create_template(request, body: ConsoleCertTemplateIn):
    staff(request)
    t = templates.create_template(by=request.user, name=body.name, layout=body.layout.dict(),
                                  signatory_name=body.signatory_name, signatory_title=body.signatory_title,
                                  signature_image_url=body.signature_image_url, show_qr_code=body.show_qr_code)  # fmt: skip
    audit_request(request, "certificate_template.create", "certificate_template", t.id, {"name": t.name})
    return _template_rows([_template(t.id)])[0]


@router.patch("/certificates/templates/{template_id}", response=ConsoleCertTemplateOut)
def update_template(request, template_id: UUID, body: ConsoleCertTemplateIn):
    staff(request)
    data = body.dict()
    data["layout"] = body.layout.dict()
    t = templates.update_template(template=_template(template_id), by=request.user, **data)
    audit_request(request, "certificate_template.update", "certificate_template", t.id, {"name": t.name})
    return _template_rows([_template(t.id)])[0]


@router.post("/certificates/templates/{template_id}/duplicate", response=ConsoleCertTemplateIdOut)
def duplicate_template(request, template_id: UUID):
    staff(request)
    t = templates.duplicate_template(template=_template(template_id), by=request.user)
    audit_request(
        request, "certificate_template.duplicate", "certificate_template", t.id, {"from": str(template_id)}
    )
    return {"id": t.id}


@router.post("/certificates/templates/{template_id}/default", response=ConsoleOkOut)
def set_default(request, template_id: UUID):
    staff(request)
    t = templates.set_default(template=_template(template_id))
    audit_request(request, "certificate_template.default", "certificate_template", t.id)
    return {"ok": True}


@router.post("/certificates/templates/{template_id}/archive", response=ConsoleStatusOut)
def archive_template(request, template_id: UUID):
    staff(request)
    t = templates.archive_template(template=_template(template_id))
    audit_request(request, "certificate_template.archive", "certificate_template", t.id)
    return {"status": t.status}


def _sample():
    return SimpleNamespace(verification_code="LH-SAMPLE01", recipient_name="Sara Mahmoud",
                           course_title="Advanced React Development", issued_at=timezone.now(), cpd_hours=6,
                           instructor_names="Omar Khaled", expires_at=None)  # fmt: skip


@router.get("/certificates/templates/{template_id}/preview.pdf")
def template_preview(request, template_id: UUID):
    """The template drawn with sample data, exactly as learners' PDFs are drawn."""
    staff(request)
    from apps.learning.certificate_pdf import render

    t = _template(template_id)
    response = HttpResponse(render(_sample(), t), content_type="application/pdf")
    response["Content-Disposition"] = 'inline; filename="certificate-preview.pdf"'
    response["Cache-Control"] = "no-store"
    return response


@router.post("/certificates/signature-upload", response=ConsoleSignatureUploadOut)
def signature_upload(request, body: ConsoleSignatureUploadIn):
    """A write-only link for a signature image (PNG or JPEG, up to 1 MB)."""
    staff(request)
    if not storage.configured():
        raise ServiceError("storage_unavailable", "File storage is not set up.", status=503)
    ext = "png" if body.content_type == "image/png" else "jpg"
    path = f"certificates/signatures/{uuid4().hex}.{ext}"
    return {"upload_url": storage.upload_url(path), "method": "PUT",
            "headers": {"x-ms-blob-type": "BlockBlob", "Content-Type": body.content_type},
            "url": storage.blob_url(path)}  # fmt: skip


@router.put("/courses/{course_id}/certificate-template", response=ConsoleOkOut)
def set_course_template(request, course_id: UUID, body: ConsoleCourseTemplateIn):
    """Switch the design a course's certificates (old and new) are drawn with."""
    staff(request)
    c = get_object_or_404(Course, pk=course_id)
    old = c.certificate_template_id
    templates.set_course_template(course=c, template_id=body.template_id, by=request.user)
    audit_request(request, "course.certificate_template", "course", c.id,
                  {"from": str(old) if old else None, "to": str(body.template_id) if body.template_id else None})  # fmt: skip
    return {"ok": True}


# ---------------------------------------------------------------- issued certificates
def _issued(q: str, status: str, course: UUID | None):
    now = timezone.now()
    qs = Certificate.objects.all()
    needle = html.plain(q, 100).strip()
    if needle:
        qs = qs.filter(Q(verification_code__iexact=needle) | Q(recipient_name__icontains=needle)
                       | Q(course_title__icontains=needle) | Q(user__email__icontains=needle))  # fmt: skip
    if course:
        qs = qs.filter(course_id=course)
    if status == "revoked":
        qs = qs.filter(revoked_at__isnull=False)
    elif status == "expired":
        qs = qs.filter(revoked_at__isnull=True, expires_at__lte=now)
    elif status == "expiring":
        qs = qs.filter(revoked_at__isnull=True, expires_at__gt=now, expires_at__lte=now + EXPIRY_WINDOW)
    elif status == "valid":
        qs = qs.filter(revoked_at__isnull=True).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
    elif status:
        raise ServiceError("bad_filter", "Unknown status.")
    return qs


def _issued_row(c: Certificate, now) -> dict:
    return {"id": c.id, "code": c.verification_code, "recipient_name": c.recipient_name, "email": c.user.email,
            "course_id": c.course_id, "course_title": c.course_title, "issued_at": c.issued_at,
            "expires_at": c.expires_at, "status": _status(c, now), "revoke_reason": c.revoke_reason}  # fmt: skip


@router.get("/certificates/issued", response=ConsoleIssuedPageOut)
def issued(request, q: str = "", status: str = "", course: UUID | None = None, cursor: str | None = None,
           limit: int = 25):  # fmt: skip
    staff(request)
    limit = clamp(limit, 100)
    qs = _issued(q, status, course)
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.select_related("user").order_by("-id")[: limit + 1])
    page, now = rows[:limit], timezone.now()
    return {"items": [_issued_row(c, now) for c in page],
            "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None}  # fmt: skip


class _Echo:
    def write(self, value):
        return value


def _cell(v) -> str:
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s  # no formulas in spreadsheets


@router.get("/certificates/issued.csv")
def issued_csv(request, q: str = "", status: str = "", course: UUID | None = None):
    staff(request)
    now = timezone.now()
    qs = _issued(q, status, course).select_related("user").order_by("-id")

    # read inside the request (RLS context), stream the writing; capped like other exports
    certs = list(qs[:50000])

    def rows():
        yield ["Certificate ID", "Learner", "Email", "Course", "Issued", "Expires", "Status", "Revoke reason"]
        for c in certs:
            yield [c.verification_code, c.recipient_name, c.user.email, c.course_title, f"{c.issued_at:%Y-%m-%d}",
                   f"{c.expires_at:%Y-%m-%d}" if c.expires_at else "", _status(c, now), c.revoke_reason]  # fmt: skip

    writer = csv.writer(_Echo())
    response = StreamingHttpResponse((writer.writerow([_cell(v) for v in r]) for r in rows()),
                                     content_type="text/csv; charset=utf-8")  # fmt: skip
    response["Content-Disposition"] = (
        f'attachment; filename="certificates-{timezone.localdate():%Y-%m-%d}.csv"'
    )
    response["Cache-Control"] = "no-store"
    audit_request(request, "certificate.export", "certificate", "export", {"q": q[:100], "status": status})
    return response


@router.get("/certificates/verify", response=ConsoleCertVerifyOut)
def verify(request, code: str):
    staff(request)
    code = code.strip().upper()[:20]
    c = Certificate.objects.filter(verification_code=code).first()
    if c is None:
        return {"found": False, "code": code}
    return {"found": True, "code": c.verification_code, "recipient_name": c.recipient_name,
            "course_title": c.course_title, "issued_at": c.issued_at, "expires_at": c.expires_at,
            "status": _status(c, timezone.now()), "certificate_id": c.id}  # fmt: skip


@router.post("/certificates/{certificate_id}/revoke", response=ConsoleStatusOut)
def revoke(request, certificate_id: UUID, body: ConsoleReasonIn):
    staff(request)
    c = learning.revoke_certificate(
        certificate=get_object_or_404(Certificate, pk=certificate_id), reason=body.reason
    )
    audit_request(request, "certificate.revoke", "certificate", c.id,
                  {"code": c.verification_code, "reason": c.revoke_reason})  # fmt: skip
    return {"status": "revoked"}


@router.put("/certificates/{certificate_id}/expiry", response=ConsoleStatusOut)
def set_expiry(request, certificate_id: UUID, body: ConsoleCertExpiryIn):
    staff(request)
    c = learning.set_certificate_expiry(certificate=get_object_or_404(Certificate, pk=certificate_id),
                                        expires_at=body.expires_at)  # fmt: skip
    audit_request(request, "certificate.expiry", "certificate", c.id,
                  {"code": c.verification_code, "expires_at": c.expires_at.isoformat() if c.expires_at else None})  # fmt: skip
    return {"status": _status(c, timezone.now())}


@router.get("/certificates/{certificate_id}/pdf")
def certificate_pdf(request, certificate_id: UUID):
    """Any learner's certificate PDF (also revoked ones, for the record)."""
    staff(request)
    from apps.learning.certificate_pdf import render

    c = get_object_or_404(Certificate.objects.select_related("course", "template"), pk=certificate_id)
    response = HttpResponse(
        render(c, templates.template_for(c.course) or c.template), content_type="application/pdf"
    )
    response["Content-Disposition"] = f'attachment; filename="certificate-{c.verification_code}.pdf"'
    response["Cache-Control"] = "no-store"
    return response
