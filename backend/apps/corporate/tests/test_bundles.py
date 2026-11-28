"""Bundles (admin picks courses + a seat price) and multi-course company purchases (one
Stripe payment, seats split between courses). Company accounts cannot buy personally."""

import uuid
from unittest.mock import patch

from django.test import override_settings

from apps.catalog.models import Course, CourseVersion
from apps.commerce.models import CoursePrice, PriceTier
from apps.corporate.bundles import fulfil_basket
from apps.corporate.models import PendingSeat, SeatPurchase
from apps.corporate.tests import test_company_http as base
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

STRIPE = "apps.corporate.bundles.gateway.create_checkout_session"


@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
)
class BundleTest(SchemaTransactionTestCase):
    _post = base.CompanyHttpTest._post
    _get = base.CompanyHttpTest._get

    def setUp(self):
        base.CompanyHttpTest.setUp(self)
        tag = uuid.uuid4().hex[:6]
        with tenant_context(staff=True):
            self.course2 = Course.objects.create(
                ownership="platform", status="published", created_by=self.staff,
                category=self.course.category, slug=f"b2-{tag}", title=f"Second {tag}",
            )  # fmt: skip
            v = CourseVersion.objects.create(course=self.course2, number=1, status="published")
            self.course2.live_version = v
            self.course2.save(update_fields=["live_version"])
            tier = PriceTier.objects.create(name=f"B2-{tag}", gbp_minor=20000, sort_order=0)
            CoursePrice.objects.create(course=self.course2, tier=tier, is_free=False)

    def _console(self, method, path, body=None):
        self.client.force_login(self.staff)
        fn = getattr(self.client, method)
        return fn(f"/api/v1/console{path}", body, content_type="application/json")

    def _bundle(self, price=5000):
        r = self._console(
            "post", "/corporate/bundles",
            {"title": "Starter pack", "seat_price_minor": price, "course_ids": [str(self.course.id), str(self.course2.id)]},
        )  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["id"]

    def _emps(self, n, prefix):
        return [{"email": f"{prefix}{i}@example.com", "full_name": f"P {i}"} for i in range(n)]

    def test_admin_builds_bundle_and_it_is_public(self):
        bid = self._bundle()
        self.client.logout()
        listed = self.client.get("/api/v1/corporate/bundles").json()
        mine = next(b for b in listed if b["id"] == bid)
        self.assertEqual(mine["seat_price_minor"], 5000)
        self.assertEqual(
            {c["course_id"] for c in mine["courses"]}, {str(self.course.id), str(self.course2.id)}
        )
        # company admins cannot build bundles
        self.client.force_login(self.admin)
        r = self.client.post(
            "/api/v1/console/corporate/bundles", {"title": "x"}, content_type="application/json"
        )
        self.assertIn(r.status_code, (401, 403, 422))

    def test_bundle_needs_two_courses_and_a_price(self):
        r = self._console(
            "post",
            "/corporate/bundles",
            {"title": "One", "seat_price_minor": 100, "course_ids": [str(self.course.id)]},
        )
        self.assertEqual(r.json()["error"]["code"], "bad_courses")

    @patch(STRIPE)
    def test_bundle_split_any_way_at_bundle_price(self, stripe):
        stripe.return_value = {"id": "cs_bundle", "url": "https://checkout.stripe.com/b"}
        bid = self._bundle(price=5000)
        lines = [
            {"course_id": str(self.course.id), "quantity": 3, "employees": self._emps(3, "a")},
            {"course_id": str(self.course2.id), "quantity": 0},  # a course may get no seats
        ]
        r = self._post("/basket/checkout", {"bundle_id": bid, "lines": lines})
        self.assertEqual(r.status_code, 200, r.content)
        with tenant_context(staff=True):
            rows = list(SeatPurchase.objects.filter(checkout_group=r.json()["purchase_id"]))
        self.assertEqual([(p.quantity, p.unit_price_minor, p.total_minor) for p in rows], [(3, 5000, 15000)])
        self.assertEqual(len(stripe.call_args.kwargs["line_items"]), 1)

    @patch(STRIPE)
    def test_basket_without_bundle_uses_each_course_price(self, stripe):
        stripe.return_value = {"id": "cs_basket", "url": "https://checkout.stripe.com/c"}
        lines = [
            {"course_id": str(self.course.id), "quantity": 2, "employees": self._emps(2, "a")},
            {"course_id": str(self.course2.id), "quantity": 1, "employees": self._emps(1, "b")},
        ]
        r = self._post("/basket/checkout", {"lines": lines})
        self.assertEqual(r.status_code, 200, r.content)
        with tenant_context(staff=True):
            got = sorted(
                SeatPurchase.objects.filter(checkout_group=r.json()["purchase_id"]).values_list(
                    "quantity", "unit_price_minor"
                )
            )
        self.assertEqual(got, [(1, 20000), (2, 10000)])
        self.assertEqual(len(stripe.call_args.kwargs["line_items"]), 2)

    @patch(STRIPE)
    def test_basket_refuses_missing_duplicate_or_outside_courses(self, stripe):
        stripe.return_value = {"id": "cs_x", "url": "u"}
        bid = self._bundle()
        short = self._post(
            "/basket/checkout",
            {"lines": [{"course_id": str(self.course.id), "quantity": 2, "employees": self._emps(1, "a")}]},
        )
        self.assertEqual(short.json()["error"]["code"], "employees_required")
        twice = self._post("/basket/checkout", {"lines": [
            {"course_id": str(self.course.id), "quantity": 2, "employees": [{"email": "a@example.com"}, {"email": "A@example.com"}]},
        ]})  # fmt: skip
        self.assertEqual(
            twice.json()["error"]["code"], "bad_rows", twice.content
        )  # same person twice in ONE course
        with tenant_context(staff=True):
            other = Course.objects.create(
                ownership="platform",
                status="published",
                created_by=self.staff,
                category=self.course.category,
                slug=f"o-{uuid.uuid4().hex[:6]}",
                title="Other",
            )
        out = self._post(
            "/basket/checkout",
            {
                "bundle_id": bid,
                "lines": [{"course_id": str(other.id), "quantity": 1, "employees": self._emps(1, "c")}],
            },
        )
        self.assertEqual(out.json()["error"]["code"], "not_in_bundle")
        learner = self._post(
            "/basket/checkout",
            {"lines": [{"course_id": str(self.course.id), "quantity": 1, "employees": self._emps(1, "d")}]},
            user=self.emp,
        )
        self.assertEqual(learner.status_code, 403)
        stripe.assert_not_called()

    @patch("apps.corporate.pending.approval_required", return_value=False)
    @patch(STRIPE)
    def test_paid_basket_invites_everyone_once(self, stripe, _approval):
        stripe.return_value = {"id": "cs_paid", "url": "u"}
        lines = [
            {"course_id": str(self.course.id), "quantity": 1, "employees": self._emps(1, "x")},
            {"course_id": str(self.course2.id), "quantity": 2, "employees": self._emps(2, "y")},
        ]
        group = self._post("/basket/checkout", {"lines": lines}).json()["purchase_id"]
        session = {"id": "cs_paid", "payment_status": "paid", "payment_intent": "pi_1"}
        with tenant_context(staff=True):
            fulfil_basket(session, {"id": group})
            fulfil_basket(session, {"id": group})  # webhook replay
            statuses = set(SeatPurchase.objects.filter(checkout_group=group).values_list("status", flat=True))
            held = PendingSeat.objects.filter(seat_purchase__checkout_group=group).count()
        self.assertEqual(statuses, {"paid"})
        self.assertEqual(held, 3)

    @patch("apps.corporate.pending.approval_required", return_value=False)
    @patch(STRIPE)
    def test_one_employee_in_two_courses_gets_one_email(self, stripe, _approval):
        from django.core import mail

        stripe.return_value = {"id": "cs_two", "url": "u"}
        same = [{"email": "both@example.com", "full_name": "Both"}]
        r = self._post("/basket/checkout", {"lines": [
            {"course_id": str(self.course.id), "quantity": 1, "employees": same},
            {"course_id": str(self.course2.id), "quantity": 1, "employees": same},
        ]})  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        mail.outbox.clear()
        with tenant_context(staff=True):
            fulfil_basket({"id": "cs_two", "payment_status": "paid"}, {"id": r.json()["purchase_id"]})
            held = PendingSeat.objects.filter(email="both@example.com", status="pending")
            invites = set(held.values_list("invite_id", flat=True))
            self.assertEqual(held.count(), 2)
        self.assertEqual(len(invites), 1, "both seats wait on one invitation")
        sent = [m for m in mail.outbox if "both@example.com" in m.to]
        self.assertEqual(len(sent), 1, "one email for both courses")
        self.assertIn(self.course.title, sent[0].body)
        self.assertIn(self.course2.title, sent[0].body)

    def test_company_account_cannot_buy_personally(self):
        from apps.commerce.services import add_to_cart

        with tenant_context(staff=True), self.assertRaises(ServiceError) as err:
            add_to_cart(user=self.emp, course_id=self.course2.id)
        self.assertEqual(err.exception.code, "company_account")
