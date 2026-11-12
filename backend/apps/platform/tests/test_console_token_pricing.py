"""B2C-03 PR 2 — console token-pricing endpoint tests.

Follows the CommerceBase / tenant_context pattern used by test_console_pricing.py.
"""

import json
from datetime import timedelta

from django.db import connections
from django.utils import timezone

from apps.catalog import services as cat
from apps.catalog.models import Lecture, LectureResource, MediaAsset, VideoLibrary
from apps.commerce.models import (
    BonusCampaign,
    PriceTier,
    TokenPack,
    TokenRate,
    TopUpPolicy,
)
from apps.identity.models import User
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1/console"


class _Base(SchemaTransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Warm the Django connection schema cache for catalog.courses' PR-1 columns —
        # on a fresh Neon test DB the first SELECT against the new columns can hit a
        # stale schema snapshot. One cheap read populates it for the rest of the run.
        from apps.catalog.models import Course

        try:
            Course.objects.only("id").first()
        except Exception:  # noqa: BLE001, S110 - warm-up is best effort in test setup
            pass

    def setUp(self):
        self.staff = User.objects.create_user("staff-ctp@learnhub-demo.com", "x", is_staff=True)
        self.learner = User.objects.create_user("learner-ctp@learnhub-demo.com", "x")
        with tenant_context(user_id=self.staff.id, staff=True):
            self.tier, _ = PriceTier.objects.get_or_create(name="Tier-CTP", defaults={"gbp_minor": 999})
            self.lib, _ = VideoLibrary.objects.get_or_create(
                environment="test",
                bunny_library_id=101,
                defaults={"name": "L-ctp", "cdn_hostname": "vz-ctp.test", "is_default": False},
            )
        self.course, self.lectures = self._course("ctp-c1")

    def _course(self, slug):
        with tenant_context(user_id=self.staff.id, staff=True):
            course = cat.create_course(
                title=f"CTP-{slug}",
                slug=slug,
                ownership="platform",
                created_by=self.staff,
                owner_org_id=None,
            )
            v = course.versions.get()
            sec = cat.add_section(version=v, title="S")
            lectures = [
                cat.add_lecture(section=sec, kind="article", title=f"L{i}", body="body") for i in range(4)
            ]
            cat.submit(version=v, by=self.staff)
            course.refresh_from_db()
        return course, lectures

    def _audit_rows(self, target_type=None, target_id=None):
        sql = "SELECT COUNT(*) FROM platform.audit_logs WHERE 1=1"
        params = []
        if target_type:
            sql += " AND target_type=%s"
            params.append(target_type)
        if target_id:
            sql += " AND target_id=%s"
            params.append(str(target_id))
        # The owner connection bypasses user-scoped RLS on platform.audit_logs.
        with connections["owner"].cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()[0]

    def _get(self, path):
        return self.client.get(f"{API}{path}")

    def _post(self, path, body):
        return self.client.post(
            f"{API}{path}", data=json.dumps(body, default=str), content_type="application/json"
        )

    def _patch(self, path, body):
        return self.client.patch(
            f"{API}{path}", data=json.dumps(body, default=str), content_type="application/json"
        )

    def _put(self, path, body):
        return self.client.put(
            f"{API}{path}", data=json.dumps(body, default=str), content_type="application/json"
        )

    def _delete(self, path):
        return self.client.delete(f"{API}{path}")


# ============================================================================= auth
class AuthTests(_Base):
    def test_non_staff_forbidden(self):
        self.client.force_login(self.learner)
        r = self._get("/pricing/token/courses")
        self.assertEqual(r.status_code, 403)
        r = self._patch(
            f"/pricing/token/courses/{self.course.id}",
            {"full_course_token_price": 100, "reason": "nope"},
        )
        self.assertEqual(r.status_code, 403)
        r = self._get("/pricing/token/packs")
        self.assertEqual(r.status_code, 403)

    def test_staff_passes(self):
        self.client.force_login(self.staff)
        self.assertEqual(self._get("/pricing/token/courses").status_code, 200)
        self.assertEqual(self._get("/pricing/token/packs").status_code, 200)


# ============================================================================= course PATCH / UNSET
class CoursePatchTests(_Base):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.staff)

    def test_set_value_writes(self):
        r = self._patch(
            f"/pricing/token/courses/{self.course.id}",
            {"full_course_token_price": 500, "reason": "launch"},
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.course.refresh_from_db()
        self.assertEqual(self.course.full_course_token_price, 500)
        self.assertGreaterEqual(self._audit_rows("course", self.course.id), 1)

    def test_unset_leaves_alone(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            self.course.full_course_token_price = 200
            self.course.save(update_fields=["full_course_token_price"])
        # body has only reason — UNSET for everything else
        r = self._patch(
            f"/pricing/token/courses/{self.course.id}",
            {"reason": "noop"},
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.course.refresh_from_db()
        self.assertEqual(self.course.full_course_token_price, 200)

    def test_explicit_null_clears(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            self.course.full_course_token_price = 200
            self.course.save(update_fields=["full_course_token_price"])
        r = self._patch(
            f"/pricing/token/courses/{self.course.id}",
            {"full_course_token_price": None, "reason": "clear"},
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.course.refresh_from_db()
        self.assertIsNone(self.course.full_course_token_price)


# ============================================================================= lecture preview confirm
class LecturePreviewTests(_Base):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.staff)
        with tenant_context(user_id=self.staff.id, staff=True):
            lec = self.lectures[0]
            asset = MediaAsset.objects.create(kind="document", uploaded_by=self.staff)
            self.mat = LectureResource.objects.create(
                lecture=lec,
                asset=asset,
                title="pdf",
                position=0,
                token_price=10,
            )

    def test_material_preview_requires_confirm(self):
        r = self._patch(
            f"/pricing/token/materials/{self.mat.id}",
            {"is_free_preview": True, "reason": "try-x"},
        )
        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertEqual(body["error"]["code"], "VALIDATION")

    def test_material_preview_confirm_passes(self):
        r = self._patch(
            f"/pricing/token/materials/{self.mat.id}",
            {"is_free_preview": True, "confirm": True, "reason": "okay"},
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.mat.refresh_from_db()
        self.assertTrue(self.mat.is_free_preview)


# ============================================================================= distribute
class DistributeTests(_Base):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.staff)

    def test_no_weights_blocks(self):
        r = self._post(
            f"/pricing/token/courses/{self.course.id}/distribute-tokens",
            {"total_tokens": 100, "weights_config": None, "dry_run": True, "reason": "test"},
        )
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"]["code"], "C05_BLOCKED")

    def test_dry_run_no_writes(self):
        before = [lecture.token_price for lecture in Lecture.objects.filter(
            version=self.course.live_version).order_by("id")]  # fmt: skip
        r = self._post(
            f"/pricing/token/courses/{self.course.id}/distribute-tokens",
            {
                "total_tokens": 100,
                "weights_config": {"lecture_types": {"article": 1.0}, "use_duration": False},
                "dry_run": True,
                "reason": "preview",
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertFalse(body["applied"])
        self.assertEqual(sum(a["allocated_price"] for a in body["allocation"]), 100)
        after = [lecture.token_price for lecture in Lecture.objects.filter(
            version=self.course.live_version).order_by("id")]  # fmt: skip
        self.assertEqual(before, after)

    def test_apply_writes_and_audits(self):
        before_audit = self._audit_rows("lecture")
        r = self._post(
            f"/pricing/token/courses/{self.course.id}/distribute-tokens",
            {
                "total_tokens": 120,
                "weights_config": {"lecture_types": {"article": 1.0}},
                "dry_run": False,
                "reason": "apply",
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertTrue(body["applied"])
        self.assertEqual(sum(a["allocated_price"] for a in body["allocation"]), 120)
        total = sum(lecture.token_price or 0 for lecture in Lecture.objects.filter(
            version=self.course.live_version))  # fmt: skip
        self.assertEqual(total, 120)
        after_audit = self._audit_rows("lecture")
        self.assertGreater(after_audit, before_audit)

    def test_ignores_client_allocation(self):
        r = self._post(
            f"/pricing/token/courses/{self.course.id}/distribute-tokens",
            {
                "total_tokens": 80,
                "weights_config": {"lecture_types": {"article": 1.0}},
                "dry_run": True,
                "reason": "test-x",
                "client_allocation": [{"lecture_id": "deadbeef", "price": 9999}],
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(sum(a["allocated_price"] for a in body["allocation"]), 80)


# ============================================================================= bulk
class BulkTests(_Base):
    def test_mixed_results(self):
        self.client.force_login(self.staff)
        bad_id = "00000000-0000-0000-0000-000000000000"
        r = self._post(
            "/pricing/token/courses-bulk",
            {
                "course_ids": [str(self.course.id), bad_id],
                "patch": {"full_course_token_price": 300},
                "reason": "bulk",
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        results = r.json()["results"]
        ok_map = {str(x["course_id"]): x["ok"] for x in results}
        self.assertTrue(ok_map[str(self.course.id)])
        self.assertFalse(ok_map[bad_id])


# ============================================================================= token packs
class TokenPackTests(_Base):
    def test_crud_and_soft_delete(self):
        self.client.force_login(self.staff)
        r = self._post(
            "/pricing/token/packs",
            {
                "name": "Starter",
                "token_amount": 100,
                "price_tier_id": str(self.tier.id),
                "is_active": True,
                "sort_order": 1,
                "reason": "create",
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        pack_id = r.json()["id"]
        r = self._patch(
            f"/pricing/token/packs/{pack_id}",
            {
                "name": "Starter+",
                "token_amount": 150,
                "price_tier_id": str(self.tier.id),
                "is_active": True,
                "sort_order": 2,
                "reason": "update",
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["token_amount"], 150)
        r = self._delete(f"/pricing/token/packs/{pack_id}")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(TokenPack.objects.get(pk=pack_id).is_active)
        self.assertTrue(TokenPack.objects.filter(pk=pack_id).exists())


# ============================================================================= token rate
class TokenRateTests(_Base):
    def test_past_effective_from_rejected(self):
        self.client.force_login(self.staff)
        r = self._post(
            "/pricing/token/rates",
            {
                "tokens_per_gbp_minor": "0.1",
                "effective_from": (timezone.now() - timedelta(hours=1)).isoformat(),
                "notes": "",
                "reason": "xyz",
            },
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["code"], "RATE_EFFECTIVE_FROM_PAST")

    def test_new_rate_closes_prior(self):
        self.client.force_login(self.staff)
        t1 = (timezone.now() + timedelta(days=1)).isoformat()
        t2 = (timezone.now() + timedelta(days=2)).isoformat()
        self.assertEqual(
            self._post(
                "/pricing/token/rates",
                {"tokens_per_gbp_minor": "0.1", "effective_from": t1, "notes": "", "reason": "first"},
            ).status_code,
            200,
        )
        self.assertEqual(
            self._post(
                "/pricing/token/rates",
                {"tokens_per_gbp_minor": "0.2", "effective_from": t2, "notes": "", "reason": "second"},
            ).status_code,
            200,
        )
        self.assertEqual(TokenRate.objects.filter(effective_to__isnull=True).count(), 1)


# ============================================================================= top-up policy
class TopUpTests(_Base):
    def test_separate_currencies_coexist(self):
        self.client.force_login(self.staff)
        r = self._put(
            "/pricing/token/topup-policies/GBP",
            {"min_minor": 100, "max_minor": 10000, "is_active": True, "reason": "gbp"},
        )
        self.assertEqual(r.status_code, 200, r.content)
        r = self._put(
            "/pricing/token/topup-policies/USD",
            {"min_minor": 200, "max_minor": 20000, "is_active": True, "reason": "usd"},
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(TopUpPolicy.objects.filter(is_active=True, currency="GBP").count(), 1)
        self.assertEqual(TopUpPolicy.objects.filter(is_active=True, currency="USD").count(), 1)


# ============================================================================= bonus campaign
class BonusTests(_Base):
    def test_active_blocked(self):
        self.client.force_login(self.staff)
        now = timezone.now()
        r = self._post(
            "/pricing/token/bonus-campaigns",
            {
                "name": "X",
                "condition_type": "first_topup",
                "condition_value": {},
                "bonus_tokens": 10,
                "starts_at": now.isoformat(),
                "ends_at": (now + timedelta(days=30)).isoformat(),
                "is_active": True,
                "reason": "try-x",
            },
        )
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"]["code"], "F02_BLOCKED")

    def test_draft_ok(self):
        self.client.force_login(self.staff)
        now = timezone.now()
        r = self._post(
            "/pricing/token/bonus-campaigns",
            {
                "name": "Draft",
                "condition_type": "first_topup",
                "condition_value": {},
                "bonus_tokens": 10,
                "starts_at": now.isoformat(),
                "ends_at": (now + timedelta(days=30)).isoformat(),
                "is_active": False,
                "reason": "draft",
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(BonusCampaign.objects.count(), 1)


# ============================================================================= audit
class AuditEndpointTests(_Base):
    def test_audit_returns_recent_rows(self):
        self.client.force_login(self.staff)
        self._patch(
            f"/pricing/token/courses/{self.course.id}",
            {"full_course_token_price": 777, "reason": "audit-seed"},
        )
        r = self._get("/pricing/token/audit?entity_type=course")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertGreaterEqual(body["total"], 1)
        self.assertTrue(all(it["target_type"] == "course" for it in body["items"]))
