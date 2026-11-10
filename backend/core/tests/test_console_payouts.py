"""M5 P12: payout requests (instructor side and console), the reserved bundle and its
carry-over, approve / mark paid / reject / dispute / fail, settings (minimum, hold,
schedule), methods with masked bank details, and the scheduled run."""

from datetime import date, timedelta
from unittest import mock

from django.core.cache import cache
from django.utils import timezone

from apps.engagement.models import Notification
from apps.identity.models import InstructorProfile
from apps.payouts import selectors, services
from apps.payouts.models import Earning, Payout, PayoutAccount, PayoutRequest
from apps.platform import services as platform
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


class PayoutRequestsTest(SchemaTransactionTestCase):
    def setUp(self):
        cache.clear()  # settings are cached for 60 s
        self.addCleanup(cache.clear)  # and must not leak into the next test class
        self.staff, self.tom, self.sara, self.omar = f.users()
        f.money(self.staff)
        InstructorProfile.objects.create(user=self.tom, status="approved")
        self.course = f.course(staff=self.staff, owner=self.tom, slug="py", title="Python")

    # ------------------------------------------------------------ helpers
    def earn(self, pence, *, days_ago=40, user=None):
        """An earning line already past (or inside) the hold."""
        at = timezone.now() - timedelta(days=days_ago)
        with tenant_context(user_id=self.staff.id, staff=True):
            return Earning.objects.create(user=user or self.tom, kind="adjustment", course=self.course,
                                          channel="marketplace", gross_gbp_minor=0, share_bps=0,
                                          amount_gbp_minor=pence, earned_at=at,
                                          available_at=at + timedelta(days=30))  # fmt: skip

    def as_(self, user):
        self.client.force_login(user)

    def get(self, path):
        return self.client.get(API + path)

    def post(self, path, data=None):
        return self.client.post(API + path, data=data or {}, content_type="application/json")

    def put(self, path, data):
        return self.client.put(API + path, data=data, content_type="application/json")

    def row(self, model, **kw):
        with tenant_context(staff=True):
            return model.objects.get(**kw)

    def kinds(self, user):
        with tenant_context(staff=True):
            return list(Notification.objects.filter(user=user).values_list("kind", flat=True))

    def add_bank(self):
        self.as_(self.tom)
        r = self.put("/payouts/methods", {"method": "bank", "bank_account_name": "Tom Teacher",
                                          "bank_sort_code_last2": "42", "bank_account_last4": "4242",
                                          "make_default": True})  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def verify(self):
        self.as_(self.staff)
        self.assertEqual(self.post(f"/console/payout-accounts/{self.tom.id}/verify").status_code, 200)

    # ------------------------------------------------------------ tests
    def test_request_rules_bundle_and_paid(self):
        self.earn(3000)
        self.earn(2000)
        self.earn(9000, days_ago=5)  # still inside the hold
        self.as_(self.tom)
        me = self.get("/payouts/me").json()
        self.assertEqual((me["balance"]["available"], me["balance"]["pending"]), (5000, 9000))
        self.assertEqual(me["minimum_gbp_minor"], 2500)  # client question 2 default
        self.assertFalse(me["can_request"])
        self.assertEqual(me["reason"], "Add a payout method first.")

        me = self.add_bank()
        self.assertEqual(me["methods"][0]["detail"], "Tom Teacher (•••• 4242)")
        with tenant_context(staff=True):
            account = PayoutAccount.objects.get(user=self.tom)
        self.assertEqual((account.bank_account_last4, account.bank_sort_code_last2), ("4242", "42"))
        self.assertTrue(me["can_request"])

        self.assertEqual(
            self.post("/payouts/requests", {"amount_gbp_minor": 2000, "method": "bank"}).status_code, 400
        )
        self.assertEqual(
            self.post("/payouts/requests", {"amount_gbp_minor": 6000, "method": "bank"}).status_code, 400
        )
        self.assertEqual(self.post("/payouts/requests", {"amount_gbp_minor": 4000, "method": "paypal"}).status_code,
                         400)  # fmt: skip
        r = self.post("/payouts/requests", {"amount_gbp_minor": 4000, "method": "bank", "note": "Thanks"})
        self.assertEqual(r.status_code, 200, r.content)
        req_id = r.json()["id"]
        self.assertTrue(r.json()["reference"].startswith("PAY-"))
        again = self.post("/payouts/requests", {"amount_gbp_minor": 1000, "method": "bank"})
        self.assertEqual(again.json()["error"]["message"], "You already have a payout request in progress.")
        self.assertIn("staff_payout_request", self.kinds(self.staff))

        # the scheduled run leaves people with a pending request alone
        self.assertEqual(services.create_payouts(period_end=date.today()), [])

        self.as_(self.staff)
        self.assertEqual(
            self.post(f"/console/payout-requests/{req_id}/approve").status_code, 400
        )  # not verified
        self.verify()
        self.assertIn("payout_account_verified", self.kinds(self.tom))
        row = self.post(f"/console/payout-requests/{req_id}/approve").json()
        self.assertEqual(row["status"], "approved")
        req = self.row(PayoutRequest, pk=req_id)
        with tenant_context(staff=True):
            bundled = Earning.objects.filter(payout=req.payout).values_list("amount_gbp_minor", flat=True)
            self.assertEqual(sum(bundled), 4000)  # exactly the request: 3000 + 2000 - 1000 carried over
            self.assertEqual(selectors.balance(user_id=self.tom.id)["available"], 1000)
        self.assertIn("payout_request_approved", self.kinds(self.tom))

        self.assertEqual(self.post(f"/console/payout-requests/{req_id}/mark-paid", {"provider_ref": ""}).status_code,
                         422)  # fmt: skip
        paid = self.post(f"/console/payout-requests/{req_id}/mark-paid", {"provider_ref": "BACS-881"}).json()
        self.assertEqual((paid["status"], paid["provider_ref"]), ("paid", "BACS-881"))
        self.assertEqual(self.row(Payout, pk=req.payout_id).status, "paid")
        self.assertIn("payout_paid", self.kinds(self.tom))
        actions = {a["action"] for a in self.get("/console/audit").json()["items"]}
        self.assertTrue({"payout_request.approve", "payout_request.paid", "payout_account.verify"} <= actions)

        overview = self.get("/console/payouts/overview").json()
        self.assertEqual(overview["total_paid_gbp_minor"], 4000)
        self.assertEqual(overview["approved_month"]["value"], 4000)
        balances = {b["user_id"]: b for b in self.get("/console/payouts/balances").json()}
        self.assertEqual(balances[str(self.tom.id)]["available"], 1000)
        listed = self.get("/console/payout-requests?status=paid&q=tom").json()["items"]
        self.assertEqual([x["id"] for x in listed], [req_id])
        self.as_(self.tom)
        self.assertEqual(self.get("/payouts/requests").json()[0]["status"], "paid")

    def test_dispute_reject_and_fail_release_the_money(self):
        self.earn(5000)
        self.add_bank()
        self.verify()
        self.as_(self.tom)
        req_id = self.post("/payouts/requests", {"amount_gbp_minor": 5000, "method": "bank"}).json()["id"]
        self.as_(self.staff)
        self.assertEqual(
            self.post(f"/console/payout-requests/{req_id}/dispute", {"reason": ""}).status_code, 422
        )
        self.assertEqual(self.post(f"/console/payout-requests/{req_id}/dispute",
                                   {"reason": "Checking a refund claim"}).json()["status"], "disputed")  # fmt: skip
        self.assertIn("payout_request_disputed", self.kinds(self.tom))
        self.assertEqual(self.post(f"/console/payout-requests/{req_id}/approve").json()["status"], "approved")
        self.assertEqual(self.post(f"/console/payout-requests/{req_id}/fail",
                                   {"reason": "The bank returned it"}).json()["status"], "failed")  # fmt: skip
        req = self.row(PayoutRequest, pk=req_id)
        self.assertEqual(self.row(Payout, pk=req.payout_id).status, "failed")
        with tenant_context(staff=True):
            self.assertEqual(selectors.balance(user_id=self.tom.id)["available"], 5000)  # back again

        self.as_(self.tom)
        second = self.post("/payouts/requests", {"amount_gbp_minor": 3000, "method": "bank"}).json()["id"]
        self.as_(self.staff)
        self.assertEqual(self.post(f"/console/payout-requests/{second}/reject",
                                   {"reason": "Details missing"}).json()["status"], "rejected")  # fmt: skip
        self.assertIn("payout_request_rejected", self.kinds(self.tom))
        self.assertEqual(self.post(f"/console/payout-requests/{second}/approve").status_code, 400)  # closed

    def test_stripe_requests_pay_at_once(self):
        self.earn(4000)
        services.save_method(user=self.tom, method="stripe", stripe_account_id="acct_9", make_default=True)
        self.verify()
        self.as_(self.tom)
        r = self.post("/payouts/requests", {"amount_gbp_minor": 4000, "method": "stripe"})
        self.assertEqual(r.status_code, 200, r.content)
        req_id = r.json()["id"]
        self.as_(self.staff)
        with mock.patch("apps.commerce.gateway.transfer", return_value="tr_42") as transfer:
            row = self.post(f"/console/payout-requests/{req_id}/approve").json()
        self.assertEqual((row["status"], row["provider_ref"]), ("paid", "tr_42"))
        self.assertEqual(transfer.call_args.kwargs["amount_gbp_minor"], 4000)

    def test_settings_hold_minimum_and_schedule(self):
        self.as_(self.staff)
        r = self.put("/console/payouts/settings", {"schedule": "weekly", "day_of_month": 5, "minimum_gbp_minor": 1000,
                                                   "hold_days": 7, "requests_enabled": False})  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["next_payout_date"], str(services.next_payout_date()))
        self.assertEqual(services.next_payout_date(date(2026, 11, 4)), date(2026, 11, 9))  # next Monday
        self.assertEqual(self.put("/console/payouts/settings", {"schedule": "daily", "day_of_month": 5,
                                                                "minimum_gbp_minor": 1, "hold_days": 1,
                                                                "requests_enabled": True}).status_code, 422)  # fmt: skip
        self.assertEqual(services.hold_days(), 30)  # never shorter than the refund window (30 by default)
        with tenant_context(user_id=self.staff.id, staff=True):
            platform.set_setting(key="payments.refund_window_days", value=5, by=self.staff)
        self.assertEqual(services.hold_days(), 7)
        with tenant_context(user_id=self.staff.id, staff=True):
            platform.set_setting(key="payments.refund_window_days", value=14, by=self.staff)
        self.assertEqual(services.hold_days(), 14)
        self.assertEqual(services.minimum_gbp_minor(), 1000)
        self.earn(4000)
        self.add_bank()
        me = self.get("/payouts/me").json()
        self.assertFalse(me["can_request"])
        self.assertIn("switched off", me["reason"])
        with tenant_context(user_id=self.staff.id, staff=True):
            platform.set_setting(key="payouts.schedule", value="monthly", by=self.staff)
        self.assertTrue(services.is_payout_day(date(2026, 12, 5)))
        self.assertEqual(services.next_payout_date(date(2026, 12, 6)), date(2027, 1, 5))

    def test_scheduled_run_on_payout_day(self):
        self.earn(4000)
        services.save_method(user=self.tom, method="paypal", paypal_email="tom@pay.test", make_default=True)
        with tenant_context(user_id=self.staff.id, staff=True):
            services.verify_account(account=PayoutAccount.objects.get(user=self.tom))
        self.assertEqual(services.scheduled_run(date(2026, 12, 4))["payouts"], 0)  # not the 5th
        self.assertEqual(services.scheduled_run(date(2026, 12, 5))["payouts"], 1)
        self.assertIn("staff_payout_due", self.kinds(self.staff))

    def test_methods_default_and_remove(self):
        self.add_bank()
        me = self.put("/payouts/methods", {"method": "wise", "wise_email": "Tom@Wise.test"}).json()
        self.assertEqual({m["method"] for m in me["methods"]}, {"bank", "wise"})
        self.assertEqual(me["default_method"], "bank")
        self.assertEqual(self.client.delete(f"{API}/payouts/methods/bank").status_code, 400)  # the default
        self.put("/payouts/methods/default", {"method": "wise"})
        me = self.client.delete(f"{API}/payouts/methods/bank").json()
        self.assertEqual([m["method"] for m in me["methods"]], ["wise"])
        self.assertEqual(self.put("/payouts/methods", {"method": "bank", "bank_account_name": "T",
                                                       "bank_account_last4": "12"}).status_code, 400)  # fmt: skip
        self.as_(self.sara)  # not an instructor
        self.assertEqual(self.get("/payouts/me").status_code, 403)
