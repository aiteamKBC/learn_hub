"""B2C-06 — Cash package service: checkout + fulfilment.

A cash package bundles N courses for a one-off price. On Stripe payment, each
included course gets a ContentEntitlement(source=cash_package, scope=course).
"""

from __future__ import annotations

from uuid import UUID

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.platform.models import ContentEntitlement
from apps.platform.services import audit

from . import gateway
from .models import CashPackage, CashPackageCourse, PriceTierAmount, Subscription


def owned_course_ids(user, course_ids: list) -> set:
    """Read-only: which of these courses the learner already has access to — via a purchase or
    token unlock (ContentEntitlement), an enrolment, or an active personal subscription. Used to
    note 'you already own these' and to block buying a bundle the learner fully owns. Does NOT
    record access (unlike the resolver), so it is safe to call when just listing."""
    if not course_ids or not getattr(user, "is_authenticated", False):
        return set()
    from apps.catalog.models import Course
    from apps.learning.models import Enrollment
    from apps.platform.models import ContentEntitlement

    now = timezone.now()
    owned: set = set(
        ContentEntitlement.objects.filter(
            user=user,
            scope=ContentEntitlement.Scope.COURSE,
            target_id__in=course_ids,
            revoked_at__isnull=True,
        )
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        .values_list("target_id", flat=True)
    )
    owned |= set(
        Enrollment.objects.filter(user=user, course_id__in=course_ids)
        .exclude(status__in=["revoked", "superseded"])
        .values_list("course_id", flat=True)
    )
    remaining = [c for c in course_ids if c not in owned]
    if remaining:
        from .services import plan_covers

        sub = (
            Subscription.objects.filter(
                user=user,
                org__isnull=True,
                plan__audience="personal",
                status__in=["trialing", "active"],
            )
            .select_related("plan")
            .order_by("-current_period_end")
            .first()
        )
        if sub:
            owned |= {c.id for c in Course.objects.filter(pk__in=remaining) if plan_covers(sub.plan, c)}
    return owned


def list_active_packages(currency_code: str, user=None) -> list[dict]:
    now = timezone.now()
    qs = CashPackage.objects.filter(is_active=True).select_related("price_tier")
    packages = []
    for pkg in qs:
        if pkg.starts_at and pkg.starts_at > now:
            continue
        if pkg.ends_at and pkg.ends_at < now:
            continue
        amount_row = PriceTierAmount.objects.filter(tier=pkg.price_tier, currency_id=currency_code).first()
        amount = amount_row.amount_minor if amount_row else pkg.price_tier.gbp_minor
        currency = currency_code if amount_row else "GBP"
        courses = list(
            CashPackageCourse.objects.filter(package=pkg)
            .select_related("course")
            .values_list("course_id", "course__title", "course__slug")
        )
        ids = [cid for cid, *_ in courses]
        owned = owned_course_ids(user, ids)
        packages.append(
            {
                "id": pkg.id,
                "name": pkg.name,
                "slug": pkg.slug,
                "description": pkg.description,
                "amount_minor": amount,
                "currency": currency,
                "price_tier_id": pkg.price_tier_id,
                "owned_count": len(owned),
                "courses": [{"id": cid, "title": title, "slug": slug} for cid, title, slug in courses],
            }
        )
    return packages


def create_package_checkout(
    *,
    user,
    package_id: UUID,
    currency_code: str,
    success_url: str,
    cancel_url: str,
    customer_email: str | None = None,
) -> dict:
    pkg = CashPackage.objects.select_related("price_tier").filter(pk=package_id, is_active=True).first()
    if pkg is None:
        from core.errors import ServiceError

        raise ServiceError("not_found", "Package not found or inactive.", status=404)

    now = timezone.now()
    if pkg.starts_at and pkg.starts_at > now:
        from core.errors import ServiceError

        raise ServiceError("not_available", "This package is not yet available.", status=400)
    if pkg.ends_at and pkg.ends_at < now:
        from core.errors import ServiceError

        raise ServiceError("expired", "This package has ended.", status=400)

    amount_row = PriceTierAmount.objects.filter(tier=pkg.price_tier, currency_id=currency_code).first()
    amount = amount_row.amount_minor if amount_row else pkg.price_tier.gbp_minor
    currency = currency_code if amount_row else "GBP"

    from .gateway import stripe_exponent

    exponent = stripe_exponent(currency)
    stripe_amount = gateway.to_stripe_amount(amount, currency, exponent)

    course_ids = list(CashPackageCourse.objects.filter(package=pkg).values_list("course_id", flat=True))

    # Block only when the learner already owns EVERY course in the bundle (nothing to gain).
    if course_ids and owned_course_ids(user, course_ids) >= set(course_ids):
        from core.errors import ServiceError

        raise ServiceError(
            "already_owned", "You already have access to every course in this package.", status=409
        )

    idempotency_key = f"cash_package:{pkg.id}:{user.id}:{pkg.updated_at.timestamp():.0f}"
    session = gateway.create_checkout_session(
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": currency.lower(),
                    "unit_amount": stripe_amount,
                    "product_data": {"name": f"{pkg.name} (Course package)"},
                },
                "quantity": 1,
            }
        ],
        metadata={
            "kind": "cash_package",
            "id": str(pkg.id),
            "user_id": str(user.id),
            "course_ids": ",".join(str(c) for c in course_ids),
        },
        customer_email=customer_email or user.email,
        success_url=success_url,
        cancel_url=cancel_url,
        idempotency_key=idempotency_key,
    )
    return {"url": session["url"]}


@transaction.atomic
def fulfil_package(*, session_id: str, user_id: UUID, package_id: UUID, course_id_strs: list[str]):
    """Called by the webhook after Stripe confirms payment. Creates entitlements."""
    from apps.identity.models import User

    user = User.objects.filter(pk=user_id).first()
    if user is None:
        return

    CashPackage.objects.filter(pk=package_id).first()
    now = timezone.now()

    for cid_str in course_id_strs:
        try:
            from uuid import UUID as _UUID

            cid = _UUID(cid_str)
        except ValueError:
            continue

        existing = (
            ContentEntitlement.objects.filter(
                user=user,
                scope=ContentEntitlement.Scope.COURSE,
                target_id=cid,
                source=ContentEntitlement.Source.CASH_PACKAGE,
                revoked_at__isnull=True,
                source_ref_kind="cash_package",
            )
            .filter(
                note__contains=session_id,
            )
            .first()
        )
        if existing:
            continue

        ContentEntitlement.objects.create(
            user=user,
            scope=ContentEntitlement.Scope.COURSE,
            target_id=cid,
            source=ContentEntitlement.Source.CASH_PACKAGE,
            source_ref=package_id,
            source_ref_kind="cash_package",
            granted_at=now,
            note=f"Package purchase, session {session_id}",
        )

    audit(
        "package.fulfil",
        "cash_package",
        str(package_id),
        actor_id=None,
        data={
            "user_id": str(user_id),
            "session_id": session_id,
            "courses": course_id_strs,
        },
    )
