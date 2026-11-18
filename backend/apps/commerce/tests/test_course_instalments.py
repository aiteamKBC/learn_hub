"""Focused checks for B2C fixed-term course instalments."""

from datetime import date, timedelta

from django.utils import timezone

from apps.catalog.models import Lecture
from apps.commerce import instalments
from apps.commerce.instalment_api import start as start_api
from apps.commerce.models import (
    CourseInstalment,
    CourseInstalmentPurchase,
)
from apps.platform.access import resolve
from apps.platform.models import ContentEntitlement
from core.tenancy import tenant_context

from .test_commerce import CommerceBase


class CourseInstalmentMathTest(CommerceBase):
    extra_course_lecture = True

    def test_even_minor_unit_split_places_remainder_on_last_payment(self):
        self.assertEqual(instalments.split_total(1001, 3), [333, 333, 335])

    def test_month_schedule_clamps_at_month_end(self):
        self.assertEqual(instalments.add_months(date(2026, 1, 31), 1), date(2026, 2, 28))

    def test_start_endpoint_has_no_payment_consent_or_gateway_setup(self):
        with tenant_context(staff=True):
            lecture_keys = list(
                Lecture.objects.filter(version_id=self.python.live_version_id)
                .order_by("position")
                .values_list("lecture_key", flat=True)
            )
            instalments.configure_plan(
                course=self.python,
                currency="GBP",
                total_minor=1001,
                count=2,
                schedule_start=timezone.localdate() + timedelta(days=2),
                early_release="scheduled",
                retry_count=1,
                retry_interval_days=4,
                enabled=True,
                stages=[
                    {
                        "title": "Stage 1",
                        "release_month": 1,
                        "lecture_keys": [str(lecture_keys[0])],
                        "instalment_numbers": [1],
                    },
                    {
                        "title": "Stage 2",
                        "release_month": 2,
                        "lecture_keys": [str(lecture_keys[1])],
                        "instalment_numbers": [2],
                    },
                ],
            )
        request = type("Request", (), {"org_id": None, "user": self.sara})()
        with tenant_context(user_id=self.sara.id):
            created = start_api(request, self.python.id)
            again = start_api(request, self.python.id)
        self.assertEqual(created["status"], "active")
        self.assertNotIn("checkout_url", created)
        self.assertEqual(again["purchase_id"], created["purchase_id"])
        self.assertTrue(again["existing"])


class CourseInstalmentFlowTest(CommerceBase):
    extra_course_lecture = True

    def configured_plan(self, *, stage_instalments=(2,), retry_count=1, release="immediate"):
        lecture_keys = list(
            Lecture.objects.filter(version_id=self.python.live_version_id)
            .order_by("position")
            .values_list("lecture_key", flat=True)
        )
        return instalments.configure_plan(
            course=self.python,
            currency="GBP",
            total_minor=1001,
            count=2,
            schedule_start=timezone.localdate() + timedelta(days=2),
            early_release=release,
            retry_count=retry_count,
            retry_interval_days=4,
            enabled=True,
            stages=[
                {
                    "title": "Month 1",
                    "release_month": 1,
                    "lecture_keys": [str(lecture_keys[0])],
                    "instalment_numbers": list(stage_instalments),
                },
                {
                    "title": "Month 2",
                    "release_month": 2,
                    "lecture_keys": [str(lecture_keys[1])],
                    "instalment_numbers": [n for n in (1, 2) if n not in stage_instalments],
                },
            ],
        )

    def make_purchase(self, plan=None):
        if plan is None:
            with tenant_context(staff=True):
                plan = self.configured_plan()
        with tenant_context(user_id=self.sara.id):
            created = instalments.start_purchase(user=self.sara, course=self.python)
            purchase = CourseInstalmentPurchase.objects.get(pk=created["purchase_id"])
        return purchase

    def pay(self, purchase, instalment):
        with tenant_context(staff=True):
            instalments.instalment_paid(
                instalment_id=instalment.id,
                payment_reference=f"pay_{instalment.number}_{purchase.id}",
                amount_minor=instalment.amount_minor,
                currency="GBP",
            )

    def test_only_explicitly_mapped_paid_stage_unlocks_then_full_payment_unlocks_course(self):
        with tenant_context(staff=True):
            plan = self.configured_plan(stage_instalments=(2,))
        purchase = self.make_purchase(plan)
        with tenant_context(staff=True):
            rows = list(purchase.instalments.order_by("number"))
            lecture = Lecture.objects.filter(version_id=self.python.live_version_id).first()
        with tenant_context(staff=True):
            self.pay(purchase, rows[0])
        with tenant_context(user_id=self.sara.id):
            denied = resolve(self.sara, "lecture", lecture.id)
            self.assertFalse(denied.allowed)
        with tenant_context(staff=True):
            self.pay(purchase, rows[1])
        with tenant_context(user_id=self.sara.id):
            allowed = resolve(self.sara, "lecture", lecture.id)
            full = resolve(self.sara, "course", self.python.id)
            self.assertTrue(allowed.allowed)
            self.assertTrue(full.allowed)

    def test_failed_charge_retries_then_manual_and_cancellation_keeps_paid_stage(self):
        with tenant_context(staff=True):
            plan = self.configured_plan(stage_instalments=(1,))
        purchase = self.make_purchase(plan)
        with tenant_context(staff=True):
            rows = list(purchase.instalments.order_by("number"))
        with tenant_context(staff=True):
            instalments.instalment_failed(instalment_id=rows[1].id, failure_reference="failure-retry-1")
            rows[1].refresh_from_db()
            self.assertEqual(rows[1].status, CourseInstalment.Status.RETRY)
            instalments.instalment_failed(instalment_id=rows[1].id, failure_reference="failure-retry-2")
            rows[1].refresh_from_db()
            self.assertEqual(rows[1].status, CourseInstalment.Status.MANUAL)
            self.pay(purchase, rows[0])
            instalments.cancel_purchase(purchase)
        lecture = Lecture.objects.filter(version_id=self.python.live_version_id).first()
        with tenant_context(user_id=self.sara.id):
            self.assertTrue(resolve(self.sara, "lecture", lecture.id).allowed)
        with tenant_context(staff=True):
            rows[1].refresh_from_db()
        self.assertEqual(rows[1].status, CourseInstalment.Status.CANCELLED)
        with tenant_context(staff=True):
            self.assertFalse(
                instalments.instalment_failed(
                    instalment_id=rows[1].id, failure_reference="failure-after-cancel"
                )
            )
            rows[1].refresh_from_db()
            self.assertEqual(rows[1].retry_attempts, 2)

    def test_duplicate_failure_reference_does_not_consume_another_retry(self):
        with tenant_context(staff=True):
            plan = self.configured_plan(stage_instalments=(1,))
        purchase = self.make_purchase(plan)
        with tenant_context(staff=True):
            instalment = purchase.instalments.get(number=2)
            self.assertTrue(
                instalments.instalment_failed(
                    instalment_id=instalment.id, failure_reference="failure-event-once"
                )
            )
            self.assertFalse(
                instalments.instalment_failed(
                    instalment_id=instalment.id, failure_reference="failure-event-once"
                )
            )
            instalment.refresh_from_db()
            self.assertEqual(instalment.retry_attempts, 1)

    def test_cancelled_unpaid_plan_can_be_restarted_without_overlapping_paid_stages(self):
        with tenant_context(staff=True):
            plan = self.configured_plan(stage_instalments=(1,))
        first = self.make_purchase(plan)
        with tenant_context(staff=True):
            instalments.cancel_purchase(first)
        with tenant_context(user_id=self.sara.id):
            second_result = instalments.start_purchase(user=self.sara, course=self.python)
        self.assertNotEqual(second_result["purchase_id"], first.id)

    def test_early_payoff_marks_remaining_balance_paid_once(self):
        with tenant_context(staff=True):
            plan = self.configured_plan(stage_instalments=(1,))
        purchase = self.make_purchase(plan)
        with tenant_context(staff=True):
            instalments.payoff_paid(
                purchase_id=purchase.id,
                payment_reference="payoff_test",
                amount_minor=purchase.total_minor,
                currency="GBP",
            )
            instalments.payoff_paid(
                purchase_id=purchase.id,
                payment_reference="payoff_test",
                amount_minor=purchase.total_minor,
                currency="GBP",
            )
        with tenant_context(staff=True):
            purchase.refresh_from_db()
            self.assertEqual(purchase.status, CourseInstalmentPurchase.Status.COMPLETE)
            self.assertEqual(purchase.instalments.filter(status=CourseInstalment.Status.PAID).count(), 2)

    def test_existing_full_course_token_grant_precedes_unpaid_instalment(self):
        with tenant_context(staff=True):
            plan = self.configured_plan(stage_instalments=(1,))
        self.make_purchase(plan)
        with tenant_context(staff=True):
            ContentEntitlement.objects.create(
                user=self.sara,
                scope=ContentEntitlement.Scope.COURSE,
                target_id=self.python.id,
                source=ContentEntitlement.Source.FULL_COURSE_TOKEN_UNLOCK,
                granted_at=timezone.now(),
            )
        with tenant_context(user_id=self.sara.id):
            decision = resolve(self.sara, "course", self.python.id)
        self.assertTrue(decision.allowed)
        self.assertEqual(decision.source, ContentEntitlement.Source.FULL_COURSE_TOKEN_UNLOCK)
