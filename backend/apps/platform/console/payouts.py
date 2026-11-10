"""Console > Payouts (mockup 33, bottom): requests, balances, schedule, methods, history."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Schema

from apps.payouts import selectors as ledger
from apps.payouts import services as payouts
from apps.payouts.models import Earning, Payout, PayoutAccount, PayoutRequest
from core import cursor as keyset

from .. import services as platform
from ..services import audit_request
from .common import ConsoleKpiOut, ConsoleOkOut, ConsoleReasonIn, clamp, kpi, router, staff


def _month_start(now=None):
    now = now or timezone.now()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


# ---------------------------------------------------------------- overview
class ConsolePayoutSettingsOut(Schema):
    schedule: str
    day_of_month: int
    minimum_gbp_minor: int
    hold_days: int
    requests_enabled: bool
    next_payout_date: date
    refund_window_days: int


class ConsolePayoutSettingsIn(Schema):
    schedule: Literal["weekly", "monthly"]
    day_of_month: int = Field(..., ge=1, le=28)
    minimum_gbp_minor: int = Field(..., ge=0, le=10_000_000)
    hold_days: int = Field(..., ge=0, le=180)
    requests_enabled: bool


class ConsolePayoutOverviewOut(Schema):
    pending_requests: int
    pending_amount_gbp_minor: int
    disputed_requests: int
    approved_month: ConsoleKpiOut
    total_paid_gbp_minor: int
    paid_this_month_gbp_minor: int
    instructors_with_balance: int
    total_balance_gbp_minor: int
    unverified_accounts: int
    settings: ConsolePayoutSettingsOut


def _settings() -> dict:
    g = platform.get_setting
    return {"schedule": g("payouts.schedule"), "day_of_month": int(g("payouts.day_of_month")),
            "minimum_gbp_minor": int(g("payouts.minimum_gbp_minor")), "hold_days": int(g("payouts.hold_days")),
            "requests_enabled": bool(g("payouts.requests_enabled")), "next_payout_date": payouts.next_payout_date(),
            "refund_window_days": int(g("payments.refund_window_days"))}  # fmt: skip


@router.get("/payouts/overview", response=ConsolePayoutOverviewOut)
def payouts_overview(request):
    staff(request)
    now = timezone.now()
    month = _month_start(now)
    last_month = _month_start(month - timezone.timedelta(days=1))
    done = [PayoutRequest.Status.APPROVED, PayoutRequest.Status.PAID]
    req = PayoutRequest.objects.aggregate(
        pending=Count("id", filter=Q(status="pending")),
        pending_amount=Sum("amount_gbp_minor", filter=Q(status="pending"), default=0),
        disputed=Count("id", filter=Q(status="disputed")),
        approved=Sum("amount_gbp_minor", filter=Q(status__in=done, decided_at__gte=month), default=0),
        approved_before=Sum("amount_gbp_minor", filter=Q(status__in=done, decided_at__gte=last_month,
                                                          decided_at__lt=month), default=0),
    )  # fmt: skip
    paid = Payout.objects.filter(status=Payout.Status.PAID).aggregate(
        total=Sum("amount_gbp_minor", default=0),
        month=Sum("amount_gbp_minor", filter=Q(paid_at__gte=month), default=0),
    )
    unpaid = Earning.objects.filter(payout__isnull=True)
    with_balance = (
        unpaid.filter(available_at__lte=now)
        .values("user_id")
        .annotate(t=Sum("amount_gbp_minor"))
        .filter(t__gt=0)
        .count()
    )
    return {
        "pending_requests": req["pending"], "pending_amount_gbp_minor": req["pending_amount"],
        "disputed_requests": req["disputed"], "approved_month": kpi(req["approved"], req["approved_before"]),
        "total_paid_gbp_minor": paid["total"], "paid_this_month_gbp_minor": paid["month"],
        "instructors_with_balance": with_balance,
        "total_balance_gbp_minor": unpaid.aggregate(t=Sum("amount_gbp_minor", default=0))["t"],
        "unverified_accounts": PayoutAccount.objects.filter(verified_at__isnull=True).count(),
        "settings": _settings(),
    }  # fmt: skip


@router.get("/payouts/settings", response=ConsolePayoutSettingsOut)
def payout_settings(request):
    staff(request)
    return _settings()


@router.put("/payouts/settings", response=ConsolePayoutSettingsOut)
def set_payout_settings(request, body: ConsolePayoutSettingsIn):
    """Client question 2: schedule, minimum and hold are data, never constants."""
    staff(request)
    for key, value in body.dict().items():
        platform.set_setting(key=f"payouts.{key}", value=value, by=request.user)
    audit_request(request, "payouts.settings", "setting", "payouts", body.dict())
    return _settings()


class ConsolePayoutRunOut(Schema):
    payouts: int


@router.post("/payouts/run", response=ConsolePayoutRunOut)
def run_payouts(request):
    """Bundle every available balance (at or above the minimum) now, as the schedule would."""
    staff(request)
    made = payouts.create_payouts(period_end=timezone.now().date())
    audit_request(request, "payouts.run", "payout", "manual", {"payouts": len(made)})
    return {"payouts": len(made)}


# ---------------------------------------------------------------- requests
class ConsolePayoutRequestOut(Schema):
    id: UUID
    reference: str
    user_id: UUID
    instructor: str
    email: str
    amount_gbp_minor: int
    method: str
    method_label: str
    method_detail: str
    account_verified: bool
    status: str
    note: str
    reason: str
    provider_ref: str
    created_at: datetime
    decided_at: datetime | None
    decided_by: str | None
    paid_at: datetime | None
    available_gbp_minor: int


class ConsolePayoutRequestPageOut(Schema):
    items: list[ConsolePayoutRequestOut]
    next_cursor: str | None


def _request_rows(reqs: list[PayoutRequest]) -> list[dict]:
    accounts = {a.user_id: a for a in PayoutAccount.objects.filter(user_id__in={r.user_id for r in reqs})}
    available = dict(
        Earning.objects.filter(user_id__in={r.user_id for r in reqs}, payout__isnull=True,
                               available_at__lte=timezone.now())
        .values("user_id").annotate(t=Sum("amount_gbp_minor")).values_list("user_id", "t")
    )  # fmt: skip
    out = []
    for r in reqs:
        a = accounts.get(r.user_id)
        detail = next((m["detail"] for m in payouts.configured_methods(a) if m["method"] == r.method), "")
        out.append({
            "id": r.id, "reference": payouts.reference(r), "user_id": r.user_id, "instructor": r.user.full_name,
            "email": r.user.email, "amount_gbp_minor": r.amount_gbp_minor, "method": r.method,
            "method_label": payouts.METHOD_LABEL.get(r.method, r.method), "method_detail": detail,
            "account_verified": bool(a and a.verified_at), "status": r.status, "note": r.note, "reason": r.reason,
            "provider_ref": r.provider_ref, "created_at": r.created_at, "decided_at": r.decided_at,
            "decided_by": r.decided_by.full_name if r.decided_by else None, "paid_at": r.paid_at,
            "available_gbp_minor": available.get(r.user_id) or 0,
        })  # fmt: skip
    return out


@router.get("/payout-requests", response=ConsolePayoutRequestPageOut)
def payout_requests(request, status: str = "", q: str = "", cursor: str | None = None, limit: int = 25):
    staff(request)
    limit = clamp(limit)
    qs = PayoutRequest.objects.select_related("user", "decided_by")
    if status:
        qs = qs.filter(status=status)
    q = q.strip()[:100]
    if q:
        ref = q.upper().removeprefix("PAY-").lower()
        match = Q(user__full_name__icontains=q) | Q(user__email__icontains=q)
        if len(ref) >= 4 and all(c in "0123456789abcdef" for c in ref):
            match |= Q(id__iendswith=ref)
        qs = qs.filter(match)
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.order_by("-id")[: limit + 1])
    page = rows[:limit]
    return {
        "items": _request_rows(page),
        "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None,
    }


@router.get("/payout-requests/{request_id}", response=ConsolePayoutRequestOut)
def payout_request(request, request_id: UUID):
    staff(request)
    return _request_rows([get_object_or_404(PayoutRequest.objects.select_related("user", "decided_by"),
                                            pk=request_id)])[0]  # fmt: skip


class ConsolePaidIn(Schema):
    provider_ref: str = Field(..., min_length=2, max_length=128)


def _one(request_id) -> PayoutRequest:
    return get_object_or_404(PayoutRequest, pk=request_id)


def _after(request, action: str, req: PayoutRequest, data=None):
    audit_request(request, f"payout_request.{action}", "payout_request", str(req.id),
                  {"amount": req.amount_gbp_minor, "user_id": str(req.user_id), **(data or {})})  # fmt: skip
    return _request_rows([PayoutRequest.objects.select_related("user", "decided_by").get(pk=req.pk)])[0]


@router.post("/payout-requests/{request_id}/approve", response=ConsolePayoutRequestOut)
def approve_request(request, request_id: UUID):
    staff(request)
    req = payouts.approve_request(req=_one(request_id), by=request.user)
    return _after(request, "approve", req)


@router.post("/payout-requests/{request_id}/mark-paid", response=ConsolePayoutRequestOut)
def mark_request_paid(request, request_id: UUID, body: ConsolePaidIn):
    staff(request)
    req = payouts.mark_request_paid(req=_one(request_id), by=request.user, provider_ref=body.provider_ref)
    return _after(request, "paid", req, {"provider_ref": body.provider_ref.strip()})


@router.post("/payout-requests/{request_id}/reject", response=ConsolePayoutRequestOut)
def reject_request(request, request_id: UUID, body: ConsoleReasonIn):
    staff(request)
    req = payouts.reject_request(req=_one(request_id), by=request.user, reason=body.reason.strip())
    return _after(request, "reject", req, {"reason": body.reason})


@router.post("/payout-requests/{request_id}/dispute", response=ConsolePayoutRequestOut)
def dispute_request(request, request_id: UUID, body: ConsoleReasonIn):
    staff(request)
    req = payouts.dispute_request(req=_one(request_id), by=request.user, reason=body.reason.strip())
    return _after(request, "dispute", req, {"reason": body.reason})


@router.post("/payout-requests/{request_id}/fail", response=ConsolePayoutRequestOut)
def fail_request(request, request_id: UUID, body: ConsoleReasonIn):
    staff(request)
    req = payouts.fail_request(req=_one(request_id), by=request.user, reason=body.reason.strip())
    return _after(request, "fail", req, {"reason": body.reason})


# ---------------------------------------------------------------- balances
class ConsoleBalanceOut(Schema):
    user_id: UUID
    name: str
    email: str
    available: int
    pending: int
    in_payout: int
    paid: int
    total: int
    method: str | None
    verified: bool


@router.get("/payouts/balances", response=list[ConsoleBalanceOut])
def payout_balances(request, q: str = ""):
    staff(request)
    rows = ledger.balances(q=q.strip()[:100])
    accounts = {a.user_id: a for a in PayoutAccount.objects.filter(user_id__in=[r["user_id"] for r in rows])}
    return [{"user_id": r["user_id"], "name": r["user__full_name"], "email": r["user__email"],
             "available": r["available"], "pending": r["pending"], "in_payout": r["in_payout"], "paid": r["paid"],
             "total": r["total"], "method": accounts[r["user_id"]].method if r["user_id"] in accounts else None,
             "verified": bool(r["user_id"] in accounts and accounts[r["user_id"]].verified_at)}
            for r in rows]  # fmt: skip


# ---------------------------------------------------------------- scheduled payouts and history
class ConsolePayoutRowOut(Schema):
    id: UUID
    user_id: UUID
    instructor: str
    period_end: date
    amount_gbp_minor: int
    method: str
    status: str
    account_verified: bool
    provider_ref: str = ""
    paid_at: datetime | None = None
    failure_reason: str = ""


class ConsolePayoutPageOut(Schema):
    items: list[ConsolePayoutRowOut]
    next_cursor: str | None


def _payout_rows(rows) -> list[dict]:
    accounts = {a.user_id: a for a in PayoutAccount.objects.filter(user_id__in=[p.user_id for p in rows])}
    return [{"id": p.id, "user_id": p.user_id, "instructor": p.user.full_name, "period_end": p.period_end,
             "amount_gbp_minor": p.amount_gbp_minor, "method": p.method, "status": p.status,
             "account_verified": bool(accounts.get(p.user_id) and accounts[p.user_id].verified_at),
             "provider_ref": p.provider_ref, "paid_at": p.paid_at, "failure_reason": p.failure_reason}
            for p in rows]  # fmt: skip


class ConsoleApproveIn(Schema):
    provider_ref: str = Field("", max_length=128)


class ConsolePayoutApprovedOut(Schema):
    status: str
    provider_ref: str


@router.get("/payouts", response=list[ConsolePayoutRowOut])
def payout_queue(request, status: str = "pending"):
    staff(request)
    rows = list(
        Payout.objects.filter(status=status)
        .select_related("user")
        .order_by("period_end", "user__full_name")[:500]
    )
    return _payout_rows(rows)


@router.get("/payouts/history", response=ConsolePayoutPageOut)
def payout_history(request, status: str = "", q: str = "", cursor: str | None = None, limit: int = 25):
    staff(request)
    limit = clamp(limit)
    qs = Payout.objects.select_related("user")
    if status:
        qs = qs.filter(status=status)
    if q.strip():
        qs = qs.filter(
            Q(user__full_name__icontains=q.strip()[:100]) | Q(user__email__icontains=q.strip()[:100])
        )
    after = keyset.decode(cursor, 1)
    if after:
        qs = qs.filter(id__lt=after[0])
    rows = list(qs.order_by("-id")[: limit + 1])
    page = rows[:limit]
    return {
        "items": _payout_rows(page),
        "next_cursor": keyset.encode(page[-1].id) if len(rows) > limit else None,
    }


@router.post("/payouts/{payout_id}/approve", response=ConsolePayoutApprovedOut)
def approve_payout(request, payout_id: str, body: ConsoleApproveIn):
    from apps.engagement.notify import notify

    staff(request)
    p = payouts.approve_payout(payout=get_object_or_404(Payout, pk=payout_id), by=request.user,
                               provider_ref=body.provider_ref.strip())  # fmt: skip
    audit_request(request, "payout.approve", "payout", payout_id, {"amount": p.amount_gbp_minor})
    notify([p.user_id], "payout_paid", {"amount": payouts.pricing.gbp_money(p.amount_gbp_minor)},
           url="/studio/payouts", dedupe=f"payout_paid:{p.id}")  # fmt: skip
    return {"status": p.status, "provider_ref": p.provider_ref}


@router.post("/payouts/{payout_id}/fail", response=ConsoleOkOut)
def fail_payout(request, payout_id: str, body: ConsoleReasonIn):
    staff(request)
    payouts.fail_payout(payout=get_object_or_404(Payout, pk=payout_id), reason=body.reason)
    audit_request(request, "payout.fail", "payout", payout_id, {"reason": body.reason})
    return {"ok": True}


# ---------------------------------------------------------------- payout methods (accounts)
class ConsolePayoutMethodOut(Schema):
    method: str
    label: str
    detail: str
    is_default: bool


class ConsolePayoutAccountOut(Schema):
    user_id: UUID
    name: str
    email: str
    method: str
    paypal_email: str
    stripe_account_id: str
    country: str
    verified_at: datetime | None
    methods: list[ConsolePayoutMethodOut]
    updated_at: datetime


@router.get("/payout-accounts", response=list[ConsolePayoutAccountOut])
def payout_accounts(request, unverified: bool = True, method: str = ""):
    staff(request)
    qs = PayoutAccount.objects.select_related("user")
    if unverified:
        qs = qs.filter(verified_at__isnull=True)
    if method:
        qs = qs.filter(method=method)
    return [{"user_id": a.user_id, "name": a.user.full_name, "email": a.user.email, "method": a.method,
             "paypal_email": a.paypal_email, "stripe_account_id": a.stripe_account_id, "country": a.country,
             "verified_at": a.verified_at, "methods": payouts.configured_methods(a), "updated_at": a.updated_at}
            for a in qs.order_by("created_at")[:500]]  # fmt: skip


@router.post("/payout-accounts/{user_id}/verify", response=ConsoleOkOut)
def verify_account(request, user_id: str):
    staff(request)
    payouts.verify_and_notify(account=get_object_or_404(PayoutAccount, user_id=user_id))
    audit_request(request, "payout_account.verify", "user", user_id)
    return {"ok": True}
