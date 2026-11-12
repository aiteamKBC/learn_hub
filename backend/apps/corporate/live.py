"""B2B-03: Live training request + cohort lifecycle services."""

from __future__ import annotations

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.platform.services import audit_request
from core.errors import ServiceError

from .models import CohortCompany, LiveCohort, TrainingRequest


@transaction.atomic
def submit_request(request, course_id, seats: int, preferred_intake="", preferred_delivery="") -> TrainingRequest:
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
        status=TrainingRequest.Status.SUBMITTED,
        status_label="Under Review",
    )

    audit_request(
        request, "training_request_submitted", "training_request", tr.id,
        data={"course_id": str(course_id), "seats": seats},
    )
    return tr


def cancel_request(request, request_id) -> TrainingRequest:
    tr = TrainingRequest.objects.filter(
        pk=request_id, org_id=getattr(request, "org_id", None),
    ).first()
    if tr is None:
        raise ServiceError("not_found", "Training request not found.", status=404)
    if tr.status not in (TrainingRequest.Status.SUBMITTED, TrainingRequest.Status.UNDER_REVIEW):
        raise ServiceError("not_cancellable", "Only submitted or under-review requests can be cancelled.", status=400)

    tr.status = TrainingRequest.Status.CANCELLED
    tr.status_label = "Cancelled"
    tr.save(update_fields=["status", "status_label", "updated_at"])

    audit_request(request, "training_request_cancelled", "training_request", tr.id)
    return tr


@transaction.atomic
def create_cohort(request, *, course_id, delivery_mode, max_learners, min_learners=1,
                  intake="", title="", notes="") -> LiveCohort:
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
        request, "cohort_created", "live_cohort", cohort.id,
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
        CohortCompany.objects
        .filter(cohort=cohort)
        .exclude(status__in=["cancelled", "withdrawn"])
        .aggregate(total=Sum("approved_seats"))["total"] or 0
    )
    cohort.save(update_fields=["current_seats", "updated_at"])

    if training_request_id:
        TrainingRequest.objects.filter(pk=training_request_id).update(
            status=TrainingRequest.Status.SCHEDULING,
            status_label="Scheduling",
            updated_at=timezone.now(),
        )

    audit_request(
        request, "company_added_to_cohort", "cohort_company", cc.id,
        data={"cohort_id": str(cohort_id), "org_id": str(org_id), "seats": seats},
    )
    return cc


@transaction.atomic
def remove_company_from_cohort(request, cohort_id, org_id) -> None:
    cc = CohortCompany.objects.filter(cohort_id=cohort_id, org_id=org_id).first()
    if cc is None:
        raise ServiceError("not_in_cohort", "Company is not in this cohort.", status=404)
    if cc.status in ("paid", "active", "completed"):
        raise ServiceError("cannot_remove", "Cannot remove a paid/active company.", status=400)

    cc.status = CohortCompany.Status.WITHDRAWN
    cc.save(update_fields=["status", "updated_at"])

    cohort = LiveCohort.objects.select_for_update().get(pk=cohort_id)
    cohort.current_seats = (
        CohortCompany.objects
        .filter(cohort=cohort)
        .exclude(status__in=["cancelled", "withdrawn"])
        .aggregate(total=Sum("approved_seats"))["total"] or 0
    )
    cohort.save(update_fields=["current_seats", "updated_at"])

    audit_request(
        request, "company_removed_from_cohort", "cohort_company", cc.id,
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
