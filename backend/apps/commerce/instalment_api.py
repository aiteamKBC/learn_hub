"""Learner endpoints for fixed-term B2C course instalments."""

from uuid import UUID

from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router, Schema

from apps.catalog.models import Course
from core.auth import session_auth
from core.errors import ServiceError

from . import instalments
from .models import (
    CourseInstalment,
    CourseInstalmentEligibility,
    CourseInstalmentPlan,
    CourseInstalmentPurchase,
)

router = Router(tags=["course instalments"], auth=session_auth)


class InstalmentStageOut(Schema):
    title: str
    position: int
    release_month: int


class InstalmentOfferPaymentOut(Schema):
    number: int
    due_at: str
    amount_minor: int


class InstalmentOfferOut(Schema):
    enabled: bool
    currency: str
    exponent: int
    total_minor: int
    instalment_count: int
    schedule_start: str
    early_release: str
    existing_learner_allowed: bool
    stages: list[InstalmentStageOut]
    payments: list[InstalmentOfferPaymentOut]


class InstalmentCheckoutOut(Schema):
    purchase_id: UUID
    status: str
    existing: bool


class InstalmentRowOut(Schema):
    id: UUID
    number: int
    due_at: str
    amount_minor: int
    status: str
    retry_at: str | None
    manual_payment_requested_at: str | None


class InstalmentPaymentOut(Schema):
    id: UUID
    course_id: UUID
    course_title: str
    status: str
    currency: str
    currency_exponent: int
    total_minor: int
    paid_minor: int
    remaining_minor: int
    cancelled: bool
    payoff_requested_at: str | None
    instalments: list[InstalmentRowOut]


class InstalmentActionOut(Schema):
    purchase_id: UUID
    status: str
    remaining_minor: int | None = None
    instalment_id: UUID | None = None


class InstalmentCancelOut(Schema):
    ok: bool


def _personal(request):
    if getattr(request, "org_id", None):
        raise ServiceError("personal_only", "Course instalments are personal purchases.", status=403)


@router.get("/offer/{uuid:course_id}", response=InstalmentOfferOut)
def offer(request, course_id: UUID):
    plan = CourseInstalmentPlan.objects.filter(course_id=course_id, is_current=True, enabled=True).first()
    if plan is None:
        raise ServiceError("not_available", "Course instalments are not available.", status=404)
    stages = list(plan.stages.order_by("position").values("title", "position", "release_month"))
    existing_allowed = CourseInstalmentEligibility.objects.filter(
        user=request.user, course_id=course_id, enabled=True
    ).exists()
    amounts = instalments.split_total(plan.total_minor, plan.instalment_count)
    payments = [
        {
            "number": number,
            "due_at": instalments.add_months(plan.schedule_start, number - 1).isoformat(),
            "amount_minor": amount,
        }
        for number, amount in enumerate(amounts, 1)
    ]
    return {
        "enabled": True,
        "currency": plan.currency_id,
        "exponent": plan.currency.exponent,
        "total_minor": plan.total_minor,
        "instalment_count": plan.instalment_count,
        "schedule_start": plan.schedule_start.isoformat(),
        "early_release": plan.early_release,
        "existing_learner_allowed": existing_allowed,
        "stages": stages,
        "payments": payments,
    }


@router.post("/courses/{uuid:course_id}/start", response=InstalmentCheckoutOut)
def start(request, course_id: UUID):
    _personal_only(request.user)  # company accounts may only browse
    _personal(request)
    course = get_object_or_404(Course, pk=course_id, status="published", deleted_at__isnull=True)
    eligible = CourseInstalmentEligibility.objects.filter(
        user=request.user, course=course, enabled=True
    ).first()
    existing = eligible is not None
    if (
        CourseInstalmentPlan.objects.filter(
            course=course, is_current=True, schedule_start__lt=timezone.localdate()
        ).exists()
        and not eligible
    ):
        raise ServiceError(
            "admin_schedule_required",
            "The course administrator must set this learner's schedule start date.",
            status=409,
        )
    result = instalments.start_purchase(
        user=request.user,
        course=course,
        existing_learner_rule=existing,
        late_start=eligible.schedule_start if eligible else None,
    )
    return result


@router.get("/mine", response=list[InstalmentPaymentOut])
def mine(request):
    _personal(request)
    rows = (
        CourseInstalmentPurchase.objects.filter(user=request.user, org__isnull=True)
        .select_related("course")
        .prefetch_related("instalments")
    )
    return [instalments.payment_status(row) for row in rows.order_by("-created_at")]


@router.post("/{uuid:purchase_id}/cancel", response=InstalmentCancelOut)
def cancel(request, purchase_id: UUID):
    _personal(request)
    purchase = get_object_or_404(
        CourseInstalmentPurchase, pk=purchase_id, user=request.user, org__isnull=True
    )
    instalments.cancel_purchase(purchase)
    return {"ok": True}


@router.post("/{uuid:purchase_id}/payoff", response=InstalmentActionOut)
def payoff(request, purchase_id: UUID):
    _personal(request)
    purchase = get_object_or_404(
        CourseInstalmentPurchase.objects.select_related("course", "user"),
        pk=purchase_id,
        user=request.user,
        org__isnull=True,
    )
    return instalments.request_payoff(purchase=purchase)


@router.post("/{uuid:purchase_id}/instalments/{uuid:instalment_id}/pay", response=InstalmentActionOut)
def pay(request, purchase_id: UUID, instalment_id: UUID):
    _personal(request)
    purchase = get_object_or_404(
        CourseInstalmentPurchase.objects.select_related("course", "user"),
        pk=purchase_id,
        user=request.user,
        org__isnull=True,
    )
    inst = get_object_or_404(CourseInstalment, pk=instalment_id, purchase=purchase)
    return instalments.request_manual_payment(purchase=purchase, instalment=inst)


def _personal_only(user) -> None:
    from .services import personal_only

    personal_only(user)
