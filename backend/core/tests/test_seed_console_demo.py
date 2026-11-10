"""M5 P2: seed_console_demo adds believable console data, and a second run adds nothing."""

import io

from django.core.management import call_command

from apps.commerce.models import Invoice, Order, OrderItem, Plan, PlanPrice, Subscription
from apps.engagement.models import ContentReport, Ticket
from apps.identity.models import InstructorProfile, User
from apps.learning.models import Certificate, Enrollment
from apps.payouts.models import Earning, PayoutRequest
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase


class SeedConsoleDemoTest(SchemaTransactionTestCase):
    def counts(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            return {m.__name__: m.objects.count() for m in (User, Order, Enrollment, Subscription, Invoice, Ticket,
                                                          ContentReport, PayoutRequest, Certificate, Earning)}  # fmt: skip

    def test_seed_is_idempotent_and_fills_the_dashboard(self):
        self.staff, teacher, *_ = f.users()
        InstructorProfile.objects.create(user=teacher, status="approved")
        f.money(self.staff)
        for slug in ("py", "sql", "ux"):
            f.course(staff=self.staff, owner=teacher, slug=slug, title=slug.upper())
        with tenant_context(user_id=self.staff.id, staff=True):
            plan = Plan.objects.create(code="personal-monthly", name="Personal", audience="personal",
                                       interval=Plan.Interval.choices[0][0])  # fmt: skip
            PlanPrice.objects.create(plan=plan, currency_id="GBP", amount_minor=1999)
        out = io.StringIO()
        call_command("seed_console_demo", "--orders", "60", stdout=out)
        first = self.counts()
        self.assertEqual(first["User"], 4 + 36)
        self.assertGreater(first["Order"], 20)
        self.assertEqual(first["Subscription"], 14)
        self.assertEqual(first["Ticket"], 8)
        self.assertEqual(first["PayoutRequest"], 1)  # one approved instructor
        self.assertGreater(first["Invoice"], 14)
        with tenant_context(user_id=self.staff.id, staff=True):  # the instructor earns from every seeded sale
            sold = OrderItem.objects.filter(order__status__in=("paid", "refunded")).count()
            self.assertEqual(Earning.objects.filter(kind="sale").count(), sold)
            refunds = Earning.objects.filter(kind="refund")
            self.assertEqual(refunds.count(), OrderItem.objects.filter(refunded_at__isnull=False).count())
            self.assertTrue(all(e.amount_gbp_minor < 0 for e in refunds))

        call_command("seed_console_demo", "--orders", "60", stdout=io.StringIO())
        self.assertEqual(self.counts(), first)  # nothing duplicated

        self.client.force_login(self.staff)
        body = self.client.get("/api/v1/console/overview?range=90d").json()
        self.assertGreater(body["sales"]["revenue_gbp_minor"]["value"], 0)
        self.assertGreater(body["sales"]["subscription_revenue_gbp_minor"]["value"], 0)
        self.assertIn("failed_payments", {a["key"] for a in body["attention"]})
