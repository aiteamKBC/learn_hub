"""B2C-08 tests: token-spend instructor earnings."""

import uuid
from decimal import Decimal

from apps.catalog.models import Category, Course, CourseInstructor, CourseVersion
from apps.commerce import wallet
from apps.commerce.models import TokenSpend
from apps.identity.models import User
from apps.payouts.models import Earning, RevenueShare
from apps.payouts.services_tokens import record_token_spend_earning
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class TokenSpendEarningTest(SchemaTransactionTestCase):
    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        with tenant_context(user_id=None, staff=True):
            self.learner = User.objects.create_user(
                f"earn-l-{tag}@learnhub-demo.com",
                "test123",
                is_staff=False,
            )
            self.instructor = User.objects.create_user(
                f"earn-i-{tag}@learnhub-demo.com",
                "test123",
                is_staff=False,
            )
            self.staff = User.objects.create_user(
                f"earn-s-{tag}@learnhub-demo.com",
                "test123",
                is_staff=True,
            )
            self._setup_catalog(tag)
            self._setup_revenue_share()
            self._setup_spend(tag)

    def _setup_catalog(self, tag):
        self.category = Category.objects.create(
            slug=f"earn-cat-{tag}",
            name=f"EarnCat {tag}",
            sort_order=0,
        )
        self.course = Course.objects.create(
            ownership="instructor",
            status="published",
            created_by=self.instructor,
            category=self.category,
            slug=f"earn-c-{tag}",
            title=f"Earn Course {tag}",
        )
        v = CourseVersion.objects.create(course=self.course, number=1, status="published")
        self.course.live_version = v
        self.course.save(update_fields=["live_version"])
        CourseInstructor.objects.create(
            course=self.course,
            user=self.instructor,
            position=0,
            revenue_share_bps=10000,
        )

    def _setup_revenue_share(self):
        RevenueShare.objects.get_or_create(
            channel="marketplace",
            defaults={"instructor_bps": 7000},
        )
        RevenueShare.objects.get_or_create(
            channel="token_spend",
            defaults={"instructor_bps": 8000},
        )

    def _setup_spend(self, tag):
        self.spend = TokenSpend.objects.create(
            user=self.learner,
            scope="lecture",
            target_id=uuid.uuid4(),
            tokens_total=50,
            weighted_unit_cost_gbp=Decimal("0.0800"),
            course_id=self.course.id,
            instructor_id=self.instructor.id,
        )

    def test_earn_created(self):
        with tenant_context(staff=True):
            count = record_token_spend_earning(self.spend.id)
        self.assertEqual(count, 1)
        with tenant_context(staff=True):
            e = Earning.objects.get(token_spend=self.spend)
        self.assertEqual(e.kind, "token_spend")
        self.assertEqual(e.user_id, self.instructor.id)
        self.assertEqual(e.gross_gbp_minor, 4)  # 50 * 0.08 = 4.00 GBP minor

    def test_earn_amount_uses_share(self):
        with tenant_context(staff=True):
            RevenueShare.objects.filter(channel="marketplace").update(instructor_bps=7000)
            record_token_spend_earning(self.spend.id)
            e = Earning.objects.get(token_spend=self.spend)
        self.assertEqual(e.share_bps, 7000)
        self.assertEqual(e.amount_gbp_minor, 2)  # 4 * 7000 / 10000 = 2.8 â†’ truncated to 2

    def test_idempotent(self):
        with tenant_context(staff=True):
            record_token_spend_earning(self.spend.id)
            count = record_token_spend_earning(self.spend.id)
        self.assertEqual(count, 0)

    def test_wallet_spend_records_earning_automatically(self):
        with tenant_context(user_id=str(self.staff.id), staff=True):
            wallet.grant_tokens(
                user=self.learner,
                source="pack",
                amount=50,
                unit_cost_gbp=Decimal("0.0800"),
                actor=self.staff,
            )
        with tenant_context(user_id=str(self.learner.id), staff=True):
            spend = wallet.spend_tokens(
                user=self.learner,
                scope="lecture",
                target_id=uuid.uuid4(),
                tokens=50,
                course_id=self.course.id,
                instructor_id=self.instructor.id,
                actor=self.learner,
            )
        with tenant_context(staff=True):
            earning = Earning.objects.get(token_spend=spend)
        self.assertEqual(earning.user_id, self.instructor.id)
        self.assertEqual(earning.share_bps, 7000)

    def test_no_earn_for_platform_course(self):
        with tenant_context(staff=True):
            self.course.ownership = "platform"
            self.course.save(update_fields=["ownership"])
            count = record_token_spend_earning(self.spend.id)
        self.assertEqual(count, 0)

    def test_no_earn_for_zero_cost(self):
        with tenant_context(staff=True):
            self.spend.weighted_unit_cost_gbp = Decimal("0")
            self.spend.save(update_fields=["weighted_unit_cost_gbp"])
            count = record_token_spend_earning(self.spend.id)
        self.assertEqual(count, 0)
