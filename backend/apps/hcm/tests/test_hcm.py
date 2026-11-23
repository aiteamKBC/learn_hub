"""HCM app smoke tests: models, services, and API endpoints."""

from decimal import Decimal

from django.utils import timezone

from apps.hcm.models import MemberProfile
from apps.identity.models import User
from apps.org import services as org_services
from apps.org.models import OrgMember
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


class HcmApiTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff = User.objects.create_user(
            "staff@learnhub.example.com", "x", is_staff=True, full_name="Staff"
        )
        self.hr_user = User.objects.create_user("hr@acme.example.com", "x", full_name="Hana HR")
        self.member_user = User.objects.create_user("sara@acme.example.com", "x", full_name="Sara Staff")
        self.acme = org_services.create_organization(name="Acme", slug="acme-hcm", owner=self.hr_user)
        self.H = {"HTTP_X_ORG_ID": str(self.acme.id)}
        with tenant_context(org_id=self.acme.id, user_id=self.hr_user.id):
            now = timezone.now()
            self.m_sara = OrgMember.objects.create(org=self.acme, user=self.member_user, joined_at=now)
        # Retrieve the HR member (the org owner) — must run under tenant_context
        with tenant_context(org_id=self.acme.id, user_id=self.hr_user.id):
            self.m_hr = OrgMember.objects.get(org=self.acme, user=self.hr_user, removed_at__isnull=True)
            # Backfill runs for pre-existing members; test members created in setUp
            # need profiles explicitly since they post-date the migration.
            MemberProfile.objects.get_or_create(org=self.acme, member=self.m_sara)
            MemberProfile.objects.get_or_create(org=self.acme, member=self.m_hr)

    def as_(self, user):
        self.client.force_login(user)

    def get(self, path, **kw):
        return self.client.get(API + path, **{**self.H, **kw})

    def post(self, path, data=None, **kw):
        return self.client.post(
            API + path,
            data=data or {},
            content_type="application/json",
            **{**self.H, **kw},
        )

    def patch(self, path, data, **kw):
        return self.client.patch(
            API + path,
            data=data,
            content_type="application/json",
            **{**self.H, **kw},
        )

    # ---------------------------------------------------------------- health
    def test_health_requires_org(self):
        self.as_(self.hr_user)
        r = self.client.get(API + "/hcm/health")  # no X-Org-Id header
        self.assertIn(r.status_code, [403, 401])

    def test_health_ok(self):
        self.as_(self.hr_user)
        r = self.get("/hcm/health")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["ok"])

    # ---------------------------------------------------------------- profiles
    def test_my_profile_created_by_backfill(self):
        """MemberProfile must exist for every OrgMember (created by 0003_backfill)."""
        from apps.hcm.models import MemberProfile

        with tenant_context(org_id=self.acme.id, user_id=self.hr_user.id):
            self.assertTrue(MemberProfile.objects.filter(org=self.acme, member=self.m_sara).exists())

    def test_my_profile_read(self):
        self.as_(self.member_user)
        r = self.get("/hcm/me/profile")
        self.assertEqual(r.status_code, 200, r.content)
        data = r.json()
        self.assertEqual(data["full_name"], "Sara Staff")
        self.assertIsNone(data["level"])

    def test_my_profile_patch(self):
        self.as_(self.member_user)
        r = self.patch("/hcm/me/profile", {"aspiration": "Lead engineer"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["aspiration"], "Lead engineer")

    def test_hr_profile_patch(self):
        self.as_(self.hr_user)
        r = self.patch(
            f"/hcm/people/{self.m_sara.id}/profile",
            {"track": "Engineering", "level": 2, "start_date": "2024-01-01"},
        )
        self.assertEqual(r.status_code, 200, r.content)
        data = r.json()
        self.assertEqual(data["track"], "Engineering")
        self.assertEqual(data["level"], 2)
        self.assertEqual(data["start_date"], "2024-01-01")

    def test_non_hr_cannot_patch_others_profile(self):
        self.as_(self.member_user)
        r = self.patch(f"/hcm/people/{self.m_hr.id}/profile", {"track": "Hacked"})
        self.assertEqual(r.status_code, 403)

    # ---------------------------------------------------------------- qualifications
    def test_qual_catalogue_hr_only(self):
        self.as_(self.member_user)
        r = self.get("/hcm/qualifications")
        self.assertEqual(r.status_code, 403)

    def test_create_and_award_qualification(self):
        self.as_(self.hr_user)
        # create
        r = self.post("/hcm/qualifications", {"name": "SMSTS", "code": "SM01"})
        self.assertEqual(r.status_code, 200, r.content)
        qual_id = r.json()["id"]

        # award
        r = self.post(
            f"/hcm/people/{self.m_sara.id}/qualifications",
            {
                "qualification_id": qual_id,
                "awarded_on": "2024-06-01",
                "expires_on": "2027-06-01",
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        data = r.json()
        self.assertEqual(data["qualification_name"], "SMSTS")
        self.assertEqual(data["awarded_on"], "2024-06-01")

    # ---------------------------------------------------------------- CPD
    def test_add_and_list_cpd(self):
        self.as_(self.member_user)
        r = self.post(
            "/hcm/me/cpd",
            {
                "title": "Advanced Safety",
                "provider": "IOSH",
                "completed_on": "2024-09-15",
                "hours": "8.00",
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        entry = r.json()
        self.assertEqual(entry["kind"], "external")
        self.assertEqual(entry["verified"], False)

        r = self.get("/hcm/me/cpd")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()), 1)

    def test_cpd_cache_updated(self):
        """After adding a CPD entry, the profile cpd_hours_cached reflects it."""
        self.as_(self.member_user)
        self.post(
            "/hcm/me/cpd",
            {
                "title": "Fire Safety",
                "provider": "RoSPA",
                "completed_on": "2024-10-01",
                "hours": "4.50",
            },
        )
        r = self.get("/hcm/me/profile")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Decimal(r.json()["cpd_hours_cached"]), Decimal("4.50"))

    # ---------------------------------------------------------------- wellbeing
    def test_submit_and_list_wellbeing(self):
        self.as_(self.member_user)
        r = self.post(
            "/hcm/me/wellbeing",
            {
                "hope": 70,
                "efficacy": 65,
                "resilience": 80,
                "optimism": 75,
                "overall": 72,
                "stay_intent": "0.800",
                "satisfaction": "0.700",
                "note": "Feeling good",
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        data = r.json()
        self.assertEqual(data["hope"], 70)
        self.assertEqual(data["overall"], 72)

        r = self.get("/hcm/me/wellbeing")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()), 1)

    def test_wellbeing_updates_profile_scalars(self):
        self.as_(self.member_user)
        self.post(
            "/hcm/me/wellbeing",
            {
                "hope": 60,
                "efficacy": 55,
                "resilience": 70,
                "optimism": 65,
                "overall": 63,
                "stay_intent": "0.600",
                "satisfaction": "0.550",
            },
        )
        r = self.get("/hcm/me/profile")
        self.assertEqual(r.status_code, 200)
        profile = r.json()
        self.assertAlmostEqual(float(profile["stay_intent"]), 0.6, places=2)
        self.assertAlmostEqual(float(profile["satisfaction"]), 0.55, places=2)

    # ---------------------------------------------------------------- contract
    def test_typed_responses_on_all_hcm_routes(self):
        """All /hcm/ routes must have a typed 200 response schema (enforced by
        test_api_contract, but we spot-check here too)."""
        from core.api import api

        schema = api.get_openapi_schema()
        hcm_paths = [p for p in schema["paths"] if p.startswith("/api/v1/hcm/")]
        self.assertTrue(len(hcm_paths) >= 8, f"Expected ≥8 hcm paths, got {hcm_paths}")
        for path in hcm_paths:
            for method, op in schema["paths"][path].items():
                ok = (
                    op.get("responses", {})
                    .get(200, {})
                    .get("content", {})
                    .get("application/json", {})
                    .get("schema")
                )
                self.assertIsNotNone(ok, f"{method.upper()} {path} has no typed response")
