"""Frameworks app tests: competency hybrid, role approval workflow, competence
scoring smoke, and a maturity campaign round-trip.

Platform reference rows (owner_org NULL) are normally loaded by migration 0003, but
the test harness truncates the `frameworks` schema between tests, so each test seeds
the platform rows it needs through the owner connection (which bypasses RLS, exactly
as the migration does)."""

from __future__ import annotations

from django.utils import timezone

from apps.catalog import services as cat
from apps.frameworks import scoring, services
from apps.frameworks.models import (
    Competency,
    MaturityCriterion,
    MaturityDimension,
    MaturityFramework,
    MaturityVersion,
)
from apps.identity.models import User
from apps.learning.models import Enrollment
from apps.org import services as org_services
from apps.org.models import JobRole, OrgMember
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


class FrameworksApiTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff = User.objects.create_user(
            "staff@learnhub.example.com", "x", is_staff=True, full_name="Staff"
        )
        self.owner_user = User.objects.create_user("hr@acme.example.com", "x", full_name="Hana HR")
        self.member_user = User.objects.create_user("sara@acme.example.com", "x", full_name="Sara Staff")
        self.acme = org_services.create_organization(name="Acme", slug="acme-fw", owner=self.owner_user)
        self.H = {"HTTP_X_ORG_ID": str(self.acme.id)}
        with tenant_context(org_id=self.acme.id, user_id=self.owner_user.id):
            self.m_sara = OrgMember.objects.create(
                org=self.acme, user=self.member_user, joined_at=timezone.now()
            )
            self.job_role = JobRole.objects.create(org=self.acme, name="Supervisor")

        # Seed two platform competencies (owner_org NULL) as platform staff. Staying on
        # the default connection keeps one consistent snapshot for the whole test and
        # lets the harness truncate cleanly between tests.
        with tenant_context(staff=True, user_id=self.staff.id):
            self.plat_skill = Competency.objects.create(
                owner_org=None, code="C1", name="Surface preparation", kind="S", sort_order=0
            )
            self.plat_know = Competency.objects.create(
                owner_org=None, code="C2", name="Safeguarding", kind="K", sort_order=1
            )

    # ---------------------------------------------------------------- helpers
    def as_(self, user):
        self.client.force_login(user)

    def get(self, path, **kw):
        return self.client.get(API + path, **{**self.H, **kw})

    def post(self, path, data=None, **kw):
        return self.client.post(
            API + path, data=data or {}, content_type="application/json", **{**self.H, **kw}
        )

    def patch(self, path, data, **kw):
        return self.client.patch(API + path, data=data, content_type="application/json", **{**self.H, **kw})

    # ---------------------------------------------------------------- health
    def test_health_requires_org(self):
        self.as_(self.owner_user)
        r = self.client.get(API + "/frameworks/health")  # no X-Org-Id
        self.assertIn(r.status_code, [401, 403])

    # ---------------------------------------------------------------- competencies
    def test_competency_hybrid_catalogue(self):
        self.as_(self.owner_user)
        r = self.get("/frameworks/competencies")
        self.assertEqual(r.status_code, 200, r.content)
        rows = r.json()
        codes = {c["code"]: c for c in rows}
        self.assertIn("C1", codes)
        self.assertTrue(codes["C1"]["is_platform"])
        self.assertIsNone(codes["C1"]["owner_org_id"])

    def test_create_org_competency(self):
        self.as_(self.owner_user)
        r = self.post("/frameworks/competencies", {"code": "LOCAL1", "name": "Local skill", "kind": "S"})
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertFalse(body["is_platform"])
        self.assertEqual(body["owner_org_id"], str(self.acme.id))

    def test_non_admin_cannot_create_competency(self):
        self.as_(self.member_user)
        r = self.post("/frameworks/competencies", {"code": "X", "name": "Nope", "kind": "S"})
        self.assertEqual(r.status_code, 403)

    def test_clone_platform_competency(self):
        self.as_(self.owner_user)
        r = self.post(f"/frameworks/competencies/{self.plat_skill.id}/clone")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertFalse(body["is_platform"])
        self.assertEqual(body["cloned_from_id"], str(self.plat_skill.id))
        self.assertEqual(body["code"], "C1")

    def test_platform_competency_is_readonly(self):
        self.as_(self.owner_user)
        r = self.patch(f"/frameworks/competencies/{self.plat_skill.id}", {"name": "Hacked"})
        self.assertEqual(r.status_code, 403)

    # ---- platform admin (staff) manages the shared library via the elevated view ----
    STAFF_H = {"HTTP_X_PLATFORM_ORG_ACCESS": "on"}

    def test_staff_creates_platform_competency(self):
        self.as_(self.staff)
        r = self.post(
            "/frameworks/competencies",
            {"code": "GLOBAL1", "name": "Public speaking", "kind": "S"},
            **self.STAFF_H,
        )
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertTrue(body["is_platform"])
        self.assertIsNone(body["owner_org_id"])

    def test_staff_edits_platform_competency(self):
        self.as_(self.staff)
        r = self.patch(
            f"/frameworks/competencies/{self.plat_skill.id}",
            {"name": "Surface prep (revised)"},
            **self.STAFF_H,
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["name"], "Surface prep (revised)")

    # ---------------------------------------------------------------- role workflow
    def _draft_version_id(self) -> str:
        """Create a role framework and return its editable draft version id."""
        self.as_(self.owner_user)
        r = self.post(
            "/frameworks/roles",
            {"job_role_id": str(self.job_role.id), "title": "Site Supervisor", "level": 2},
        )
        self.assertEqual(r.status_code, 200, r.content)
        fw_id = r.json()["id"]
        r = self.post(f"/frameworks/roles/{fw_id}/versions")  # returns the open draft (v1)
        self.assertEqual(r.status_code, 200, r.content)
        v = r.json()
        self.assertEqual(v["number"], 1)
        self.assertEqual(v["status"], "draft")
        return v["id"]

    def test_role_approval_workflow(self):
        version_id = self._draft_version_id()
        # cannot submit an empty version
        r = self.post(f"/frameworks/versions/{version_id}/submit", {})
        self.assertEqual(r.status_code, 400, r.content)
        # add a requirement
        r = self.post(
            f"/frameworks/versions/{version_id}/requirements",
            {
                "kind": "skill",
                "text": "Prepare surfaces to spec",
                "competency_id": str(self.plat_skill.id),
                "level": 3,
                "priority": "essential",
                "weight": 8,
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(r.json()["requirements"]), 1)
        # submit → approve
        r = self.post(f"/frameworks/versions/{version_id}/submit", {"comment": "ready"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "submitted")
        r = self.post(f"/frameworks/versions/{version_id}/approve", {"comment": "ok"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "approved")
        # history records both transitions
        fw_id = r.json()["framework_id"]
        r = self.get(f"/frameworks/roles/{fw_id}/history")
        actions = {h["action"] for h in r.json()}
        self.assertEqual(actions, {"submitted", "approved"})

    def test_cannot_edit_approved_version(self):
        version_id = self._draft_version_id()
        r = self.post(
            f"/frameworks/versions/{version_id}/requirements",
            {"kind": "skill", "text": "Prep surfaces", "competency_id": str(self.plat_skill.id),
             "level": 2, "priority": "important"},
        )  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        r = self.post(f"/frameworks/versions/{version_id}/submit", {})
        self.assertEqual(r.status_code, 200, r.content)
        r = self.post(f"/frameworks/versions/{version_id}/approve", {})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "approved")
        r = self.patch(f"/frameworks/versions/{version_id}", {"job_description": "late edit"})
        self.assertEqual(r.status_code, 409, r.content)

    # ---------------------------------------------------------------- scoring smoke
    def _complete_tagged_course(self, competency, target_level=4):
        """Give Sara a completed course tagged with `competency` at `target_level`."""
        with tenant_context(user_id=self.owner_user.id, org_id=self.acme.id):
            course = cat.create_course(
                title="Prep 101",
                slug="prep-101",
                ownership="organization",
                created_by=self.owner_user,
                owner_org_id=self.acme.id,
                subtitle="x",
            )
            services.tag_course(
                org_id=self.acme.id, course_id=course.id, competency=competency, target_level=target_level
            )
        with tenant_context(org_id=self.acme.id, user_id=self.member_user.id):
            Enrollment.objects.create(
                org=self.acme,
                user=self.member_user,
                course=course,
                source=Enrollment.Source.ORGANIZATION,
                status=Enrollment.Status.COMPLETED,
                enrolled_at=timezone.now(),
                completed_at=timezone.now(),
                progress_pct=100,
            )
        return course

    def test_evidenced_and_readiness(self):
        self._complete_tagged_course(self.plat_skill, target_level=4)
        with tenant_context(org_id=self.acme.id, user_id=self.member_user.id):
            levels = scoring.evidenced_levels(org_id=self.acme.id, user_id=self.member_user.id)
        self.assertEqual(levels.get(str(self.plat_skill.id)), 4)

        # A role version requiring that competency at level 3 → fully evidenced.
        with tenant_context(org_id=self.acme.id, user_id=self.owner_user.id):
            fw, version = services.create_role_framework(
                org_id=self.acme.id, job_role_id=self.job_role.id, title="Sup", level=2
            )
            services.add_requirement(
                org_id=self.acme.id,
                version=version,
                data={
                    "kind": "skill",
                    "text": "Prep",
                    "competency_id": self.plat_skill.id,
                    "level": 3,
                    "priority": "essential",
                    "weight": 5,
                },
            )
            r = scoring.readiness(org_id=self.acme.id, member=self.m_sara, version=version)
        self.assertEqual(r["competence_score"], 100.0)
        self.assertTrue(r["qualifications_met"])
        self.assertTrue(r["ready"])
        self.assertEqual(r["gaps"], [])

    def test_readiness_endpoint_shows_gap(self):
        # No evidence: requirement at level 4 is a gap, score 0.
        with tenant_context(org_id=self.acme.id, user_id=self.owner_user.id):
            fw, version = services.create_role_framework(
                org_id=self.acme.id, job_role_id=self.job_role.id, title="Sup", level=2
            )
            services.add_requirement(
                org_id=self.acme.id,
                version=version,
                data={
                    "kind": "skill",
                    "text": "Prep",
                    "competency_id": self.plat_skill.id,
                    "level": 4,
                    "priority": "essential",
                    "weight": 5,
                },
            )
            version_id = version.id
        self.as_(self.member_user)
        r = self.get(f"/frameworks/versions/{version_id}/readiness")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body["competence_score"], 0.0)
        self.assertFalse(body["ready"])
        self.assertEqual(len(body["gaps"]), 1)

    # ---------------------------------------------------------------- maturity
    def _seed_maturity(self):
        with tenant_context(staff=True, user_id=self.staff.id):
            fw = MaturityFramework.objects.create(
                owner_org=None, code="MF-ops", kind="maturity", dept="Operations", title="Ops maturity"
            )
            version = MaturityVersion.objects.create(
                owner_org=None, framework=fw, number=1, status="published"
            )
            dim = MaturityDimension.objects.create(
                owner_org=None, version=version, name="Quality", target_level=4, weight=50, sort_order=0
            )
            c1 = MaturityCriterion.objects.create(
                owner_org=None, dimension=dim, practice="Prep", question="Evidenced?", weight=50, sort_order=0
            )
            c2 = MaturityCriterion.objects.create(
                owner_org=None,
                dimension=dim,
                practice="Close-out",
                question="Verified?",
                weight=50,
                sort_order=1,
            )
        return version, [c1, c2]

    def test_maturity_campaign_round_trip(self):
        version, crits = self._seed_maturity()
        self.as_(self.owner_user)
        # list frameworks shows the platform template
        r = self.get("/frameworks/maturity/frameworks")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIn("MF-ops", {f["code"] for f in r.json()})

        now = timezone.now()
        r = self.post(
            "/frameworks/maturity/campaigns",
            {
                "framework_version_id": str(version.id),
                "dept": "Operations",
                "quarter_year": 2026,
                "quarter": 4,
                "starts_at": now.isoformat(),
                "ends_at": (now + timezone.timedelta(days=14)).isoformat(),
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        campaign_id = r.json()["id"]

        # Sara responds
        self.as_(self.member_user)
        r = self.post(
            f"/frameworks/maturity/campaigns/{campaign_id}/responses",
            {"answers": {str(crits[0].id): 4, str(crits[1].id): 2}, "reflections": {"note": "ok"}},
        )
        self.assertEqual(r.status_code, 200, r.content)

        # Admin closes → scores snapshot
        self.as_(self.owner_user)
        r = self.post(f"/frameworks/maturity/campaigns/{campaign_id}/close")
        self.assertEqual(r.status_code, 200, r.content)
        scores = r.json()["scores"]
        self.assertEqual(scores["n"], 1)
        self.assertEqual(scores["by_criterion"][str(crits[0].id)], 4.0)
        self.assertIsNotNone(scores["overall"])

        # closing again is rejected
        r = self.post(f"/frameworks/maturity/campaigns/{campaign_id}/close")
        self.assertEqual(r.status_code, 409)

    def test_typed_responses_on_all_framework_routes(self):
        from core.api import api

        schema = api.get_openapi_schema()
        paths = [p for p in schema["paths"] if p.startswith("/api/v1/frameworks/")]
        self.assertTrue(len(paths) >= 15, f"Expected ≥15 framework paths, got {len(paths)}")
        for path in paths:
            for method, op in schema["paths"][path].items():
                ok = (
                    op.get("responses", {})
                    .get(200, {})
                    .get("content", {})
                    .get("application/json", {})
                    .get("schema")
                )
                self.assertIsNotNone(ok, f"{method.upper()} {path} has no typed response")
