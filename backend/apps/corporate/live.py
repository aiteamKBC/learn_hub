"""B2B-03: Live training request + cohort lifecycle services."""

from __future__ import annotations

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.platform.services import audit_request
from core.errors import ServiceError

from .models import CohortCompany, LiveCohort, TrainingRequest


def live_subscription_coverage(org_id, *, booking_created_at=None, now=None, snapshot=None):
    """Return current Team Live quota and usage, or None when no quota applies."""
    if snapshot is not None:
        if booking_created_at is not None and booking_created_at < snapshot["effective_at"]:
            return None
        return snapshot

    from apps.commerce.models import Plan, Subscription

    now = now or timezone.now()
    qs = Subscription.objects.filter(
        org_id=org_id,
        plan__audience=Plan.Audience.TEAM,
        plan__live_seat_cap__gt=0,
        plan__live_seat_cap_effective_at__isnull=False,
        status__in=[
            Subscription.Status.ACTIVE,
            Subscription.Status.TRIALING,
            Subscription.Status.PAST_DUE,
        ],
        current_period_end__gt=now,
    ).select_related("plan")
    if booking_created_at is not None:
        qs = qs.filter(plan__live_seat_cap_effective_at__lte=booking_created_at)
    subscription = qs.order_by("-current_period_end", "-created_at").first()
    if subscription is None:
        return None
    used = (
        CohortCompany.objects.filter(
            included_subscription=subscription,
            included_period_end=subscription.current_period_end,
        )
        .exclude(status__in=[CohortCompany.Status.CANCELLED, CohortCompany.Status.WITHDRAWN])
        .aggregate(total=Sum("included_seats"))["total"]
        or 0
    )
    return {
        "subscription": subscription,
        "period_end": subscription.current_period_end,
        "effective_at": subscription.plan.live_seat_cap_effective_at,
        "cap": subscription.plan.live_seat_cap,
        "used": used,
        "remaining": max(0, subscription.plan.live_seat_cap - used),
    }


@transaction.atomic
def accept_included_live_booking(request, *, org_id, cohort_company_id):
    """Accept an offered booking against the current Team subscription quota.

    Locking the eligible subscription serializes acceptances across cohorts for the
    same subscription, so parallel requests cannot exceed the cap.
    """
    from apps.commerce.models import Plan, Subscription

    cc = CohortCompany.objects.select_for_update().filter(pk=cohort_company_id, org_id=org_id).first()
    if cc is None:
        raise ServiceError("not_found", "Booking not found.", status=404)
    if cc.status != CohortCompany.Status.OFFERED:
        raise ServiceError(
            "booking_not_offered", "This booking is no longer awaiting a response.", status=409
        )
    if cc.cohort.status not in (LiveCohort.Status.CONFIRMED, LiveCohort.Status.PENDING_PAY):
        raise ServiceError("cohort_not_confirmed", "The cohort is not ready to accept bookings.", status=409)

    now = timezone.now()
    subscription_id = (
        Subscription.objects.filter(
            org_id=org_id,
            plan__audience=Plan.Audience.TEAM,
            plan__live_seat_cap__gt=0,
            plan__live_seat_cap_effective_at__lte=cc.created_at,
            status__in=[
                Subscription.Status.ACTIVE,
                Subscription.Status.TRIALING,
                Subscription.Status.PAST_DUE,
            ],
            current_period_end__gt=now,
        )
        .order_by("-current_period_end", "-created_at")
        .values_list("id", flat=True)
        .first()
    )
    subscription = (
        Subscription.objects.select_for_update().filter(pk=subscription_id, org_id=org_id).first()
        if subscription_id
        else None
    )
    if (
        subscription is None
        or subscription.status
        not in (Subscription.Status.ACTIVE, Subscription.Status.TRIALING, Subscription.Status.PAST_DUE)
        or subscription.current_period_end is None
        or subscription.current_period_end <= now
        or subscription.plan.audience != Plan.Audience.TEAM
        or subscription.plan.live_seat_cap is None
        or subscription.plan.live_seat_cap < 1
        or subscription.plan.live_seat_cap_effective_at is None
        or subscription.plan.live_seat_cap_effective_at > cc.created_at
    ):
        raise ServiceError("no_live_coverage", "There is no active Team Live seat allowance.", status=409)
    used = (
        CohortCompany.objects.filter(
            included_subscription=subscription,
            included_period_end=subscription.current_period_end,
        )
        .exclude(status__in=[CohortCompany.Status.CANCELLED, CohortCompany.Status.WITHDRAWN])
        .aggregate(total=Sum("included_seats"))["total"]
        or 0
    )
    remaining = subscription.plan.live_seat_cap - used
    if cc.approved_seats > remaining:
        raise ServiceError(
            "live_seat_cap_reached",
            f"This booking needs {cc.approved_seats} seats; {max(0, remaining)} included seats remain until renewal.",
            status=409,
        )

    cc.status = CohortCompany.Status.INCLUDED
    cc.included_subscription = subscription
    cc.included_period_end = subscription.current_period_end
    cc.included_seats = cc.approved_seats
    cc.save(
        update_fields=[
            "status",
            "included_subscription",
            "included_period_end",
            "included_seats",
            "updated_at",
        ]
    )
    audit_request(
        request,
        "live_booking_included",
        "cohort_company",
        cc.id,
        data={"subscription_id": str(subscription.id), "seats": cc.included_seats},
    )
    return cc


@transaction.atomic
def submit_request(
    request, course_id, seats: int, preferred_intake="", preferred_delivery="", company_message=""
) -> TrainingRequest:
    org_id = getattr(request, "org_id", None)
    if org_id is None:
        raise ServiceError("no_org", "Organization context required.", status=400)
    from .models import CorporateOffering

    offered = CorporateOffering.objects.filter(
        course_id=course_id, delivery_type="live", is_active=True, price_tier__gbp_minor__gt=0
    ).exists()
    if not offered:
        raise ServiceError("live_not_offered", "Live training is not offered for this course.", status=400)

    tr = TrainingRequest.objects.create(
        org_id=org_id,
        course_id=course_id,
        requester=request.user,
        requested_seats=seats,
        preferred_intake=preferred_intake,
        preferred_delivery_mode=preferred_delivery,
        company_message=company_message.strip()[:2000],
        status=TrainingRequest.Status.SUBMITTED,
        status_label="Under Review",
    )

    audit_request(
        request,
        "training_request_submitted",
        "training_request",
        tr.id,
        data={"course_id": str(course_id), "seats": seats},
    )
    return tr


def cancel_request(request, request_id) -> TrainingRequest:
    tr = TrainingRequest.objects.filter(
        pk=request_id,
        org_id=getattr(request, "org_id", None),
    ).first()
    if tr is None:
        raise ServiceError("not_found", "Training request not found.", status=404)
    if tr.status not in (TrainingRequest.Status.SUBMITTED, TrainingRequest.Status.UNDER_REVIEW):
        raise ServiceError(
            "not_cancellable", "Only submitted or under-review requests can be cancelled.", status=400
        )

    tr.status = TrainingRequest.Status.CANCELLED
    tr.status_label = "Cancelled"
    tr.save(update_fields=["status", "status_label", "updated_at"])

    audit_request(request, "training_request_cancelled", "training_request", tr.id)
    return tr


@transaction.atomic
def create_cohort(
    request, *, course_id, delivery_mode, max_learners, min_learners=1, intake="", title="", notes=""
) -> LiveCohort:
    cohort = LiveCohort.objects.create(
        course_id=course_id,
        title=title,
        intake=intake,
        delivery_mode=delivery_mode,
        min_learners=min_learners,
        max_learners=max_learners,
        notes=notes,
    )
    audit_request(
        request,
        "cohort_created",
        "live_cohort",
        cohort.id,
        data={"course_id": str(course_id), "delivery_mode": delivery_mode},
    )
    return cohort


@transaction.atomic
def add_company_to_cohort(request, cohort_id, org_id, seats, training_request_id=None) -> CohortCompany:
    cohort = LiveCohort.objects.select_for_update().filter(pk=cohort_id).first()
    if cohort is None:
        raise ServiceError("cohort_not_found", "Cohort not found.", status=404)
    if cohort.status not in (LiveCohort.Status.FORMING, LiveCohort.Status.CONFIRMED):
        raise ServiceError("cohort_not_open", "Cohort is not accepting companies.", status=400)

    if cohort.current_seats + seats > cohort.max_learners:
        raise ServiceError("cohort_full", "Adding these seats exceeds cohort capacity.", status=409)

    if CohortCompany.objects.filter(cohort=cohort, org_id=org_id).exists():
        raise ServiceError("already_in_cohort", "Company is already in this cohort.", status=409)

    cc = CohortCompany.objects.create(
        org_id=org_id,
        cohort=cohort,
        training_request_id=training_request_id,
        approved_seats=seats,
        status=CohortCompany.Status.INTERESTED,
    )

    cohort.current_seats = (
        CohortCompany.objects.filter(cohort=cohort)
        .exclude(status__in=["cancelled", "withdrawn"])
        .aggregate(total=Sum("approved_seats"))["total"]
        or 0
    )
    cohort.save(update_fields=["current_seats", "updated_at"])

    if training_request_id:
        TrainingRequest.objects.filter(pk=training_request_id).update(
            status=TrainingRequest.Status.SCHEDULING,
            status_label="Scheduling",
            updated_at=timezone.now(),
        )

    audit_request(
        request,
        "company_added_to_cohort",
        "cohort_company",
        cc.id,
        data={"cohort_id": str(cohort_id), "org_id": str(org_id), "seats": seats},
    )
    return cc


@transaction.atomic
def remove_company_from_cohort(request, cohort_id, org_id) -> None:
    cc = CohortCompany.objects.filter(cohort_id=cohort_id, org_id=org_id).first()
    if cc is None:
        raise ServiceError("not_in_cohort", "Company is not in this cohort.", status=404)
    if cc.status in ("included", "paid", "active", "completed"):
        raise ServiceError("cannot_remove", "Cannot remove a paid/active company.", status=400)

    cc.status = CohortCompany.Status.WITHDRAWN
    cc.save(update_fields=["status", "updated_at"])

    cohort = LiveCohort.objects.select_for_update().get(pk=cohort_id)
    cohort.current_seats = (
        CohortCompany.objects.filter(cohort=cohort)
        .exclude(status__in=["cancelled", "withdrawn"])
        .aggregate(total=Sum("approved_seats"))["total"]
        or 0
    )
    cohort.save(update_fields=["current_seats", "updated_at"])

    audit_request(
        request,
        "company_removed_from_cohort",
        "cohort_company",
        cc.id,
        data={"cohort_id": str(cohort_id), "org_id": str(org_id)},
    )


@transaction.atomic
def confirm_cohort(request, cohort_id, payment_deadline=None) -> LiveCohort:
    cohort = LiveCohort.objects.select_for_update().filter(pk=cohort_id).first()
    if cohort is None:
        raise ServiceError("not_found", "Cohort not found.", status=404)
    if cohort.status != LiveCohort.Status.FORMING:
        raise ServiceError("not_forming", "Only forming cohorts can be confirmed.", status=400)
    if cohort.current_seats < cohort.min_learners:
        raise ServiceError(
            "below_minimum",
            f"Cohort has {cohort.current_seats} seats but minimum is {cohort.min_learners}.",
            status=400,
        )
    if not cohort.sessions.exists():
        raise ServiceError("no_sessions", "Add at least one session before confirming.", status=400)

    cohort.status = LiveCohort.Status.CONFIRMED
    cohort.save(update_fields=["status", "updated_at"])

    if payment_deadline is not None and payment_deadline <= timezone.now():
        raise ServiceError("deadline_in_past", "The payment deadline must be in the future.", status=400)
    offered = CohortCompany.objects.filter(cohort=cohort, status=CohortCompany.Status.INTERESTED)
    request_ids = [r for r in offered.values_list("training_request_id", flat=True) if r]
    changes = {"status": CohortCompany.Status.OFFERED, "updated_at": timezone.now()}
    if payment_deadline is not None:  # staff set it per cohort (Q07); none means no deadline
        changes["payment_deadline"] = payment_deadline
    offered.update(**changes)
    # the companies' requests now have an offer to pay for
    TrainingRequest.objects.filter(pk__in=request_ids).update(
        status=TrainingRequest.Status.OFFERED, status_label="Offer ready", updated_at=timezone.now()
    )

    audit_request(request, "cohort_confirmed", "live_cohort", cohort.id)
    return cohort
