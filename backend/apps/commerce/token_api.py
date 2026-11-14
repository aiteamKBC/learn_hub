"""B2C-04 — Learner-facing token API: wallet, packs, top-up, rate.

Endpoints under /api/v1/commerce/tokens/*. Authenticated via session.
Stripe checkout is server-authoritative: the client never sends amounts.
"""

from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from django.shortcuts import get_object_or_404
from ninja import Field, Router, Schema

from apps.commerce import gateway, wallet
from apps.commerce.models import (
    PriceTierAmount,
    TokenPack,
    TokenRate,
    TopUpPolicy,
)
from apps.commerce.wallet import InsufficientTokens
from core.auth import session_auth
from core.errors import ServiceError
from core.money import request_currency

router = Router(tags=["tokens"], auth=session_auth)


# ---------------------------------------------------------------- schemas
class TokenBalanceOut(Schema):
    balance: int
    expiring_within_7_days: int


class TokenGrantOut(Schema):
    id: UUID
    source: str
    amount: int
    remaining: int
    granted_at: str
    expires_at: str | None
    note: str


class TokenLedgerOut(Schema):
    id: UUID
    kind: str
    amount: int
    balance_after: int
    note: str
    created_at: str


class TokenPackOut(Schema):
    id: UUID
    name: str
    token_amount: int
    price_tier_id: UUID
    amount_minor: int
    currency: str
    sort_order: int


class TokenRateOut(Schema):
    tokens_per_gbp_minor: str
    token_price_gbp: str
    effective_from: str


class TopUpLimitsOut(Schema):
    currency: str
    min_minor: int
    max_minor: int


class CheckoutUrlOut(Schema):
    url: str


# ---------------------------------------------------------------- wallet
@router.get("/wallet/balance", response=TokenBalanceOut)
def my_balance(request):
    detail = wallet.get_balance_detail(request.user)
    return detail


@router.get("/wallet/grants", response=list[TokenGrantOut])
def my_grants(request, limit: int = 50):
    from apps.commerce.models import TokenGrant

    limit = max(1, min(limit, 200))
    grants = TokenGrant.objects.filter(user=request.user).order_by("-granted_at")[:limit]
    return [
        {
            "id": g.id,
            "source": g.source,
            "amount": g.amount,
            "remaining": g.remaining,
            "granted_at": g.granted_at.isoformat(),
            "expires_at": g.expires_at.isoformat() if g.expires_at else None,
            "note": g.note,
        }
        for g in grants
    ]


@router.get("/wallet/ledger", response=list[TokenLedgerOut])
def my_ledger(request, limit: int = 50):
    from apps.commerce.models import TokenLedgerEntry

    limit = max(1, min(limit, 200))
    entries = TokenLedgerEntry.objects.filter(user=request.user).order_by("-created_at")[:limit]
    return [
        {
            "id": e.id,
            "kind": e.kind,
            "amount": e.amount,
            "balance_after": e.balance_after,
            "note": e.note,
            "created_at": e.created_at.isoformat(),
        }
        for e in entries
    ]


# ---------------------------------------------------------------- packs
@router.get("/packs", response=list[TokenPackOut], auth=None)
def list_packs(request, currency: str | None = None):
    cur = request_currency(request, currency)
    packs = TokenPack.objects.filter(is_active=True).select_related("price_tier").order_by("sort_order")
    amounts = {
        a.tier_id: a.amount_minor
        for a in PriceTierAmount.objects.filter(
            currency_id=cur["code"], tier_id__in=[p.price_tier_id for p in packs]
        )
    }
    return [
        {
            "id": p.id,
            "name": p.name,
            "token_amount": p.token_amount,
            "price_tier_id": p.price_tier_id,
            "amount_minor": amounts.get(p.price_tier_id, p.price_tier.gbp_minor),
            "currency": cur["code"],
            "sort_order": p.sort_order,
        }
        for p in packs
    ]


class PackCheckoutIn(Schema):
    success_url: str = Field(..., min_length=1)
    cancel_url: str = Field(..., min_length=1)
    customer_email: str | None = None  # override for Stripe receipt email


@router.post("/packs/{pack_id}/checkout", response=CheckoutUrlOut)
def pack_checkout(request, pack_id: UUID, body: PackCheckoutIn):
    pack = get_object_or_404(TokenPack, pk=pack_id, is_active=True)
    cur = request_currency(request)
    tier = pack.price_tier
    amount_row = PriceTierAmount.objects.filter(tier=tier, currency_id=cur["code"]).first()
    amount = amount_row.amount_minor if amount_row else tier.gbp_minor
    currency_code = cur["code"] if amount_row else "GBP"
    stripe_amount = gateway.to_stripe_amount(amount, currency_code, cur.get("exponent", 2))

    idempotency_key = f"token_pack:{pack.id}:{request.user.id}:{pack.updated_at.timestamp():.0f}"
    session = gateway.create_checkout_session(
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": currency_code.lower(),
                    "unit_amount": stripe_amount,
                    "product_data": {"name": f"{pack.name} ({pack.token_amount} tokens)"},
                },
                "quantity": 1,
            }
        ],
        metadata={
            "kind": "token_pack",
            "id": str(pack.id),
            "user_id": str(request.user.id),
            "token_amount": str(pack.token_amount),
        },
        customer_email=body.customer_email or request.user.email,
        success_url=body.success_url,
        cancel_url=body.cancel_url,
        idempotency_key=idempotency_key,
    )
    return {"url": session["url"]}


# ---------------------------------------------------------------- unlock
class UnlockIn(Schema):
    scope: str = Field(..., pattern="^(course|lecture|material)$")
    target_id: UUID


class UnlockOut(Schema):
    entitlement_id: UUID
    scope: str
    target_id: UUID
    tokens_spent: int


@router.post("/unlock", response=UnlockOut)
def unlock_content(request, body: UnlockIn):
    from apps.commerce.unlock import AlreadyUnlocked, NoPriceSet

    from . import unlock

    try:
        if body.scope == "course":
            ent = unlock.unlock_course(user=request.user, course_id=body.target_id, request=request)
            from apps.catalog.models import Course

            price = (
                Course.objects.filter(pk=body.target_id)
                .values_list("full_course_token_price", flat=True)
                .first()
                or 0
            )
        elif body.scope == "lecture":
            ent = unlock.unlock_lecture(user=request.user, lecture_id=body.target_id, request=request)
            from apps.catalog.models import Lecture

            price = (
                Lecture.objects.filter(pk=body.target_id).values_list("token_price", flat=True).first() or 0
            )
        else:
            ent = unlock.unlock_material(user=request.user, material_id=body.target_id, request=request)
            from apps.catalog.models import LectureResource

            price = (
                LectureResource.objects.filter(pk=body.target_id)
                .values_list("token_price", flat=True)
                .first()
                or 0
            )
    except AlreadyUnlocked as e:
        raise ServiceError("already_unlocked", str(e), status=409) from e
    except NoPriceSet as e:
        raise ServiceError("no_price", str(e), status=400) from e
    except InsufficientTokens as e:
        raise ServiceError("insufficient_tokens", str(e), status=402) from e
    except ValueError as e:
        raise ServiceError("not_found", str(e), status=404) from e

    return {
        "entitlement_id": ent.id,
        "scope": ent.scope,
        "target_id": ent.target_id,
        "tokens_spent": price,
    }


# ---------------------------------------------------------------- access check
class AccessOut(Schema):
    allowed: bool
    reason: str
    source: str
    entitlement_id: UUID | None = None
    expires_at: str | None = None


@router.get("/access/{scope}/{target_id}", response=AccessOut)
def check_access(request, scope: str, target_id: UUID):
    from apps.platform.access import resolve

    if scope not in ("course", "lecture", "material"):
        raise ServiceError("invalid_scope", "Scope must be course, lecture, or material.", status=400)
    decision = resolve(request.user, scope, target_id)
    return {
        "allowed": decision.allowed,
        "reason": decision.reason_code,
        "source": decision.source,
        "entitlement_id": decision.entitlement_id,
        "expires_at": decision.expires_at.isoformat() if decision.expires_at else None,
    }


# ---------------------------------------------------------------- custom top-up
@router.get("/rate", response=TokenRateOut | None, auth=None)
def current_rate(request):
    r = TokenRate.current()
    if r is None:
        return None
    return {
        "tokens_per_gbp_minor": str(r.tokens_per_gbp_minor),
        "token_price_gbp": str((Decimal("0.01") / r.tokens_per_gbp_minor).quantize(Decimal("0.000001"))),
        "effective_from": r.effective_from.isoformat(),
    }


@router.get("/topup-limits", response=TopUpLimitsOut | None, auth=None)
def topup_limits(request, currency: str | None = None):
    cur = request_currency(request, currency)
    policy = TopUpPolicy.objects.filter(currency=cur["code"], is_active=True).first()
    if not policy:
        return None
    return {"currency": policy.currency, "min_minor": policy.min_minor, "max_minor": policy.max_minor}


class TopUpCheckoutIn(Schema):
    amount_minor: int = Field(..., ge=1)
    currency: str = Field("GBP", min_length=3, max_length=3)
    success_url: str = Field(..., min_length=1)
    cancel_url: str = Field(..., min_length=1)
    customer_email: str | None = None


@router.post("/topup/checkout", response=CheckoutUrlOut)
def topup_checkout(request, body: TopUpCheckoutIn):
    code = body.currency.upper()
    policy = TopUpPolicy.objects.filter(currency=code, is_active=True).first()
    if policy:
        if body.amount_minor < policy.min_minor:
            raise ServiceError("topup_below_min", f"Minimum is {policy.min_minor} {code} minor.", status=400)
        if body.amount_minor > policy.max_minor:
            raise ServiceError("topup_above_max", f"Maximum is {policy.max_minor} {code} minor.", status=400)

    rate = TokenRate.current()
    if rate is None:
        raise ServiceError("no_rate", "No active token rate. Contact support.", status=503)

    from apps.commerce.models import Currency as CurrencyModel
    from apps.commerce.models import FxRate

    if code == "GBP":
        gbp_minor = body.amount_minor
    else:
        fx = FxRate.objects.filter(currency_id=code).order_by("-rate_date").first()
        if fx is None:
            raise ServiceError("no_fx", f"No exchange rate for {code}.", status=400)
        gbp_minor = int(
            (Decimal(str(body.amount_minor)) / fx.rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )

    token_amount = int(
        (Decimal(str(gbp_minor)) * rate.tokens_per_gbp_minor).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )
    if token_amount <= 0:
        raise ServiceError("topup_too_small", "Amount too small to yield any tokens.", status=400)

    cur_obj = CurrencyModel.objects.filter(code=code).first()
    exponent = cur_obj.exponent if cur_obj else 2
    stripe_amount = gateway.to_stripe_amount(body.amount_minor, code, exponent)

    import time

    idempotency_key = f"token_topup:{request.user.id}:{body.amount_minor}:{code}:{int(time.time()) // 60}"
    session = gateway.create_checkout_session(
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": code.lower(),
                    "unit_amount": stripe_amount,
                    "product_data": {"name": f"Token top-up ({token_amount} tokens)"},
                },
                "quantity": 1,
            }
        ],
        metadata={
            "kind": "token_topup",
            "user_id": str(request.user.id),
            "token_amount": str(token_amount),
            "amount_minor": str(body.amount_minor),
            "currency": code,
            "rate_id": str(rate.id),
            "gbp_minor": str(gbp_minor),
        },
        customer_email=body.customer_email or request.user.email,
        success_url=body.success_url,
        cancel_url=body.cancel_url,
        idempotency_key=idempotency_key,
    )
    return {"url": session["url"]}


# ---------------------------------------------------------------- cash packages
class PackageCourseOut(Schema):
    id: UUID
    title: str
    slug: str


class CashPackageOut(Schema):
    id: UUID
    name: str
    slug: str
    description: str
    amount_minor: int
    currency: str
    owned_count: int = 0  # how many of this package's courses the viewer already has
    courses: list[PackageCourseOut]


@router.get("/packages", response=list[CashPackageOut], auth=None)
def list_packages(request, currency: str | None = None):
    from . import packages

    cur = request_currency(request, currency)
    user = request.user if getattr(request.user, "is_authenticated", False) else None
    return packages.list_active_packages(cur["code"], user=user)


# ---------------------------------------------------------------- subscriptions
class UnlimitedPlanOut(Schema):
    id: UUID
    code: str
    name: str
    interval: str
    trial_days: int
    description: str
    amount_minor: int
    currency: str


class ActiveSubOut(Schema):
    id: UUID
    plan_code: str
    plan_name: str
    status: str
    interval: str
    current_period_end: str | None = None
    cancel_at_period_end: bool


@router.get("/subscriptions/plans", response=list[UnlimitedPlanOut], auth=None)
def list_subscription_plans(request, currency: str | None = None):
    from . import subscriptions

    cur = request_currency(request, currency)
    return subscriptions.list_unlimited_plans(cur["code"])


@router.get("/subscriptions/me", response=ActiveSubOut | None)
def my_subscription(request):
    from . import subscriptions

    return subscriptions.get_active_subscription(request.user)


class SubCheckoutIn(Schema):
    plan_id: UUID
    success_url: str = Field(..., min_length=1)
    cancel_url: str = Field(..., min_length=1)
    customer_email: str | None = None


@router.post("/subscriptions/checkout", response=CheckoutUrlOut)
def subscription_checkout(request, body: SubCheckoutIn):
    from . import subscriptions

    cur = request_currency(request)
    result = subscriptions.create_subscription_checkout(
        user=request.user,
        plan_id=body.plan_id,
        currency_code=cur["code"],
        success_url=body.success_url,
        cancel_url=body.cancel_url,
        customer_email=body.customer_email,
    )
    return {"url": result["url"]}


class PackageCheckoutIn(Schema):
    success_url: str = Field(..., min_length=1)
    cancel_url: str = Field(..., min_length=1)
    customer_email: str | None = None


@router.post("/packages/{package_id}/checkout", response=CheckoutUrlOut)
def package_checkout(request, package_id: UUID, body: PackageCheckoutIn):
    from . import packages

    cur = request_currency(request)
    result = packages.create_package_checkout(
        user=request.user,
        package_id=package_id,
        currency_code=cur["code"],
        success_url=body.success_url,
        cancel_url=body.cancel_url,
        customer_email=body.customer_email,
    )
    return {"url": result["url"]}
