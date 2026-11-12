"""B2C-02 — Token wallet: grant, FEFO spend, admin adjust, expiry.

Invariants
----------
- Tokens are integers. Money is Decimal(12,2). Rate is Decimal(12,4).
- FEFO ordering: expires_at ASC NULLS LAST, granted_at ASC, id ASC.
- Atomic spend: SELECT … FOR UPDATE prevents double-debit.
- Idempotent grant on stripe_session_id (webhook replay safety).
- No default expiry invented (T03 BLOCKED).
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Case, Q, Sum, Value, When
from django.utils import timezone

from apps.platform.services import audit, audit_request


class InsufficientTokens(Exception):
    pass


def _balance_qs(user):
    from apps.commerce.models import TokenGrant

    return TokenGrant.objects.filter(
        user=user,
        remaining__gt=0,
        expired_at__isnull=True,
    )


def get_balance(user) -> int:
    return _balance_qs(user).aggregate(total=Sum("remaining"))["total"] or 0


def get_balance_detail(user) -> dict:
    now = timezone.now()
    from datetime import timedelta

    soon = now + timedelta(days=7)
    qs = _balance_qs(user)
    total = qs.aggregate(t=Sum("remaining"))["t"] or 0
    expiring_soon = (
        qs.filter(expires_at__isnull=False, expires_at__lte=soon).aggregate(t=Sum("remaining"))["t"] or 0
    )
    return {
        "balance": total,
        "expiring_within_7_days": expiring_soon,
    }


def _audit_wallet(action, target_type, target_id, *, actor, data, request=None):
    if request is not None:
        audit_request(request, action, target_type, str(target_id), data)
    else:
        actor_id = getattr(actor, "id", None) if actor else None
        audit(action, target_type, str(target_id), actor_id=actor_id, data=data)


@transaction.atomic
def grant_tokens(
    *,
    user,
    source: str,
    amount: int,
    unit_cost_gbp=None,
    expires_at=None,
    source_ref="",
    stripe_session_id=None,
    note="",
    actor=None,
    request=None,
):
    from apps.commerce.models import TokenGrant, TokenLedgerEntry

    if amount <= 0:
        raise ValueError("amount must be > 0")

    if stripe_session_id:
        existing = TokenGrant.objects.filter(stripe_session_id=stripe_session_id).first()
        if existing:
            return existing

    now = timezone.now()
    cost = Decimal(str(unit_cost_gbp)) if unit_cost_gbp is not None else None

    grant = TokenGrant.objects.create(
        user=user,
        source=source,
        amount=amount,
        remaining=amount,
        unit_cost_gbp=cost,
        granted_at=now,
        expires_at=expires_at,
        source_ref=source_ref,
        stripe_session_id=stripe_session_id,
        note=note,
    )

    balance = get_balance(user)

    TokenLedgerEntry.objects.create(
        user=user,
        kind=TokenLedgerEntry.Kind.GRANT,
        amount=amount,
        balance_after=balance,
        grant=grant,
        note=note,
    )

    _audit_wallet(
        "wallet.grant",
        "token_grant",
        grant.id,
        actor=actor,
        data={
            "source": source,
            "amount": amount,
            "unit_cost_gbp": str(cost) if cost else None,
            "expires_at": expires_at.isoformat() if expires_at else None,
        },
        request=request,
    )
    return grant


@transaction.atomic
def spend_tokens(
    *,
    user,
    scope: str,
    target_id,
    tokens: int,
    course_id=None,
    instructor_id=None,
    entitlement=None,
    actor=None,
    request=None,
):
    from apps.commerce.models import TokenGrant, TokenLedgerEntry, TokenSpend

    if tokens <= 0:
        raise ValueError("tokens must be > 0")

    grants = list(
        TokenGrant.objects.select_for_update()
        .filter(user=user, remaining__gt=0, expired_at__isnull=True)
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()))
        .annotate(
            _nulls_last=Case(
                When(expires_at__isnull=True, then=Value(1)),
                default=Value(0),
            )
        )
        .order_by("_nulls_last", "expires_at", "granted_at", "id")
    )

    available = sum(g.remaining for g in grants)
    if available < tokens:
        raise InsufficientTokens(f"Need {tokens} tokens but only {available} available.")

    to_consume = tokens
    cost_parts = []

    for grant in grants:
        if to_consume <= 0:
            break
        take = min(grant.remaining, to_consume)
        if grant.unit_cost_gbp is not None:
            cost_parts.append((take, grant.unit_cost_gbp))
        grant.remaining -= take
        grant.save(update_fields=["remaining", "updated_at"])
        to_consume -= take

    weighted_cost = None
    if cost_parts:
        total_qty = sum(q for q, _ in cost_parts)
        if total_qty > 0:
            weighted_cost = sum(Decimal(str(q)) * Decimal(str(c)) for q, c in cost_parts) / Decimal(
                str(total_qty)
            )
            weighted_cost = weighted_cost.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)

    spend = TokenSpend.objects.create(
        user=user,
        scope=scope,
        target_id=target_id,
        tokens_total=tokens,
        weighted_unit_cost_gbp=weighted_cost,
        course_id=course_id,
        instructor_id=instructor_id,
        entitlement=entitlement,
    )

    balance = get_balance(user)

    TokenLedgerEntry.objects.create(
        user=user,
        kind=TokenLedgerEntry.Kind.SPEND,
        amount=-tokens,
        balance_after=balance,
        spend=spend,
        note=f"Unlock {scope}:{target_id}",
    )

    _audit_wallet(
        "wallet.spend",
        "token_spend",
        spend.id,
        actor=actor,
        data={
            "scope": scope,
            "target_id": str(target_id),
            "tokens": tokens,
            "weighted_unit_cost_gbp": str(weighted_cost) if weighted_cost else None,
        },
        request=request,
    )
    return spend


@transaction.atomic
def admin_adjust(*, user, amount: int, note: str, actor, request=None):
    from apps.commerce.models import TokenGrant, TokenLedgerEntry

    if amount == 0:
        raise ValueError("amount must be non-zero")

    if not getattr(actor, "is_staff", False):
        raise PermissionError("Staff only.")

    if amount > 0:
        grant = grant_tokens(
            user=user,
            source="admin",
            amount=amount,
            note=note,
            actor=actor,
            request=request,
        )
        return grant
    else:
        to_remove = abs(amount)
        balance = get_balance(user)
        if balance < to_remove:
            raise InsufficientTokens(f"Cannot remove {to_remove} tokens; balance is {balance}.")

        grants = list(
            TokenGrant.objects.select_for_update()
            .filter(user=user, remaining__gt=0, expired_at__isnull=True)
            .order_by("-expires_at", "-granted_at", "-id")
        )

        remaining_to_remove = to_remove
        for grant in grants:
            if remaining_to_remove <= 0:
                break
            take = min(grant.remaining, remaining_to_remove)
            grant.remaining -= take
            grant.save(update_fields=["remaining", "updated_at"])
            remaining_to_remove -= take

        new_balance = get_balance(user)

        TokenLedgerEntry.objects.create(
            user=user,
            kind=TokenLedgerEntry.Kind.ADMIN_CLAWBACK,
            amount=-to_remove,
            balance_after=new_balance,
            note=note,
        )

        _audit_wallet(
            "wallet.admin_clawback",
            "token_grant",
            str(user.id),
            actor=actor,
            data={"removed": to_remove, "note": note, "balance_after": new_balance},
            request=request,
        )
        return {"removed": to_remove, "balance_after": new_balance}


def expire_grants():
    from apps.commerce.models import TokenGrant, TokenLedgerEntry

    now = timezone.now()
    expirable = TokenGrant.objects.filter(
        expires_at__lte=now,
        remaining__gt=0,
        expired_at__isnull=True,
    ).select_for_update()

    expired_count = 0
    for grant in expirable:
        lost = grant.remaining
        grant.remaining = 0
        grant.expired_at = now
        grant.save(update_fields=["remaining", "expired_at", "updated_at"])

        balance = get_balance(grant.user)

        TokenLedgerEntry.objects.create(
            user=grant.user,
            kind=TokenLedgerEntry.Kind.EXPIRY,
            amount=-lost,
            balance_after=balance,
            grant=grant,
            note=f"Grant {grant.id} expired",
        )
        expired_count += 1

    return expired_count
