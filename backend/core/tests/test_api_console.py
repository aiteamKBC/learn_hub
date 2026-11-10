"""Console (staff back office): access rules, course review, instructors, currencies,
payouts, user suspension and anonymisation, support desk and the audit log."""

from datetime import date
from unittest import mock

from apps.catalog.models import Course, CourseVersion
from apps.commerce import services as shop
from apps.commerce.models import PriceTierAmount
from apps.identity.models import InstructorProfile, User
from apps.payouts import services as payouts
from apps.payouts.models import Earning
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


class ConsoleApiTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()
        f.money(self.staff)
        InstructorProfile.objects.create(user=self.teacher, status="approved")

    def as_(self, user):
        self.client.force_login(user)

    def get(self, path):
        return self.client.get(API + path)

    def post(self, path, data=None):
        return self.client.post(API + path, data=data or {}, content_type="application/json")

    def test_access_review_money_people_and_audit(self):
        self.as_(self.sara)
        self.assertEqual(self.get("/console/overview").status_code, 403)

        # staff powers apply ONLY under /console: elsewhere staff are ordinary users
        course = f.course(staff=self.staff, owner=self.teacher, slug="py", title="Python")
        with mock.patch(
            "apps.commerce.gateway.create_checkout_session", return_value={"id": "cs_1", "url": "u"}
        ):
            with tenant_context(user_id=self.sara.id):
                order = shop.create_order(user=self.sara, course_ids=[course.id], currency="GBP")["order"]
        self.as_(self.staff)
        self.assertEqual(self.get(f"/commerce/orders/{order.id}").status_code, 404)
        self.assertEqual(self.get("/console/orders?q=sara").json()["items"][0]["id"], str(order.id))
        self.assertEqual(self.get("/console/overview").status_code, 200)

        # course review: submit -> queue -> request changes -> resubmit -> approve
        self.as_(self.teacher)
        c = self.post("/studio/courses", {"title": "Rust for Beginners"}).json()
        self.client.patch(f"{API}/studio/courses/{c['id']}", data={"subtitle": "Safe systems code"},
                          content_type="application/json")  # fmt: skip
        tree = self.get(f"/studio/courses/{c['id']}").json()
        v = tree["working_version"]["id"]
        sec = self.post(f"/studio/versions/{v}/sections", {"title": "One"}).json()["id"]
        self.post(
            f"/studio/sections/{sec}/lectures", {"kind": "article", "title": "Hello", "body": "<p>Hi</p>"}
        )
        self.post(f"/studio/versions/{v}/submit")
        self.as_(self.staff)
        queue = self.get("/console/review/courses").json()
        self.assertEqual([q["title"] for q in queue], ["Rust for Beginners"])
        self.assertEqual(
            self.post(f"/console/review/versions/{v}/request-changes", {"notes": ""}).status_code, 400
        )
        self.post(f"/console/review/versions/{v}/request-changes", {"notes": "Add a quiz"})
        self.as_(self.teacher)
        self.assertEqual(self.post(f"/studio/versions/{v}/submit").json()["status"], "in_review")
        self.as_(self.staff)
        self.assertEqual(self.post(f"/console/review/versions/{v}/approve").json()["status"], "published")
        self.assertEqual(Course.objects.get(pk=c["id"]).status, "published")
        self.assertEqual(CourseVersion.objects.get(pk=v).reviewed_by_id, self.staff.id)

        # instructors
        self.as_(self.omar)
        self.post("/studio/instructor-profile", {"headline": "Data science teacher"})
        self.as_(self.staff)
        self.assertEqual(
            [i["email"] for i in self.get("/console/instructors").json()], ["omar@learnhub.example.com"]
        )

        def restore():  # revenue_shares is reference data that survives between tests
            with tenant_context(user_id=self.staff.id, staff=True):
                payouts.set_default_fee(fee_bps=6300)

        self.addCleanup(restore)

        def put(path, data):
            return self.client.put(API + path, data=data, content_type="application/json")

        self.assertEqual(put("/console/platform-fee", {"fee_pct": 120}).status_code, 422)
        self.assertEqual(put("/console/platform-fee", {"fee_pct": 20}).json(), {"default_fee_pct": 20.0})
        self.assertEqual(self.post(f"/console/instructors/{self.omar.id}/decision", {"approve": True}).json()["status"],
                         "approved")  # fmt: skip
        self.assertEqual(InstructorProfile.objects.get(user=self.omar).platform_fee_bps, 2000)  # default kept
        put("/console/platform-fee", {"fee_pct": 30})
        row = self.get("/console/instructors?status=approved").json()
        omar = next(i for i in row if i["user_id"] == str(self.omar.id))
        self.assertEqual((omar["platform_fee_pct"], omar["fee_is_custom"]), (20.0, True))
        self.assertEqual(
            put(f"/console/instructors/{self.omar.id}/fee", {"fee_pct": 12.5}).json()["platform_fee_pct"],
            12.5,
        )
        reset = put(f"/console/instructors/{self.omar.id}/fee", {"fee_pct": None}).json()
        self.assertEqual((reset["platform_fee_pct"], reset["fee_is_custom"]), (30.0, False))
        self.as_(self.omar)
        self.assertEqual(self.get("/studio/revenue").json()["platform_fee_pct"], 30.0)
        self.assertEqual(put(f"/console/instructors/{self.omar.id}/fee", {"fee_pct": 0}).status_code, 403)
        self.as_(self.staff)

        # currencies: no rate, no switch-on; a manual rate makes prices appear
        self.assertEqual(self.client.patch(f"{API}/console/currencies/AED", data={"is_active": True},
                                           content_type="application/json").status_code, 400)  # fmt: skip
        self.post("/console/fx-rates", {"code": "AED", "rate": "4.85"})
        self.client.patch(
            f"{API}/console/currencies/AED", data={"is_active": True}, content_type="application/json"
        )
        self.assertTrue(PriceTierAmount.objects.filter(currency_id="AED").exists())

        # payouts: approve a Stripe payout (transfer faked)
        payouts.set_payout_account(user=self.teacher, method="stripe", stripe_account_id="acct_1")
        self.post(f"/console/payout-accounts/{self.teacher.id}/verify")
        with tenant_context(user_id=self.staff.id, staff=True):
            Earning.objects.create(user=self.teacher, kind="adjustment", course=course, channel="marketplace",
                                   gross_gbp_minor=0, share_bps=0, amount_gbp_minor=5000, earned_at=order.created_at,
                                   available_at=order.created_at)  # fmt: skip
        payouts.create_payouts(period_end=date(2026, 10, 31))
        pending = self.get("/console/payouts").json()
        with mock.patch("apps.commerce.gateway.transfer", return_value="tr_1"):
            r = self.post(f"/console/payouts/{pending[0]['id']}/approve").json()
        self.assertEqual((r["status"], r["provider_ref"]), ("paid", "tr_1"))

        # suspend and anonymise
        self.assertEqual(self.post(f"/console/users/{self.staff.id}/anonymize").status_code, 400)  # not staff
        self.post(f"/console/users/{self.omar.id}/anonymize")
        omar = User.objects.get(pk=self.omar.id)
        self.assertEqual(
            (omar.full_name, omar.is_active, omar.has_usable_password()), ("Deleted user", False, False)
        )
        self.assertTrue(omar.email.endswith("@deleted.invalid"))
        self.as_(omar)
        self.assertEqual(self.get("/identity/me").status_code, 401)  # every session is dead

        # support desk sees internal notes; the audit log has everything
        self.as_(self.sara)
        t = self.post("/engagement/tickets", {"subject": "Refund please", "category": "payment",
                                              "body": "Wrong course"}).json()  # fmt: skip
        self.as_(self.staff)
        self.post(f"/console/tickets/{t['id']}/messages", {"body": "Check order", "internal": True})
        self.assertTrue(self.get(f"/console/tickets/{t['id']}").json()["messages"][1]["internal"])
        actions = {a["action"] for a in self.get("/console/audit").json()["items"]}
        for expected in ("course.approve", "course.request_changes", "instructor.decision", "fx.manual",
                         "payout.approve", "user.anonymize"):  # fmt: skip
            self.assertIn(expected, actions)
        health = self.get("/console/health").json()
        self.assertEqual(health["outbox_stuck"], 0)
