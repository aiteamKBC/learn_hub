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
        .exclude(status__in=[Enrollment.Status.REVOKED, Enrollment.Status.SUPERSEDED, Enrollment.Status.EXPIRED])
        .filter(Q(access_expires_at__isnull=True) | Q(access_expires_at__gt=now))
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
                plan__kind="unlimited_b2c",
                status__in=["trialing", "active"],
                current_period_end__gt=now,
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
        from apps.catalog.models import Section
        from apps.platform.console.packages import _eligible

        links = list(CashPackageCourse.objects.filter(package=pkg).select_related(
            "course", "course__category", "course__created_by"))
        ids = [link.course_id for link in links]
        if not ids or _eligible().filter(pk__in=ids).count() != len(ids):
            continue
        owned = owned_course_ids(user, ids)
        # "was" price: what the included courses cost bought separately, in the SAME currency as
        # the package price — lets the UI show the saving. Never below the package price.
        from . import pricing

        quotes = pricing.quote(ids, currency) if ids else {}
        if len(quotes) != len(ids) or any(q.get("free") or q.get("list_minor") is None for q in quotes.values()):
            continue
        full_minor = sum(q["list_minor"] for q in quotes.values())
        if amount > full_minor:
            continue
        sections = Section.objects.filter(version_id__in=[link.course.live_version_id for link in links]).prefetch_related("lectures").order_by("position")
        curricula = {}
        for section in sections:
            curricula.setdefault(section.version_id, []).append({
                "title": section.title,
                "lectures": [{"title": lecture.title, "kind": lecture.kind} for lecture in section.lectures.all()],
            })
        packages.append(
            {
                "id": pkg.id,
                "name": pkg.name,
                "slug": pkg.slug,
                "description": pkg.description,
                "amount_minor": amount,
                "full_minor": full_minor,
                "currency": currency,
                "price_tier_id": pkg.price_tier_id,
                "owned_count": len(owned),
                "duration_sec": sum(link.course.total_duration_sec for link in links),
                "courses": [{"id": link.course_id, "title": link.course.title, "slug": link.course.slug,
                             "description": link.course.description, "thumbnail_url": link.course.thumbnail_url,
                             "category": link.course.category.name if link.course.category else "",
                             "instructor": link.course.created_by.full_name, "level": link.course.level,
                             "lecture_count": link.course.lecture_count,
                             "duration_sec": link.course.total_duration_sec,
                             "access_days": link.course.access_days,
                             "list_minor": quotes[link.course_id]["list_minor"],
                             "curriculum": curricula.get(link.course.live_version_id, [])}
                            for link in links],
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
    from .pricing import checkout_currency

    checkout_currency(currency_code)
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

    from .pricing import checkout_amount

    stripe_amount = checkout_amount(amount, currency)

    course_ids = list(CashPackageCourse.objects.filter(package=pkg).values_list("course_id", flat=True))
    from apps.platform.console.packages import _eligible
    from core.errors import ServiceError

    from . import pricing

    if not course_ids or _eligible().filter(pk__in=course_ids).count() != len(course_ids):
        raise ServiceError("invalid_courses", "This package is no longer available.", status=409)
    quotes = pricing.quote(course_ids, currency)
    if len(quotes) != len(course_ids) or any(q.get("free") or q.get("list_minor") is None for q in quotes.values()):
        raise ServiceError("missing_price", "A course in this package has no current cash price.", status=409)
    if amount > sum(q["list_minor"] for q in quotes.values()):
        raise ServiceError("price_too_high", "This package no longer saves money at the current prices.", status=409)

    # Block only when the learner already owns EVERY course in the bundle (nothing to gain).
    if course_ids and owned_course_ids(user, course_ids) >= set(course_ids):
        from core.errors import ServiceError

        raise ServiceError(
            "already_owned", "You already have access to every course in this package.", status=409
        )

    from . import package_finance

    order = package_finance.prepare_order(
        user=user, course_ids=course_ids, currency_code=currency, amount=amount, quotes=quotes,
    )
    idempotency_key = f"cash_package_order:{order.id}"
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
            "order_id": str(order.id),
        },
        customer_email=customer_email or user.email,
        success_url=success_url,
        cancel_url=cancel_url,
        idempotency_key=idempotency_key,
    )
    from .models import Order

    Order.objects.filter(pk=order.id).update(stripe_session_id=session["id"])
    return {"url": session["url"]}


@transaction.atomic
def fulfil_package(*, session_id: str, user_id: UUID, package_id: UUID, course_id_strs: list[str]):
    """Called by the webhook after payment; grant access and a usable learning enrolment."""
    from datetime import timedelta

    from apps.catalog.models import Course
    from apps.identity.models import User
    from apps.learning import services as learning
    from apps.learning.models import Enrollment

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
        course = Course.objects.filter(pk=cid, live_version__isnull=False).first()
        if course is None:
            continue
        expiry = now + timedelta(days=course.access_days) if course.access_days else None
        if not existing:
            ContentEntitlement.objects.create(
                user=user,
                scope=ContentEntitlement.Scope.COURSE,
                target_id=cid,
                source=ContentEntitlement.Source.CASH_PACKAGE,
                source_ref=package_id,
                source_ref_kind="cash_package",
                granted_at=now,
                expires_at=expiry,
                note=f"Package purchase, session {session_id}",
            )
        purchase_expiry = existing.expires_at if existing else expiry
        enrolment = learning.enrol(
            user=user,
            course=course,
            source=Enrollment.Source.PURCHASE,
            source_ref=package_id,
            access_expires_at=purchase_expiry,
        )
        # A repurchase after access has expired renews the same enrolment, retaining its
        # progress and any valid historical access.  Existing, still-valid access is never
        # shortened or replaced by a package purchase.
        has_valid_access = (
            enrolment.status in (Enrollment.Status.ACTIVE, Enrollment.Status.COMPLETED)
            and (enrolment.access_expires_at is None or enrolment.access_expires_at > now)
        )
        if not has_valid_access:
            fields = ["access_expires_at", "updated_at"]
            enrolment.access_expires_at = purchase_expiry
            if enrolment.status != Enrollment.Status.COMPLETED:
                enrolment.status = Enrollment.Status.ACTIVE
                fields.append("status")
            enrolment.source = Enrollment.Source.PURCHASE
            enrolment.source_ref = package_id
            fields.extend(["source", "source_ref"])
            enrolment.save(update_fields=fields)

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
