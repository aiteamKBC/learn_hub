"""Console > Wallet: staff views a user's token balance, adjusts it, reads ledger."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from ninja import Field, Schema

from apps.commerce import wallet
from apps.commerce.wallet import InsufficientTokens
from core.errors import ServiceError

from .common import ConsoleOkOut, router, staff

User = get_user_model()


class ConsoleWalletBalanceOut(Schema):
    user_id: UUID
    balance: int
    expiring_within_7_days: int


class ConsoleWalletGrantOut(Schema):
    id: UUID
    source: str
    amount: int
    remaining: int
    unit_cost_gbp: Decimal | None
    granted_at: datetime
    expires_at: datetime | None
    expired_at: datetime | None
    note: str


class ConsoleWalletDetailOut(Schema):
    balance: ConsoleWalletBalanceOut
    grants: list[ConsoleWalletGrantOut]


class ConsoleWalletAdjustIn(Schema):
    amount: int = Field(..., description="Positive to add, negative to remove")
    note: str = Field(..., min_length=3, max_length=300)


class ConsoleWalletLedgerOut(Schema):
    id: UUID
    kind: str
    amount: int
    balance_after: int
    grant_id: UUID | None
    spend_id: UUID | None
    note: str
    created_at: datetime


@router.get("/wallet/user/{user_id}", response=ConsoleWalletDetailOut)
def wallet_detail(request, user_id: UUID):
    staff(request)
    user = get_object_or_404(User, pk=user_id)
    detail = wallet.get_balance_detail(user)

    from apps.commerce.models import TokenGrant

    grants = list(TokenGrant.objects.filter(user=user).order_by("-granted_at")[:50])
    return {
        "balance": {
            "user_id": user.id,
            "balance": detail["balance"],
            "expiring_within_7_days": detail["expiring_within_7_days"],
        },
        "grants": [
            {
                "id": g.id,
                "source": g.source,
                "amount": g.amount,
                "remaining": g.remaining,
                "unit_cost_gbp": g.unit_cost_gbp,
                "granted_at": g.granted_at,
                "expires_at": g.expires_at,
                "expired_at": g.expired_at,
                "note": g.note,
            }
            for g in grants
        ],
    }


@router.post("/wallet/user/{user_id}/adjust", response=ConsoleOkOut)
def wallet_adjust(request, user_id: UUID, body: ConsoleWalletAdjustIn):
    staff(request)
    user = get_object_or_404(User, pk=user_id)
    if body.amount == 0:
        raise ServiceError("zero_adjust", "Amount must be non-zero.", status=400)
    try:
        wallet.admin_adjust(
            user=user,
            amount=body.amount,
            note=body.note,
            actor=request.user,
            request=request,
        )
    except InsufficientTokens as e:
        raise ServiceError("insufficient_tokens", str(e), status=400) from e
    return {"ok": True}


@router.get("/wallet/user/{user_id}/ledger", response=list[ConsoleWalletLedgerOut])
def wallet_ledger(request, user_id: UUID, limit: int = 50):
    staff(request)
    user = get_object_or_404(User, pk=user_id)

    from apps.commerce.models import TokenLedgerEntry

    limit = max(1, min(limit, 200))
    entries = TokenLedgerEntry.objects.filter(user=user).order_by("-created_at")[:limit]
    return [
        {
            "id": e.id,
            "kind": e.kind,
            "amount": e.amount,
            "balance_after": e.balance_after,
            "grant_id": e.grant_id,
            "spend_id": e.spend_id,
            "note": e.note,
            "created_at": e.created_at,
        }
        for e in entries
    ]
