"""B2C-03 (M8 / M13) — token pricing service tests.

Follows the `SchemaTransactionTestCase` convention used by `apps.platform.tests.test_access_resolver`
and `apps.commerce.tests.test_commerce` (schema-qualified tables, owner connection for RLS tests).
"""

from datetime import timedelta
from decimal import Decimal

from django.core.exceptions import PermissionDenied, ValidationError
from django.utils import timezone

from apps.catalog import services as cat
from apps.catalog.models import Lecture, LectureResource, MediaAsset, VideoLibrary
from apps.commerce import pricing_service as ps
from apps.commerce.models import (
    BonusCampaign,
    PriceTier,
    TokenPack,
    TokenRate,
    TopUpPolicy,
)
from apps.identity.models import User
from apps.platform.models import ContentEntitlement
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class _Base(SchemaTransactionTestCase):
    def setUp(self):
        self.staff = User.objects.create_user("staff-tp@learnhub-demo.com", "x", is_staff=True)
        self.learner = User.objects.create_user("learner-tp@learnhub-demo.com", "x")
        with tenant_context(user_id=self.staff.id, staff=True):
            self.tier, _ = PriceTier.objects.get_or_create(
                name="Tier-TP", defaults={"gbp_minor": 1000}
            )
            self.lib, _ = VideoLibrary.objects.get_or_create(
                environment="test", bunny_library_id=99,
                defaults={"name": "L-tp", "cdn_hostname": "vz-tp.test", "is_default": False},
            )

    def _course(self, slug="tp-course"):
        with tenant_context(user_id=self.staff.id, staff=True):
            course = cat.create_course(
                title=f"TP-{slug}", slug=slug, ownership="platform",
                created_by=self.staff, owner_org_id=None,
            )
            v = course.versions.get()
            sec = cat.add_section(version=v, title="S")
            # Articles only — pass `cat.submit`'s readiness check.
            lectures = [
                cat.add_lecture(section=sec, kind="article", title=f"L{i}", body="body")
                for i in range(4)
            ]
            cat.submit(version=v, by=self.staff)
            course.refresh_from_db()
        return course, lectures


# ============================================================================= permissions
class PermissionTests(_Base):
    def test_non_staff_set_lecture_price_denied(self):
        course, lectures = self._course()
        with tenant_context(user_id=self.staff.id, staff=True):
            with self.assertRaises(PermissionDenied):
                ps.set_lecture_token_price(
                    lectures[0], 10, actor=self.learner, reason="try"
                )

    def test_non_staff_upsert_pack_denied(self):
        with self.assertRaises(PermissionDenied):
            ps.upsert_token_pack(
                name="p", token_amount=10, price_tier=self.tier,
                is_active=True, sort_order=0, actor=self.learner, reason="try",
            )

    def test_non_staff_upsert_rate_denied(self):
        with self.assertRaises(PermissionDenied):
            ps.upsert_token_rate(
                tokens_per_gbp_minor=Decimal("0.1"),
                effective_from=timezone.now() + timedelta(days=1),
                actor=self.learner, reason="try",
            )

    def test_non_staff_distribute_denied(self):
        course, _ = self._course()
        with self.assertRaises(PermissionDenied):
            ps.distribute_course_token_price(
                course, 100, weights_config={"lecture_types": {"article": 1.0}},
                actor=self.learner, reason="try",
            )


# ============================================================================= audit
class AuditTests(_Base):
    def _audit_count(self, target_type, target_id):
        from django.db import connection
        with connection.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM platform.audit_logs "
                "WHERE target_type = %s AND target_id = %s",
                [target_type, str(target_id)],
            )
            return cur.fetchone()[0]

    def test_audit_row_on_lecture_price(self):
        course, lectures = self._course("audit-lp")
        with tenant_context(user_id=self.staff.id, staff=True):
            before = self._audit_count("lecture", lectures[0].id)
            ps.set_lecture_token_price(lectures[0], 25, actor=self.staff, reason="initial")
            after = self._audit_count("lecture", lectures[0].id)
        self.assertEqual(after, before + 1)

    def test_audit_row_on_pack(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            pack = ps.upsert_token_pack(
                name="Starter", token_amount=100, price_tier=self.tier,
                is_active=True, sort_order=1, actor=self.staff, reason="launch",
            )
            self.assertEqual(self._audit_count("token_pack", pack.id), 1)


# ============================================================================= distribution
class DistributionTests(_Base):
    def test_no_weights_blocks(self):
        course, _ = self._course("dist-no-w")
        with self.assertRaises(ps.ConfigurationBlocked):
            ps.distribute_course_token_price(
                course, 100, weights_config=None, actor=self.staff, reason="x",
            )

    def test_missing_lecture_type_weight_raises(self):
        course, _ = self._course("dist-missing")
        with self.assertRaises(ValidationError) as cm:
            ps.distribute_course_token_price(
                course, 100,
                weights_config={"lecture_types": {"video": 1.0}, "use_duration": False},
                actor=self.staff, reason="x",
            )
        # Must list the missing types in the error
        self.assertIn("article", str(cm.exception))

    def test_sum_equals_total_and_deterministic(self):
        course, _ = self._course("dist-sum")
        weights = {"lecture_types": {"article": 1.0}, "use_duration": False}
        with tenant_context(user_id=self.staff.id, staff=True):
            r1 = ps.distribute_course_token_price(
                course, 1000, weights_config=weights, actor=self.staff,
                reason="x", dry_run=True,
            )
            r2 = ps.distribute_course_token_price(
                course, 1000, weights_config=weights, actor=self.staff,
                reason="x", dry_run=True,
            )
        total = sum(r["allocated_price"] for r in r1)
        self.assertEqual(total, 1000)
        # determinism
        self.assertEqual(
            [r["allocated_price"] for r in r1],
            [r["allocated_price"] for r in r2],
        )

    def test_dry_run_does_not_write(self):
        course, lectures = self._course("dist-dry")
        weights = {"lecture_types": {"article": 1.0}}
        with tenant_context(user_id=self.staff.id, staff=True):
            ps.distribute_course_token_price(
                course, 100, weights_config=weights, actor=self.staff,
                reason="x", dry_run=True,
            )
            lectures[0].refresh_from_db()
            self.assertIsNone(lectures[0].token_price)

    def test_hamilton_pure_math(self):
        # Pure-math test: no DB required for this one.
        result = ps._hamilton_allocate([2.0, 1.0, 1.0, 1.0], 100)
        self.assertEqual(sum(result), 100)
        # First (highest weight) must be >= any other
        self.assertTrue(all(result[0] >= r for r in result[1:]))


# ============================================================================= token rate
class TokenRateTests(_Base):
    def test_rate_in_past_rejected(self):
        with self.assertRaises(ValidationError):
            ps.upsert_token_rate(
                tokens_per_gbp_minor=Decimal("0.1"),
                effective_from=timezone.now() - timedelta(hours=1),
                actor=self.staff, reason="x",
            )

    def test_new_rate_closes_prior_open(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            t1 = ps.upsert_token_rate(
                tokens_per_gbp_minor=Decimal("0.1"),
                effective_from=timezone.now() + timedelta(days=1),
                actor=self.staff, reason="first",
            )
            t2 = ps.upsert_token_rate(
                tokens_per_gbp_minor=Decimal("0.2"),
                effective_from=timezone.now() + timedelta(days=2),
                actor=self.staff, reason="raise",
            )
        t1.refresh_from_db()
        self.assertEqual(t1.effective_to, t2.effective_from)
        # Only one row has effective_to IS NULL.
        self.assertEqual(TokenRate.objects.filter(effective_to__isnull=True).count(), 1)


# ============================================================================= top-up policy
class TopUpTests(_Base):
    def test_single_active_per_currency(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            p1 = ps.upsert_topup_policy(
                currency="GBP", min_minor=100, max_minor=10_000, is_active=True,
                actor=self.staff, reason="initial",
            )
            p2 = ps.upsert_topup_policy(
                currency="GBP", min_minor=200, max_minor=20_000, is_active=True,
                actor=self.staff, reason="raise",
            )
        p1.refresh_from_db()
        self.assertFalse(p1.is_active)
        self.assertTrue(p2.is_active)
        self.assertEqual(
            TopUpPolicy.objects.filter(currency="GBP", is_active=True).count(), 1
        )


# ============================================================================= preview guard
class PreviewTests(_Base):
    def test_material_preview_on_paid_lecture_without_confirm_fails(self):
        course, lectures = self._course("prev")
        with tenant_context(user_id=self.staff.id, staff=True):
            lec = lectures[0]
            asset = MediaAsset.objects.create(
                kind="document", uploaded_by=self.staff,
            )
            mat = LectureResource.objects.create(
                lecture=lec, asset=asset, title="pdf", position=0,
            )
            with self.assertRaises(ValidationError):
                ps.set_preview_flag(mat, True, actor=self.staff, reason="x")
            # confirm=True succeeds
            ps.set_preview_flag(mat, True, actor=self.staff, reason="x", confirm=True)
            mat.refresh_from_db()
            self.assertTrue(mat.is_free_preview)


# ============================================================================= bonus campaign (gated)
class BonusTests(_Base):
    def test_active_blocked(self):
        now = timezone.now()
        with self.assertRaises(ps.ConfigurationBlocked):
            ps.upsert_bonus_campaign(
                name="X", condition_type="first_topup", condition_value={},
                bonus_tokens=10, starts_at=now, ends_at=now + timedelta(days=30),
                is_active=True, actor=self.staff, reason="try",
            )

    def test_draft_saves(self):
        now = timezone.now()
        with tenant_context(user_id=self.staff.id, staff=True):
            camp = ps.upsert_bonus_campaign(
                name="X", condition_type="first_topup", condition_value={},
                bonus_tokens=10, starts_at=now, ends_at=now + timedelta(days=30),
                is_active=False, actor=self.staff, reason="draft",
            )
        self.assertFalse(camp.is_active)
        self.assertEqual(BonusCampaign.objects.count(), 1)

    def test_amount_xor_enforced(self):
        now = timezone.now()
        with self.assertRaises(ValidationError):
            ps.upsert_bonus_campaign(
                name="X", condition_type="first_topup", condition_value={},
                bonus_tokens=10, bonus_percent=Decimal("5"),
                starts_at=now, ends_at=now + timedelta(days=30),
                is_active=False, actor=self.staff, reason="try",
            )


# ============================================================================= entitlement preservation
class HistoricalPreservationTests(_Base):
    def test_price_change_leaves_entitlement_untouched(self):
        course, lectures = self._course("hist")
        with tenant_context(user_id=self.staff.id, staff=True):
            ps.set_lecture_token_price(lectures[0], 50, actor=self.staff, reason="initial")
            ent = ContentEntitlement.objects.create(
                user=self.learner, scope="lecture", target_id=lectures[0].id,
                source="token_unlock", granted_at=timezone.now(),
            )
            snapshot = {
                "id": ent.id, "granted_at": ent.granted_at,
                "revoked_at": ent.revoked_at, "target_id": ent.target_id,
                "source": ent.source,
            }
            ps.set_lecture_token_price(lectures[0], 500, actor=self.staff, reason="price-change")
            ent.refresh_from_db()
            for k, v in snapshot.items():
                self.assertEqual(getattr(ent, k), v, f"entitlement.{k} changed")


# ============================================================================= full course floor
class FullCourseFloorTests(_Base):
    def test_full_course_below_sum_rejected_manual(self):
        course, lectures = self._course("floor")
        with tenant_context(user_id=self.staff.id, staff=True):
            ps.set_lecture_token_price(lectures[0], 60, actor=self.staff, reason="init")
            ps.set_lecture_token_price(lectures[1], 50, actor=self.staff, reason="init")
            with self.assertRaises(ValidationError):
                ps.set_course_price(
                    course, full_course_token_price=100, mode="manual",
                    actor=self.staff, reason="try",
                )
            # At the floor is OK.
            ps.set_course_price(
                course, full_course_token_price=150, mode="manual",
                actor=self.staff, reason="ok",
            )
            course.refresh_from_db()
            self.assertEqual(course.full_course_token_price, 150)


# ============================================================================= republish survival
class RepublishTests(_Base):
    def test_token_prices_copy_to_new_version(self):
        course, lectures = self._course("repub")
        old_version = course.live_version
        with tenant_context(user_id=self.staff.id, staff=True):
            ps.set_lecture_token_price(lectures[0], 42, actor=self.staff, reason="init")
            ps.set_preview_flag(lectures[1], True, actor=self.staff, reason="init")
            # Create a new draft version — studio clones lectures by lecture_key.
            new_version = cat.create_draft(course=course, by=self.staff)
            report = ps.migrate_token_pricing_on_republish(
                old_version, new_version, actor=None
            )
        self.assertGreaterEqual(report["copied"], 1)
        # The new lecture with the same lecture_key as lectures[0] must carry the price.
        new_lec = Lecture.objects.get(
            version=new_version, lecture_key=lectures[0].lecture_key
        )
        self.assertEqual(new_lec.token_price, 42)
        new_prev = Lecture.objects.get(
            version=new_version, lecture_key=lectures[1].lecture_key
        )
        self.assertTrue(new_prev.is_free_preview)
