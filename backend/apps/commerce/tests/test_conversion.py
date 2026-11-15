"""Token conversion service tests.

Covers the authoritative GBP->token conversion rule, course-price derivation, the
override gate on `set_course_price`, and the historical invariant (existing spends
are never retroactively changed).

Examples from the brief:
    £50  cash + rate 0.001 tokens/penny -> 5 tokens
    £100 cash + rate 0.001 tokens/penny -> 10 tokens
    £200 cash + rate 0.001 tokens/penny -> 20 tokens
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

from django.core.exceptions import PermissionDenied, ValidationError
from django.utils import timezone

from apps.catalog.models import Category, Course, CourseInstructor, CourseVersion
from apps.commerce import conversion, pricing_service, wallet
from apps.commerce.models import PriceTier, TokenRate
from apps.commerce.unlock import unlock_course
from apps.identity.models import User
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


def _rate(tokens_per_gbp_minor: str | Decimal, when=None):
    TokenRate.objects.filter(effective_to__isnull=True).update(effective_to=timezone.now())
    return TokenRate.objects.create(
        tokens_per_gbp_minor=Decimal(str(tokens_per_gbp_minor)),
        effective_from=when or (timezone.now() - timedelta(minutes=1)),
        effective_to=None,
    )


class PureConversionTest(SchemaTransactionTestCase):
    """The conversion math alone, no models involved beyond TokenRate."""

    def setUp(self):
        self.staff = User.objects.create_user(
            f"pc-{uuid.uuid4().hex[:6]}@learnhub-demo.com", "x", is_staff=True
        )

    def test_brief_example_ten_pounds_per_token(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            _rate("0.001")
            self.assertEqual(conversion.tokens_for_gbp_minor(5_000), 5)
            self.assertEqual(conversion.tokens_for_gbp_minor(10_000), 10)
            self.assertEqual(conversion.tokens_for_gbp_minor(15_000), 15)
            self.assertEqual(conversion.tokens_for_gbp_minor(20_000), 20)

    def test_seed_rate_fifty_tokens_per_pound(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            _rate("0.50")
            self.assertEqual(conversion.tokens_for_gbp_minor(100), 50)
            self.assertEqual(conversion.tokens_for_gbp_minor(999), 500)
            self.assertEqual(conversion.tokens_for_gbp_minor(1999), 1000)

    def test_zero_is_zero(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            _rate("0.50")
            self.assertEqual(conversion.tokens_for_gbp_minor(0), 0)

    def test_half_up_rounding_pure(self):
        # Pure rate, no DB — rate is supplied by the caller.
        self.assertEqual(conversion.tokens_for_gbp_minor(1, rate=Decimal("0.5")), 1)
        self.assertEqual(conversion.tokens_for_gbp_minor(1, rate=Decimal("0.4")), 0)

    def test_no_rate_raises(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            TokenRate.objects.filter(effective_to__isnull=True).update(effective_to=timezone.now())
        with self.assertRaises(conversion.NoTokenRate):
            conversion.tokens_for_gbp_minor(1000)

    def test_negative_input_rejected(self):
        with self.assertRaises(ValueError):
            conversion.tokens_for_gbp_minor(-1)

    def test_inverse_for_admin_tools(self):
        self.assertEqual(conversion.gbp_minor_for_tokens(50, rate=Decimal("0.001")), 50_000)
        self.assertEqual(conversion.gbp_minor_for_tokens(0, rate=Decimal("0.001")), 0)


class CourseDerivationTest(SchemaTransactionTestCase):
    """Course token price is derived from cash_price_tier.gbp_minor x TokenRate.current()."""

    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        self.staff = User.objects.create_user(f"cd-{tag}@learnhub-demo.com", "x", is_staff=True)
        with tenant_context(user_id=self.staff.id, staff=True):
            self.cat = Category.objects.create(slug=f"c-{tag}", name=f"C {tag}", sort_order=0)
            _rate("0.001")
            self.tier_50 = PriceTier.objects.create(
                name=f"T50-{tag}", gbp_minor=5_000, sort_order=1, is_active=True
            )
            self.tier_100 = PriceTier.objects.create(
                name=f"T100-{tag}", gbp_minor=10_000, sort_order=2, is_active=True
            )
            self.course = Course.objects.create(
                ownership="platform",
                status="published",
                created_by=self.staff,
                category=self.cat,
                slug=f"derived-{tag}",
                title=f"Derived {tag}",
                cash_price_tier=self.tier_50,
            )

    def test_fifty_pound_course_is_five_tokens(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            self.assertEqual(conversion.course_token_price(self.course), 5)

    def test_hundred_pound_course_is_ten_tokens(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            self.course.cash_price_tier = self.tier_100
            self.course.save(update_fields=["cash_price_tier"])
            self.assertEqual(conversion.course_token_price(self.course), 10)

    def test_stored_override_is_ignored_when_cash_tier_is_set(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            self.course.full_course_token_price = 999
            self.course.save(update_fields=["full_course_token_price"])
            self.assertEqual(conversion.course_token_price(self.course), 5)

    def test_legacy_override_used_only_when_no_cash_tier(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            self.course.cash_price_tier = None
            self.course.full_course_token_price = 42
            self.course.save(update_fields=["cash_price_tier", "full_course_token_price"])
            self.assertEqual(conversion.course_token_price(self.course), 42)

    def test_rate_change_flows_through_on_next_read(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            self.assertEqual(conversion.course_token_price(self.course), 5)
            _rate("0.002")
            self.assertEqual(conversion.course_token_price(self.course), 10)


class OverrideGateTest(SchemaTransactionTestCase):
    """set_course_price refuses to store full_course_token_price without allow_override."""

    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        self.staff = User.objects.create_user(f"og-{tag}@learnhub-demo.com", "x", is_staff=True)
        with tenant_context(user_id=self.staff.id, staff=True):
            self.cat = Category.objects.create(slug=f"og-{tag}", name=f"OG {tag}", sort_order=0)
            self.tier = PriceTier.objects.create(
                name=f"T-{tag}", gbp_minor=10_000, sort_order=1, is_active=True
            )
            self.course = Course.objects.create(
                ownership="platform",
                status="published",
                created_by=self.staff,
                category=self.cat,
                slug=f"og-course-{tag}",
                title=f"OG {tag}",
                cash_price_tier=self.tier,
            )

    def test_setting_value_without_override_is_rejected(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            with self.assertRaises(ValidationError) as cm:
                pricing_service.set_course_price(
                    self.course,
                    full_course_token_price=999,
                    actor=self.staff,
                    reason="try to override",
                )
        self.assertIn("derived", str(cm.exception).lower())

    def test_explicit_override_is_accepted_with_reason(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            pricing_service.set_course_price(
                self.course,
                full_course_token_price=999,
                allow_override=True,
                actor=self.staff,
                reason="launch promo: half price for cohort A",
            )
            self.course.refresh_from_db()
        self.assertEqual(self.course.full_course_token_price, 999)

    def test_clearing_the_field_is_always_allowed(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            self.course.full_course_token_price = 500
            self.course.save(update_fields=["full_course_token_price"])
            pricing_service.set_course_price(
                self.course,
                full_course_token_price=None,
                actor=self.staff,
                reason="back to derived",
            )
            self.course.refresh_from_db()
        self.assertIsNone(self.course.full_course_token_price)

    def test_non_staff_still_refused(self):
        normal = User.objects.create_user(
            f"nobody-{uuid.uuid4().hex[:6]}@learnhub-demo.com", "x", is_staff=False
        )
        with self.assertRaises(PermissionDenied):
            pricing_service.set_course_price(
                self.course,
                full_course_token_price=None,
                actor=normal,
                reason="learner tries",
            )


class CheckoutSnapshotTest(SchemaTransactionTestCase):
    """unlock_course charges the DERIVED price, snapshots it on TokenSpend, and later rate
    changes do not rewrite that history."""

    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        self.staff = User.objects.create_user(f"cs-{tag}@learnhub-demo.com", "x", is_staff=True)
        self.user = User.objects.create_user(f"cs-u-{tag}@learnhub-demo.com", "x", is_staff=False)
        with tenant_context(user_id=self.staff.id, staff=True):
            self.cat = Category.objects.create(slug=f"cs-{tag}", name=f"CS {tag}", sort_order=0)
            self.tier = PriceTier.objects.create(
                name=f"T-{tag}", gbp_minor=10_000, sort_order=1, is_active=True
            )  # £100
            _rate("0.001")  # 1 token = £10
            self.course = Course.objects.create(
                ownership="platform",
                status="published",
                created_by=self.staff,
                category=self.cat,
                slug=f"cs-course-{tag}",
                title=f"CS {tag}",
                cash_price_tier=self.tier,
                full_course_token_price=999,  # legacy wrong value — must be ignored
            )
            CourseInstructor.objects.create(course=self.course, user=self.staff, position=0)
            self.version = CourseVersion.objects.create(
                course=self.course, number=1, status="published"
            )
            self.course.live_version = self.version
            self.course.save(update_fields=["live_version"])
            wallet.grant_tokens(user=self.user, source="admin", amount=100, actor=self.staff)

    def test_derived_price_is_charged_not_stored(self):
        with tenant_context(user_id=str(self.user.id), staff=True):
            ent = unlock_course(user=self.user, course_id=self.course.id)
            from apps.commerce.models import TokenSpend

            spend = TokenSpend.objects.get(pk=ent.source_ref)
            self.assertEqual(spend.tokens_total, 10)
            self.assertEqual(wallet.get_balance(self.user), 90)

    def test_later_rate_change_does_not_rewrite_history(self):
        with tenant_context(user_id=str(self.user.id), staff=True):
            ent = unlock_course(user=self.user, course_id=self.course.id)
        from apps.commerce.models import TokenSpend

        with tenant_context(user_id=str(self.staff.id), staff=True):
            before = TokenSpend.objects.get(pk=ent.source_ref).tokens_total
            _rate("0.002")
            after = TokenSpend.objects.get(pk=ent.source_ref).tokens_total
        self.assertEqual(before, after)
        self.assertEqual(after, 10)
