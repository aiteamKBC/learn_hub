"""Fixed-term B2C instalment ledger and access policy.

Provider integration contract: call ``instalment_paid`` or ``payoff_paid`` only after
verified settlement, passing a unique provider-neutral reference, integer minor-unit
amount, and ISO currency. Call ``instalment_failed`` with a unique failure-event
reference after a verified failure; duplicate references are ignored. Provider attempt
creation, consent, retries and callbacks are intentionally outside this module.
"""

from calendar import monthrange
from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone

from apps.catalog.models import Course, Lecture
from apps.learning import services as learning
from apps.learning.models import Enrollment
from core.errors import ServiceError

from .models import (
    CourseInstalment,
    CourseInstalmentFailure,
    CourseInstalmentPlan,
    CourseInstalmentPurchase,
    CourseInstalmentStage,
    CourseInstalmentStagePayment,
)


def add_months(day: date, months: int) -> date:
    month_index = day.month - 1 + months
    year, month = day.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))


def split_total(total_minor: int, count: int) -> list[int]:
    """Equal shares in minor units; deterministic remainder goes on final payment."""
    if total_minor <= 0 or count <= 0 or count > total_minor:
        raise ServiceError("invalid_instalments", "Enter a positive total and payment count.")
    base = total_minor // count
    return [base] * (count - 1) + [total_minor - base * (count - 1)]


def configure_plan(
    *,
    course: Course,
    currency: str,
    total_minor: int,
    count: int,
    schedule_start: date,
    early_release: str,
    retry_count: int | None,
    retry_interval_days: int | None,
    stages: list[dict],
    enabled: bool,
) -> CourseInstalmentPlan:
    from .models import Currency

    if course.ownership == Course.Ownership.ORGANIZATION or not course.live_version_id:
        raise ServiceError("invalid_course", "Instalments require a published personal course.")
    if currency not in Currency.objects.filter(is_active=True).values_list("code", flat=True):
        raise ServiceError("invalid_currency", "Choose an active currency.")
    split_total(total_minor, count)
    if early_release not in CourseInstalmentPlan.EarlyRelease.values:
        raise ServiceError("invalid_release_policy", "Choose an early-payment release policy.")
    if enabled and (retry_count is None or retry_interval_days is None):
        raise ServiceError(
            "retry_policy_required", "Set both automatic retry values before enabling instalments."
        )
    if enabled and (retry_count < 0 or retry_interval_days < 1):
        raise ServiceError(
            "invalid_retry_policy", "Retry count cannot be negative and interval must be positive."
        )
    if not stages:
        raise ServiceError("stages_required", "Add and map at least one named content stage.")
    live_keys = set(
        Lecture.objects.filter(version_id=course.live_version_id).values_list("lecture_key", flat=True)
    )
    seen, cleaned, mapped_payments = set(), [], set()
    for pos, stage in enumerate(stages, 1):
        title = str(stage.get("title", "")).strip()[:120]
        keys = {str(k) for k in stage.get("lecture_keys", [])}
        numbers = sorted({int(n) for n in stage.get("instalment_numbers", [])})
        month = int(stage.get("release_month", 1))
        if not title or not keys or not keys <= {str(k) for k in live_keys}:
            raise ServiceError("invalid_stage", "Each stage needs a title and current course lectures.")
        if not numbers or any(n < 1 or n > count for n in numbers) or month < 1:
            raise ServiceError("invalid_stage", "Map each stage to valid payments and a release month.")
        if seen.intersection(keys):
            raise ServiceError("duplicate_stage_content", "A lecture can belong to only one stage.")
        seen.update(keys)
        mapped_payments.update(numbers)
        cleaned.append(
            {
                "title": title,
                "position": pos,
                "release_month": month,
                "lecture_keys": sorted(keys),
                "instalment_numbers": numbers,
            }
        )
    if seen != {str(k) for k in live_keys}:
        raise ServiceError("unmapped_content", "Map every lecture in the published course to a stage.")
    if mapped_payments != set(range(1, count + 1)):
        raise ServiceError("unmapped_instalment", "Map every instalment to at least one content stage.")
    with transaction.atomic():
        revision = (
            CourseInstalmentPlan.objects.filter(course=course)
            .order_by("-revision")
            .values_list("revision", flat=True)
            .first()
            or 0
        ) + 1
        CourseInstalmentPlan.objects.filter(course=course, is_current=True).update(is_current=False)
        plan = CourseInstalmentPlan.objects.create(
            course=course,
            revision=revision,
            currency_id=currency,
            total_minor=total_minor,
            instalment_count=count,
            schedule_start=schedule_start,
            early_release=early_release,
            retry_count=retry_count,
            retry_interval_days=retry_interval_days,
            enabled=enabled,
        )
        for row in cleaned:
            CourseInstalmentStage.objects.create(plan=plan, **row)
    return plan


def plan_payload(plan: CourseInstalmentPlan) -> dict:
    return {
        "enabled": plan.enabled,
        "currency": plan.currency_id,
        "total_minor": plan.total_minor,
        "instalment_count": plan.instalment_count,
        "schedule_start": plan.schedule_start,
        "early_release": plan.early_release,
        "retry_count": plan.retry_count,
        "retry_interval_days": plan.retry_interval_days,
        "stages": list(
            plan.stages.order_by("position").values(
                "id", "title", "position", "release_month", "lecture_keys", "instalment_numbers"
            )
        ),
    }


@transaction.atomic
def start_purchase(
    *, user, course: Course, existing_learner_rule: bool = False, late_start: date | None = None
) -> dict:
    # The conditional unique constraint below is the concurrency backstop.  Do
    # not lock the identity user row here: a learner may read their own user
    # row under RLS, but is not permitted to take an UPDATE lock on it.
    existing = (
        CourseInstalmentPurchase.objects.select_for_update()
        .filter(user=user, org__isnull=True, course=course, status__in=["active", "complete"])
        .order_by("-created_at")
        .first()
    )
    if existing:
        return {"purchase_id": existing.id, "status": existing.status, "existing": True}
    if CourseInstalmentPurchase.objects.filter(
        user=user,
        org__isnull=True,
        course=course,
        status=CourseInstalmentPurchase.Status.CANCELLED,
        instalments__status=CourseInstalment.Status.PAID,
    ).exists():
        raise ServiceError(
            "paid_stages_overlap",
            "A cancelled plan with paid stages already exists for this course.",
            status=409,
        )
    plan = (
        CourseInstalmentPlan.objects.filter(course=course, is_current=True, enabled=True)
        .prefetch_related("stages")
        .first()
    )
    if not plan:
        raise ServiceError(
            "instalments_unavailable", "Fixed instalments are not available for this course.", status=404
        )
    if (
        Enrollment.objects.filter(
            user=user,
            course=course,
            org__isnull=True,
            status__in=[Enrollment.Status.ACTIVE, Enrollment.Status.COMPLETED],
        )
        .exclude(source=Enrollment.Source.INSTALMENT)
        .exists()
        and not existing_learner_rule
    ):
        raise ServiceError("already_enrolled", "Your current course access is already active.", status=409)
    if existing_learner_rule:
        from .models import CourseInstalmentEligibility

        eligibility = CourseInstalmentEligibility.objects.filter(
            user=user, course=course, enabled=True
        ).first()
        if eligibility is None:
            raise ServiceError(
                "not_eligible",
                "The course administrator has not enabled instalments for this learner.",
                status=403,
            )
        late_start = late_start or eligibility.schedule_start
    start = late_start or plan.schedule_start
    purchase = CourseInstalmentPurchase.objects.create(
        user=user,
        course=course,
        plan=plan,
        currency_id=plan.currency_id,
        total_minor=plan.total_minor,
        instalment_count=plan.instalment_count,
        schedule_start=start,
        late_start=late_start,
        early_release=plan.early_release,
        retry_count=plan.retry_count,
        retry_interval_days=plan.retry_interval_days,
        existing_learner_rule=existing_learner_rule,
        status=CourseInstalmentPurchase.Status.ACTIVE,
    )
    payments = split_total(plan.total_minor, plan.instalment_count)
    instalments = []
    for number, amount in enumerate(payments, 1):
        inst = CourseInstalment.objects.create(
            user=user,
            purchase=purchase,
            number=number,
            due_at=add_months(start, number - 1),
            amount_minor=amount,
        )
        instalments.append(inst)
    for stage in plan.stages.all():
        for number in stage.instalment_numbers:
            CourseInstalmentStagePayment.objects.create(
                user=user, instalment=instalments[number - 1], stage=stage
            )
    _ensure_staged_enrollment(purchase)
    return {"purchase_id": purchase.id, "status": purchase.status, "existing": False}


def _ensure_staged_enrollment(purchase: CourseInstalmentPurchase) -> None:
    # Preserve an existing enrolment and its access source. A new staged enrolment is
    # deliberately excluded from the legacy full-course allow path.
    if (
        not Enrollment.objects.filter(user=purchase.user, course=purchase.course, org__isnull=True)
        .exclude(status=Enrollment.Status.SUPERSEDED)
        .exists()
    ):
        learning.enrol(
            user=purchase.user,
            course=purchase.course,
            source=Enrollment.Source.INSTALMENT,
            source_ref=purchase.id,
        )


def _stage_release(stage: CourseInstalmentStage, purchase: CourseInstalmentPurchase) -> date:
    return add_months(purchase.schedule_start, stage.release_month - 1)


def staged_access(*, user, course_id, scope: str, target_id, now) -> object | None:
    if scope not in ("course", "lecture"):
        return None
    qs = CourseInstalmentPurchase.objects.filter(
        user=user, org__isnull=True, course_id=course_id, status__in=["active", "complete", "cancelled"]
    )
    for purchase in qs.select_related("course"):
        enrollment = (
            Enrollment.objects.filter(user=user, course_id=course_id, org__isnull=True)
            .exclude(status=Enrollment.Status.SUPERSEDED)
            .first()
        )
        if enrollment is None or (purchase.access_expires_at and purchase.access_expires_at <= now):
            continue
        insts = list(purchase.instalments.order_by("number"))
        if sum(i.status == CourseInstalment.Status.PAID for i in insts) == purchase.instalment_count:
            from apps.platform.access import AccessDecision

            return AccessDecision(True, "course_instalment", "course_instalment_paid")
        if scope != "lecture":
            continue
        lecture = (
            Lecture.objects.filter(pk=target_id, version_id=purchase.course.live_version_id)
            .only("lecture_key")
            .first()
        )
        if lecture is None:
            continue
        stages = CourseInstalmentStage.objects.filter(plan=purchase.plan).prefetch_related(
            "payments__instalment"
        )
        for stage in stages:
            if str(lecture.lecture_key) not in set(stage.lecture_keys):
                continue
            mapped = [link.instalment for link in stage.payments.all()]
            if not mapped or not all(row.status == CourseInstalment.Status.PAID for row in mapped):
                continue
            if (
                purchase.early_release == CourseInstalmentPlan.EarlyRelease.SCHEDULED
                and _stage_release(stage, purchase) > now.date()
            ):
                continue
            from apps.platform.access import AccessDecision

            return AccessDecision(True, "course_instalment", "course_instalment_stage")
    return None


@transaction.atomic
def instalment_paid(*, instalment_id, payment_reference: str, amount_minor: int, currency: str) -> None:
    purchase_id = CourseInstalment.objects.values_list("purchase_id", flat=True).get(pk=instalment_id)
    purchase = CourseInstalmentPurchase.objects.select_for_update().get(pk=purchase_id)
    inst = CourseInstalment.objects.select_for_update().get(pk=instalment_id, purchase=purchase)
    if inst.status == CourseInstalment.Status.PAID:
        if inst.payment_reference == payment_reference:
            return
        raise ServiceError("already_settled", "This instalment has already been settled.", status=409)
    if inst.status == CourseInstalment.Status.CANCELLED:
        raise ServiceError("cancelled_payment", "Cancelled instalments cannot be settled.", status=409)
    if purchase.status == CourseInstalmentPurchase.Status.CANCELLED:
        raise ServiceError("cancelled_purchase", "Cancelled purchases cannot be settled.", status=409)
    if not payment_reference:
        raise ServiceError("payment_reference_required", "A unique payment reference is required.")
    if CourseInstalment.objects.filter(payment_reference=payment_reference).exclude(pk=inst.pk).exists():
        raise ServiceError("duplicate_payment", "This payment reference is already recorded.", status=409)
    if currency.upper() != purchase.currency_id:
        raise ServiceError("amount_mismatch", "Paid currency does not match the scheduled instalment.")
    expected = inst.amount_minor
    if amount_minor != expected:
        raise ServiceError("amount_mismatch", "Paid amount does not match the scheduled instalment.")
    if inst.status not in (
        CourseInstalment.Status.DUE,
        CourseInstalment.Status.RETRY,
        CourseInstalment.Status.MANUAL,
        CourseInstalment.Status.PROCESSING,
    ):
        raise ServiceError("not_payable", "This instalment is not payable.", status=409)
    inst.status, inst.paid_at, inst.payment_reference = (
        CourseInstalment.Status.PAID,
        timezone.now(),
        payment_reference,
    )
    inst.retry_at = None
    inst.save(update_fields=["status", "paid_at", "payment_reference", "retry_at", "updated_at"])
    _start_access_window(purchase)
    if purchase.instalments.filter(status=CourseInstalment.Status.PAID).count() == purchase.instalment_count:
        CourseInstalmentPurchase.objects.filter(pk=purchase.pk).update(
            status=CourseInstalmentPurchase.Status.COMPLETE
        )


@transaction.atomic
def instalment_failed(*, instalment_id, failure_reference: str, manual: bool = False) -> bool:
    purchase_id = CourseInstalment.objects.values_list("purchase_id", flat=True).get(pk=instalment_id)
    purchase = CourseInstalmentPurchase.objects.select_for_update().get(pk=purchase_id)
    inst = CourseInstalment.objects.select_for_update().get(pk=instalment_id, purchase=purchase)
    if (
        inst.status in (CourseInstalment.Status.PAID, CourseInstalment.Status.CANCELLED)
        or purchase.status == CourseInstalmentPurchase.Status.CANCELLED
    ):
        return False
    if inst.status not in (
        CourseInstalment.Status.DUE,
        CourseInstalment.Status.RETRY,
        CourseInstalment.Status.PROCESSING,
        CourseInstalment.Status.MANUAL,
    ):
        return False
    if not failure_reference:
        raise ServiceError("failure_reference_required", "A unique failure reference is required.")
    event, created = CourseInstalmentFailure.objects.get_or_create(
        failure_reference=failure_reference,
        defaults={"user": purchase.user, "instalment": inst, "manual_payment": manual},
    )
    if not created:
        if event.instalment_id != inst.id:
            raise ServiceError(
                "duplicate_failure_reference", "This failure reference is already in use.", status=409
            )
        return False
    if manual:
        inst.status = CourseInstalment.Status.MANUAL
        inst.retry_at = None
        inst.save(update_fields=["status", "retry_at", "updated_at"])
        return True
    inst.retry_attempts += 1
    if inst.retry_attempts <= purchase.retry_count:
        inst.status = CourseInstalment.Status.RETRY
        inst.retry_at = timezone.localdate() + timedelta(days=purchase.retry_interval_days)
    else:
        inst.status = CourseInstalment.Status.MANUAL
        inst.retry_at = None
    inst.save(update_fields=["retry_attempts", "retry_at", "status", "updated_at"])
    if inst.status == CourseInstalment.Status.MANUAL:
        from apps.engagement.notify import notify

        notify(
            [purchase.user_id],
            "course_instalment_manual_payment",
            {"course": purchase.course.title},
            url="/account/instalments",
            dedupe=f"instalment-manual:{inst.id}",
        )
    return True


def _start_access_window(purchase: CourseInstalmentPurchase) -> None:
    if purchase.access_expires_at is not None:
        return
    days = purchase.course.access_days
    if days:
        expires = timezone.now() + timedelta(days=days)
        CourseInstalmentPurchase.objects.filter(pk=purchase.pk, access_expires_at__isnull=True).update(
            access_expires_at=expires
        )
        purchase.access_expires_at = expires


def payment_status(purchase: CourseInstalmentPurchase) -> dict:
    installments = list(purchase.instalments.order_by("number"))
    paid = sum(i.amount_minor for i in installments if i.status == CourseInstalment.Status.PAID)
    return {
        "id": purchase.id,
        "course_id": purchase.course_id,
        "course_title": purchase.course.title,
        "status": purchase.status,
        "currency": purchase.currency_id,
        "total_minor": purchase.total_minor,
        "currency_exponent": purchase.currency.exponent,
        "paid_minor": paid,
        "remaining_minor": max(0, purchase.total_minor - paid),
        "cancelled": purchase.cancelled_at is not None,
        "payoff_requested_at": purchase.payoff_requested_at.isoformat()
        if purchase.payoff_requested_at
        else None,
        "instalments": [
            {
                "id": i.id,
                "number": i.number,
                "due_at": i.due_at.isoformat(),
                "amount_minor": i.amount_minor,
                "status": i.status,
                "retry_at": i.retry_at.isoformat() if i.retry_at else None,
                "manual_payment_requested_at": i.manual_payment_requested_at.isoformat()
                if i.manual_payment_requested_at
                else None,
            }
            for i in installments
        ],
    }


@transaction.atomic
def request_manual_payment(*, purchase: CourseInstalmentPurchase, instalment: CourseInstalment) -> dict:
    purchase = CourseInstalmentPurchase.objects.select_for_update().get(pk=purchase.pk)
    instalment = CourseInstalment.objects.select_for_update().get(pk=instalment.pk, purchase=purchase)
    if (
        purchase.status != CourseInstalmentPurchase.Status.ACTIVE
        or instalment.status != CourseInstalment.Status.MANUAL
    ):
        raise ServiceError("not_manual_due", "This payment does not need manual payment.")
    instalment.manual_payment_requested_at = timezone.now()
    instalment.save(update_fields=["manual_payment_requested_at", "updated_at"])
    return {"purchase_id": purchase.id, "instalment_id": instalment.id, "status": instalment.status}


@transaction.atomic
def request_payoff(*, purchase: CourseInstalmentPurchase) -> dict:
    purchase = CourseInstalmentPurchase.objects.select_for_update().get(pk=purchase.pk)
    if purchase.status != CourseInstalmentPurchase.Status.ACTIVE:
        raise ServiceError("not_payoffable", "This purchase cannot be paid off now.")
    unpaid = list(purchase.instalments.select_for_update().exclude(status=CourseInstalment.Status.PAID))
    amount = sum(i.amount_minor for i in unpaid)
    if not amount:
        raise ServiceError("nothing_due", "The full balance is already paid.")
    purchase.payoff_requested_at = timezone.now()
    purchase.save(update_fields=["payoff_requested_at", "updated_at"])
    return {"purchase_id": purchase.id, "remaining_minor": amount, "status": "payment_pending"}


@transaction.atomic
def payoff_paid(*, purchase_id, payment_reference: str, amount_minor: int, currency: str) -> None:
    purchase = CourseInstalmentPurchase.objects.select_for_update().get(pk=purchase_id)
    if purchase.status == CourseInstalmentPurchase.Status.COMPLETE:
        if purchase.payoff_payment_reference == payment_reference:
            return
        raise ServiceError("already_settled", "This purchase has already been settled.", status=409)
    if purchase.status != CourseInstalmentPurchase.Status.ACTIVE:
        raise ServiceError("not_payoffable", "This purchase cannot be paid off now.", status=409)
    unpaid = list(purchase.instalments.select_for_update().exclude(status=CourseInstalment.Status.PAID))
    expected = sum(i.amount_minor for i in unpaid)
    if amount_minor != expected or currency.upper() != purchase.currency_id or not payment_reference:
        raise ServiceError("amount_mismatch", "Paid amount does not match the remaining balance.")
    if CourseInstalment.objects.filter(payment_reference=payment_reference).exists():
        raise ServiceError("duplicate_payment", "This payment reference is already recorded.", status=409)
    now = timezone.now()
    rows = unpaid
    for row in rows:
        row.status = CourseInstalment.Status.PAID
        row.paid_at = now
        row.retry_at = None
        row.payment_reference = f"{payment_reference}:{row.number}"
        row.save(update_fields=["status", "paid_at", "retry_at", "payment_reference", "updated_at"])
    _start_access_window(purchase)
    CourseInstalmentPurchase.objects.filter(pk=purchase.pk).update(
        status=CourseInstalmentPurchase.Status.COMPLETE,
        payoff_payment_reference=payment_reference,
    )


@transaction.atomic
def cancel_purchase(purchase: CourseInstalmentPurchase) -> None:
    purchase = CourseInstalmentPurchase.objects.select_for_update().get(pk=purchase.pk)
    if purchase.status in (
        CourseInstalmentPurchase.Status.COMPLETE,
        CourseInstalmentPurchase.Status.CANCELLED,
    ):
        return
    purchase.status, purchase.cancelled_at = CourseInstalmentPurchase.Status.CANCELLED, timezone.now()
    purchase.save(update_fields=["status", "cancelled_at", "updated_at"])
    purchase.instalments.select_for_update().exclude(status=CourseInstalment.Status.PAID).update(
        status=CourseInstalment.Status.CANCELLED
    )
