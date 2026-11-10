"""HTTP endpoints for payouts (instructors, /studio/payouts in the app). Thin: validate ->
call services/selectors -> return. Staff screens live in the console."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from django.db.models import Q
from django.utils import timezone
from ninja import Field, Router, Schema

from core.auth import session_auth
from core.errors import ServiceError

from . import selectors, services
from .models import CommissionRule, PayoutAccount, PayoutRequest, RevenueShare

router = Router(tags=["payouts"], auth=session_auth)

Method = Literal["stripe", "paypal", "wise", "bank"]


def _instructor(request):
    from apps.identity.models import InstructorProfile

    if (
        not InstructorProfile.objects.filter(user=request.user)
        .exclude(status__in=["pending", "rejected"])
        .exists()
    ):
        raise ServiceError("not_instructor", "Only instructors have payouts.", status=403)


# ---------------------------------------------------------------- schemas
class PayoutsBalanceOut(Schema):
    available: int
    pending: int
    paid: int
    in_payout: int


class PayoutsMethodOut(Schema):
    method: str
    label: str
    detail: str
    is_default: bool


class PayoutsRequestOut(Schema):
    id: UUID
    reference: str
    amount_gbp_minor: int
    method: str
    method_label: str
    status: str
    note: str
    reason: str
    provider_ref: str
    created_at: datetime
    decided_at: datetime | None
    paid_at: datetime | None
    payout_id: UUID | None  # the payout it became, so history can show it once


class PayoutsCourseRateOut(Schema):
    course: str
    keeps_pct: float


class PayoutsRatesOut(Schema):
    keeps_pct: float  # your own rate (or the default)
    fee_is_custom: bool
    default_keeps_pct: float
    instructor_rule_pct: float | None
    course_rules: list[PayoutsCourseRateOut]
    pool_pct: float


class PayoutsMeOut(Schema):
    balance: PayoutsBalanceOut
    minimum_gbp_minor: int
    hold_days: int
    schedule: str
    day_of_month: int
    next_payout_date: date
    requests_enabled: bool
    can_request: bool
    reason: str
    open_request: PayoutsRequestOut | None
    methods: list[PayoutsMethodOut]
    default_method: str | None
    verified: bool
    country: str
    rates: PayoutsRatesOut


class PayoutsRequestIn(Schema):
    amount_gbp_minor: int = Field(..., ge=1, le=100_000_000)
    method: Method
    note: str = Field("", max_length=300)


class PayoutsMethodIn(Schema):
    method: Method
    stripe_account_id: str = Field("", max_length=64)
    paypal_email: str = Field("", max_length=320)
    wise_email: str = Field("", max_length=320)
    bank_account_name: str = Field("", max_length=120)
    bank_sort_code_last2: str = Field("", max_length=2)
    bank_account_last4: str = Field("", max_length=4)
    country: str = Field("", max_length=2)
    make_default: bool = False


class PayoutsDefaultIn(Schema):
    method: Method


def _req(r: PayoutRequest) -> dict:
    return {"id": r.id, "reference": services.reference(r), "amount_gbp_minor": r.amount_gbp_minor,
            "method": r.method, "method_label": services.METHOD_LABEL.get(r.method, r.method), "status": r.status,
            "note": r.note, "reason": r.reason, "provider_ref": r.provider_ref, "created_at": r.created_at,
            "decided_at": r.decided_at, "paid_at": r.paid_at, "payout_id": r.payout_id}  # fmt: skip


def _rates(user) -> dict:
    from apps.catalog.models import Course, CourseInstructor

    own = services.instructor_fees([user.id]).get(user.id)
    default = services.default_fee_bps()
    rules = services.active_rules(timezone.now())
    mine = set(CourseInstructor.objects.filter(user=user).values_list("course_id", flat=True))
    course_rules = [r for r in rules if r.scope == CommissionRule.Scope.COURSE and r.target_id in mine]
    titles = dict(
        Course.objects.filter(pk__in=[r.target_id for r in course_rules]).values_list("id", "title")
    )
    inst = next((r for r in sorted(rules, key=lambda r: -r.priority)
                 if r.scope == CommissionRule.Scope.INSTRUCTOR and r.target_id == user.id), None)  # fmt: skip
    pool = RevenueShare.objects.filter(channel=RevenueShare.Channel.SUBSCRIPTION_POOL).first()
    return {
        "keeps_pct": round((10000 - (own if own is not None else default)) / 100, 2), "fee_is_custom": own is not None,
        "default_keeps_pct": round((10000 - default) / 100, 2),
        "instructor_rule_pct": round(inst.instructor_bps / 100, 2) if inst else None,
        "course_rules": [{"course": titles.get(r.target_id, ""), "keeps_pct": round(r.instructor_bps / 100, 2)}
                         for r in course_rules],
        "pool_pct": round(pool.instructor_bps / 100, 2) if pool else 0.0,
    }  # fmt: skip


def _me(request) -> dict:
    from apps.platform.services import get_setting

    state = services.request_status(user=request.user)
    account = PayoutAccount.objects.filter(user=request.user).first()
    bal = selectors.balance(user_id=request.user.id)
    return {
        "balance": bal, "minimum_gbp_minor": state["minimum_gbp_minor"], "hold_days": services.hold_days(),
        "schedule": get_setting("payouts.schedule"), "day_of_month": int(get_setting("payouts.day_of_month")),
        "next_payout_date": services.next_payout_date(),
        "requests_enabled": bool(get_setting("payouts.requests_enabled")),
        "can_request": state["can_request"], "reason": state["reason"],
        "open_request": _req(state["open_request"]) if state["open_request"] else None,
        "methods": services.configured_methods(account), "default_method": account.method if account else None,
        "verified": bool(account and account.verified_at), "country": account.country if account else "",
        "rates": _rates(request.user),
    }  # fmt: skip


# ---------------------------------------------------------------- endpoints
@router.get("/me", response=PayoutsMeOut)
def my_payouts(request):
    _instructor(request)
    return _me(request)


@router.get("/requests", response=list[PayoutsRequestOut])
def my_requests(request, status: str = ""):
    _instructor(request)
    qs = PayoutRequest.objects.filter(user=request.user)
    if status:
        qs = qs.filter(Q(status=status))
    return [_req(r) for r in qs.order_by("-created_at")[:100]]


@router.post("/requests", response=PayoutsRequestOut)
def request_payout(request, body: PayoutsRequestIn):
    """Available balance only: past the hold, at or above the minimum, one at a time."""
    _instructor(request)
    from core import html

    req = services.create_request(user=request.user, amount_gbp_minor=body.amount_gbp_minor, method=body.method,
                                  note=html.plain(body.note, 300))  # fmt: skip
    return _req(req)


@router.put("/methods", response=PayoutsMeOut)
def save_method(request, body: PayoutsMethodIn):
    """Bank details are a masked hint only (last digits); the transfer happens outside the app."""
    _instructor(request)
    services.save_method(user=request.user, **body.dict())
    return _me(request)


@router.put("/methods/default", response=PayoutsMeOut)
def set_default_method(request, body: PayoutsDefaultIn):
    _instructor(request)
    services.set_default_method(user=request.user, method=body.method)
    return _me(request)


@router.delete("/methods/{method}", response=PayoutsMeOut)
def remove_method(request, method: Method):
    _instructor(request)
    services.remove_method(user=request.user, method=method)
    return _me(request)
