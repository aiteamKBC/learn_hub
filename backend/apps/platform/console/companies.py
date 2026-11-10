"""Console > Companies (pattern 05): business customers, their seats, status, add-ons
(entitlements), admins and linked subscription. Status, seat and add-on changes are
audited and the company's admins are told."""

from datetime import datetime, timedelta
from uuid import UUID

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Schema

from apps.commerce.models import Addon, AddonSubscription, Subscription
from apps.engagement import notify
from apps.identity.models import User
from apps.org import services as org_services
from apps.org.models import Organization, OrgMember
from core import html
from core.errors import ServiceError
from core.tenancy import tenant_context

from ..models import Entitlement
from ..services import audit_request
from ..services import grant as grant_entitlement
from .common import ConsoleIdOut, ConsoleOkOut, router, staff

ADMIN_ROLES = ("owner", "admin")


class ConsoleCompanyIn(Schema):
    name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=2, max_length=80, pattern=r"^[a-z0-9-]+$")
    owner_email: str = Field(..., max_length=320)
    seat_limit: int | None = Field(None, ge=1, le=1000000)
    status: str = "active"


class ConsoleCompanyPatch(Schema):
    name: str | None = Field(None, min_length=2, max_length=200)
    status: str | None = None
    seat_limit: int | None = Field(None, ge=1, le=1000000)
    clear_seat_limit: bool = False
    reason: str = Field("", max_length=300)


class ConsoleCompanyOut(Schema):
    id: UUID
    name: str
    slug: str
    status: str
    seat_limit: int | None
    members: int
    admins: int
    plan: str | None
    addons: list[str]
    created_at: datetime


class ConsoleCompanyKpisOut(Schema):
    total: int
    active: int
    trial: int
    suspended: int
    seats_used: int


class ConsoleCompanyAdminOut(Schema):
    member_id: UUID
    user_id: UUID
    name: str
    email: str
    role: str
    joined_at: datetime


class ConsoleEntitlementOut(Schema):
    id: UUID
    feature: str
    label: str
    source: str
    seats: int | None
    starts_at: datetime
    ends_at: datetime | None
    active: bool
    note: str


class ConsoleCompanySubOut(Schema):
    id: UUID
    plan: str
    status: str
    seats: int
    current_period_end: datetime | None
    cancel_at_period_end: bool


class ConsoleCompanyDetailOut(Schema):
    id: UUID
    name: str
    slug: str
    status: str
    seat_limit: int | None
    members: int
    billing_currency: str
    created_at: datetime
    admins: list[ConsoleCompanyAdminOut]
    entitlements: list[ConsoleEntitlementOut]
    subscriptions: list[ConsoleCompanySubOut]
    addon_subscriptions: list[ConsoleCompanySubOut]


class ConsoleFeatureOut(Schema):
    code: str
    label: str


class ConsoleGrantIn(Schema):
    feature: str = Field(..., max_length=60)
    days: int | None = Field(None, ge=1, le=3650)
    seats: int | None = Field(None, ge=1, le=1000000)
    note: str = Field("", max_length=300)


class ConsoleEndGrantIn(Schema):
    reason: str = Field(..., min_length=3, max_length=300)


class ConsoleAdminIn(Schema):
    email: str = Field(..., max_length=320)
    role: str = Field("admin", pattern=r"^(admin|owner)$")


def _features() -> dict[str, str]:
    out = {"business": "Business workspace"}
    out.update(dict(Addon.objects.order_by("name").values_list("code", "name")))
    return out


def _admin_ids(org_id) -> list:
    return list(
        OrgMember.objects.filter(org_id=org_id, removed_at__isnull=True, role__in=ADMIN_ROLES).values_list(
            "user_id", flat=True
        )
    )


def _tell_admins(org: Organization, code: str, context: dict, dedupe: str) -> None:
    notify.notify(_admin_ids(org.id), code, {"company": org.name, **context}, url="/business",
                  dedupe=f"{dedupe}:{int(timezone.now().timestamp())}")  # fmt: skip


def _active(e, now) -> bool:
    return e.starts_at <= now and (e.ends_at is None or e.ends_at > now)


@router.get("/companies/kpis", response=ConsoleCompanyKpisOut)
def company_kpis(request):
    staff(request)
    agg = Organization.objects.aggregate(
        total=Count("id"), active=Count("id", filter=Q(status="active")), trial=Count("id", filter=Q(status="trial")),
        suspended=Count("id", filter=Q(status="suspended")),
    )  # fmt: skip
    seats = OrgMember.objects.filter(removed_at__isnull=True).count()
    return {**agg, "seats_used": seats}


@router.get("/companies/features", response=list[ConsoleFeatureOut])
def features(request):
    staff(request)
    return [{"code": k, "label": v} for k, v in _features().items()]


@router.get("/companies", response=list[ConsoleCompanyOut])
def companies(request, q: str | None = None, status: str | None = None):
    staff(request)
    qs = Organization.objects.order_by("name")
    if status:
        qs = qs.filter(status=status)
    if q and q.strip():
        term = q.strip()[:100]
        qs = qs.filter(Q(name__icontains=term) | Q(slug__icontains=term))
    rows = list(qs[:500])
    ids = [o.id for o in rows]
    members = OrgMember.objects.filter(org_id__in=ids, removed_at__isnull=True).values("org_id")
    counts = dict(members.annotate(n=Count("id")).values_list("org_id", "n"))
    admins = dict(members.filter(role__in=ADMIN_ROLES).annotate(n=Count("id")).values_list("org_id", "n"))
    plans = dict(
        Subscription.objects.filter(org_id__in=ids, status__in=("active", "trialing", "past_due"))
        .values_list("org_id", "plan__name")
    )  # fmt: skip
    now = timezone.now()
    labels = _features()
    addons: dict = {}
    for e in Entitlement.objects.filter(org_id__in=ids).exclude(feature="business"):
        if _active(e, now):
            addons.setdefault(e.org_id, set()).add(labels.get(e.feature, e.feature))
    return [{"id": o.id, "name": o.name, "slug": o.slug, "status": o.status, "seat_limit": o.seat_limit,
             "members": counts.get(o.id, 0), "admins": admins.get(o.id, 0), "plan": plans.get(o.id),
             "addons": sorted(addons.get(o.id, ())), "created_at": o.created_at} for o in rows]  # fmt: skip


@router.get("/companies/{org_id}", response=ConsoleCompanyDetailOut)
def company(request, org_id: UUID):
    staff(request)
    o = get_object_or_404(Organization, pk=org_id)
    now = timezone.now()
    labels = _features()
    admins = (
        OrgMember.objects.filter(org=o, removed_at__isnull=True, role__in=ADMIN_ROLES)
        .select_related("user").order_by("-role", "joined_at")
    )  # fmt: skip

    def sub(s, name):
        return {"id": s.id, "plan": name, "status": s.status, "seats": getattr(s, "seats", 1),
                "current_period_end": s.current_period_end,
                "cancel_at_period_end": getattr(s, "cancel_at_period_end", False)}  # fmt: skip

    return {
        "id": o.id, "name": o.name, "slug": o.slug, "status": o.status, "seat_limit": o.seat_limit,
        "members": OrgMember.objects.filter(org=o, removed_at__isnull=True).count(),
        "billing_currency": o.billing_currency, "created_at": o.created_at,
        "admins": [{"member_id": m.id, "user_id": m.user_id, "name": m.user.full_name or m.user.email,
                    "email": m.user.email, "role": m.role, "joined_at": m.joined_at} for m in admins],
        "entitlements": [{"id": e.id, "feature": e.feature, "label": labels.get(e.feature, e.feature),
                          "source": e.source, "seats": e.seats, "starts_at": e.starts_at, "ends_at": e.ends_at,
                          "active": _active(e, now), "note": e.note}
                         for e in Entitlement.objects.filter(org=o).order_by("-starts_at")],
        "subscriptions": [sub(s, s.plan.name) for s in
                          Subscription.objects.filter(org=o).select_related("plan").order_by("-created_at")[:10]],
        "addon_subscriptions": [sub(s, s.addon.name) for s in
                                AddonSubscription.objects.filter(org=o).select_related("addon")
                                .order_by("-created_at")[:10]],
    }  # fmt: skip


@router.post("/companies", response=ConsoleIdOut)
def create_company(request, body: ConsoleCompanyIn):
    staff(request)
    owner = User.objects.filter(email__iexact=body.owner_email.strip(), is_active=True).first()
    if owner is None:
        raise ServiceError("no_owner", "The owner must already have an account.")
    if body.status not in Organization.Status.values:
        raise ServiceError("bad_status", "Unknown status.")
    if Organization.objects.filter(slug=body.slug).exists():
        raise ServiceError("slug_taken", "That address is taken.")
    org = org_services.create_organization(
        name=html.plain(body.name, 200).strip(), slug=body.slug, owner=owner
    )
    Organization.objects.filter(pk=org.pk).update(seat_limit=body.seat_limit, status=body.status)
    audit_request(request, "company.create", "organization", org.id,
                  {"name": org.name, "owner": owner.email, "seats": body.seat_limit})  # fmt: skip
    notify.notify([owner.id], "company_created", {"company": org.name}, url="/business",
                  dedupe=f"company-created:{org.id}")  # fmt: skip
    return {"id": org.id}


@router.patch("/companies/{org_id}", response=ConsoleOkOut)
def update_company(request, org_id: UUID, body: ConsoleCompanyPatch):
    """Name, seats and status. Suspending needs a reason; the admins are told."""
    staff(request)
    o = get_object_or_404(Organization, pk=org_id)
    changes: dict = {}
    if body.name and body.name.strip() != o.name:
        changes["name"] = html.plain(body.name, 200).strip()
    if body.clear_seat_limit:
        if o.seat_limit is not None:
            changes["seat_limit"] = None
    elif body.seat_limit is not None and body.seat_limit != o.seat_limit:
        used = OrgMember.objects.filter(org=o, removed_at__isnull=True).count()
        if body.seat_limit < used:
            raise ServiceError("seats_in_use", f"{used} people already use seats. Remove people first.")
        changes["seat_limit"] = body.seat_limit
    if body.status and body.status != o.status:
        if body.status not in Organization.Status.values:
            raise ServiceError("bad_status", "Unknown status.")
        if body.status in ("suspended", "cancelled") and len(body.reason.strip()) < 3:
            raise ServiceError("reason_required", "Give a reason.")
        changes["status"] = body.status
    if not changes:
        return {"ok": True}
    Organization.objects.filter(pk=o.pk).update(**changes, updated_at=timezone.now())
    audit_request(request, "company.update", "organization", o.id,
                  {**{k: v for k, v in changes.items()}, "reason": body.reason})  # fmt: skip
    o.refresh_from_db()
    if "seat_limit" in changes:
        _tell_admins(o, "company_seats_changed", {"seats": o.seat_limit or "unlimited"}, f"seats:{o.id}")
    if changes.get("status") == "suspended":
        _tell_admins(o, "company_suspended", {}, f"suspended:{o.id}")
    elif "status" in changes and changes["status"] == "active":
        _tell_admins(o, "company_reactivated", {}, f"reactivated:{o.id}")
    return {"ok": True}


@router.post("/companies/{org_id}/entitlements", response=ConsoleIdOut)
def grant(request, org_id: UUID, body: ConsoleGrantIn):
    """Switch an add-on (or the business workspace) on for a company."""
    staff(request)
    o = get_object_or_404(Organization, pk=org_id)
    labels = _features()
    if body.feature not in labels:
        raise ServiceError("bad_feature", "Choose an add-on.")
    ent = grant_entitlement(feature=body.feature, by=request.user, org_id=o.id, seats_count=body.seats,
                            note=html.plain(body.note, 300),
                            ends_at=timezone.now() + timedelta(days=body.days) if body.days else None)  # fmt: skip
    audit_request(
        request, "company.addon_on", "organization", o.id, {"feature": body.feature, "days": body.days}
    )
    _tell_admins(o, "addon_enabled", {"addon": labels[body.feature]}, f"addon-on:{ent.id}")
    return {"id": ent.id}


@router.post("/companies/{org_id}/entitlements/{entitlement_id}/end", response=ConsoleOkOut)
def end_grant(request, org_id: UUID, entitlement_id: UUID, body: ConsoleEndGrantIn):
    """Switch an add-on off now (staff grants only: paid add-ons end through billing)."""
    staff(request)
    o = get_object_or_404(Organization, pk=org_id)
    ent = get_object_or_404(Entitlement, pk=entitlement_id, org=o)
    if ent.source != Entitlement.Source.GRANT:
        raise ServiceError("paid_addon", "This add-on is paid for; it ends when the company cancels it.")
    now = timezone.now()
    if not _active(ent, now):
        raise ServiceError("not_active", "This add-on is already off.")
    with tenant_context(user_id=request.user.id, staff=True):
        Entitlement.objects.filter(pk=ent.pk).update(ends_at=now, updated_at=now)
    audit_request(
        request, "company.addon_off", "organization", o.id, {"feature": ent.feature, "reason": body.reason}
    )
    _tell_admins(
        o, "addon_disabled", {"addon": _features().get(ent.feature, ent.feature)}, f"addon-off:{ent.id}"
    )
    return {"ok": True}


@router.post("/companies/{org_id}/admins", response=ConsoleOkOut)
def add_admin(request, org_id: UUID, body: ConsoleAdminIn):
    staff(request)
    o = get_object_or_404(Organization, pk=org_id)
    user = User.objects.filter(email__iexact=body.email.strip(), is_active=True).first()
    if user is None:
        raise ServiceError(
            "no_user", "No active account uses that email. Invite them from the company first."
        )
    org_services.staff_set_admin(org=o, user=user, role=body.role)
    audit_request(
        request, "company.admin_add", "organization", o.id, {"email": user.email, "role": body.role}
    )
    return {"ok": True}


@router.post("/companies/{org_id}/admins/{member_id}/remove", response=ConsoleOkOut)
def remove_admin(request, org_id: UUID, member_id: UUID, body: ConsoleEndGrantIn):
    """The person stays in the company as a learner."""
    staff(request)
    o = get_object_or_404(Organization, pk=org_id)
    m = get_object_or_404(
        OrgMember.objects.select_related("user"), pk=member_id, org=o, removed_at__isnull=True
    )
    org_services.staff_set_admin(org=o, user=m.user, role="learner")
    audit_request(
        request, "company.admin_remove", "organization", o.id, {"email": m.user.email, "reason": body.reason}
    )
    return {"ok": True}
