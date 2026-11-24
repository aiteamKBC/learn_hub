"""PMS app tests: KPI approval workflow, measurement series, review round-trip
(open cycle → review → submit with score snapshot → acknowledge) and AI analysis
(heuristic path, since no Claude key is configured in tests)."""

from __future__ import annotations

from django.utils import timezone

from apps.identity.models import User
from apps.org import services as org_services
from apps.org.models import OrgMember
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


class PmsApiTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff = User.objects.create_user(
            "staff@learnhub.example.com", "x", is_staff=True, full_name="Staff"
        )
        self.owner_user = User.objects.create_user("hr@acme.example.com", "x", full_name="Hana HR")
        self.member_user = User.objects.create_user("sara@acme.example.com", "x", full_name="Sara Staff")
        self.acme = org_services.create_organization(name="Acme", slug="acme-pms", owner=self.owner_user)
        self.H = {"HTTP_X_ORG_ID": str(self.acme.id)}
        with tenant_context(org_id=self.acme.id, user_id=self.owner_user.id):
            self.m_sara = OrgMember.objects.create(
                org=self.acme, user=self.member_user, joined_at=timezone.now()
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
        r = self.client.get(API + "/pms/health")
        self.assertIn(r.status_code, [401, 403])

    # ---------------------------------------------------------------- KPI workflow
    def _make_active_kpi(self, owner_id=None):
        """Drive a proposal through the full approval route to an active KPI; return
        (proposal_json, kpi_id)."""
        self.as_(self.owner_user)
        payload = {"name": "Snag close-out within 5 days", "target": 90, "baseline": 70, "unit": "%"}
        if owner_id:
            payload["owner_id"] = str(owner_id)
        r = self.post("/pms/kpis/proposals", payload)
        self.assertEqual(r.status_code, 200, r.content)
        pid = r.json()["id"]
        self.assertEqual(r.json()["stage"], "draft")

        r = self.post(f"/pms/kpis/proposals/{pid}/submit", {})
        self.assertEqual(r.json()["stage"], "hod_review", r.content)
        r = self.post(f"/pms/kpis/proposals/{pid}/approve", {})
        self.assertEqual(r.json()["stage"], "hr_alignment", r.content)
        r = self.post(f"/pms/kpis/proposals/{pid}/approve", {})
        self.assertEqual(r.json()["stage"], "exec_approval", r.content)
        r = self.post(f"/pms/kpis/proposals/{pid}/approve", {})
        body = r.json()
        self.assertEqual(body["stage"], "active", r.content)
        self.assertIsNotNone(body["active_kpi_id"])
        return body, body["active_kpi_id"]

    def test_kpi_approval_workflow(self):
        body, kpi_id = self._make_active_kpi()
        # the active KPI now appears in the catalogue
        r = self.get("/pms/kpis")
        self.assertIn(kpi_id, {k["id"] for k in r.json()})
        # history records every transition
        r = self.get(f"/pms/kpis/proposals/{body['id']}/history")
        actions = [h["action"] for h in r.json()]
        self.assertIn("draft_created", actions)
        self.assertIn("activated", actions)

    def test_non_admin_cannot_create_proposal(self):
        self.as_(self.member_user)
        r = self.post("/pms/kpis/proposals", {"name": "Nope"})
        self.assertEqual(r.status_code, 403)

    def test_request_changes_bumps_version(self):
        self.as_(self.owner_user)
        r = self.post("/pms/kpis/proposals", {"name": "Needs work", "target": 100})
        pid = r.json()["id"]
        self.post(f"/pms/kpis/proposals/{pid}/submit", {})
        r = self.post(f"/pms/kpis/proposals/{pid}/request-changes", {"comment": "Target unrealistic"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["stage"], "changes_requested")
        self.assertEqual(r.json()["version"], 2)

    def test_measurement_and_attainment(self):
        _, kpi_id = self._make_active_kpi()
        r = self.post(
            f"/pms/kpis/{kpi_id}/measurements",
            {"period_year": 2027, "period_index": 1, "value": 88},
        )
        self.assertEqual(r.status_code, 200, r.content)
        # baseline 70, target 90 → (88-70)/(90-70) = 90%
        r = self.get("/pms/kpis")
        kpi = next(k for k in r.json() if k["id"] == kpi_id)
        self.assertAlmostEqual(kpi["attainment"], 90.0, places=1)
        self.assertEqual(float(kpi["latest_value"]), 88.0)

    def test_individual_kpi_is_linked_and_private(self):
        _, parent_id = self._make_active_kpi()
        response = self.post(
            "/pms/kpis/proposals",
            {
                "name": "Sara's quarterly goal",
                "scope": "individual",
                "parent_kpi_id": parent_id,
                "owner_id": str(self.m_sara.id),
                "target": 95,
            },
        )
        self.assertEqual(response.status_code, 200, response.content)
        proposal_id = response.json()["id"]
        for action in ("submit", "approve", "approve", "approve"):
            response = self.post(f"/pms/kpis/proposals/{proposal_id}/{action}", {})
            self.assertEqual(response.status_code, 200, response.content)
        individual_id = response.json()["active_kpi_id"]

        self.as_(self.member_user)
        response = self.client.get(API + "/pms/kpis?scope=individual", **self.H)
        self.assertEqual([row["id"] for row in response.json()], [individual_id])
        self.assertEqual(response.json()[0]["parent_kpi_id"], parent_id)

        colleague = User.objects.create_user("colleague@acme.example.com", "x")
        with tenant_context(org_id=self.acme.id, user_id=self.owner_user.id):
            OrgMember.objects.create(org=self.acme, user=colleague, joined_at=timezone.now())
        self.as_(colleague)
        self.assertEqual(self.client.get(API + "/pms/kpis?scope=individual", **self.H).json(), [])
        self.assertEqual(self.get(f"/pms/kpis/{individual_id}/measurements").status_code, 404)

    # ---------------------------------------------------------------- reviews
    def _open_cycle(self):
        self.as_(self.owner_user)
        now = timezone.now()
        r = self.post(
            "/pms/review-cycles",
            {
                "name": "Q1 2027 review",
                "year": 2027,
                "quarter": 1,
                "opens_at": now.isoformat(),
                "closes_at": (now + timezone.timedelta(days=30)).isoformat(),
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        cid = r.json()["id"]
        r = self.post(f"/pms/review-cycles/{cid}/open")
        self.assertEqual(r.json()["status"], "open", r.content)
        return cid

    def test_review_round_trip_with_snapshot(self):
        # Give Sara an owned KPI with a measurement so the snapshot has a KPI score.
        _, kpi_id = self._make_active_kpi(owner_id=self.m_sara.id)
        self.post(f"/pms/kpis/{kpi_id}/measurements", {"period_year": 2027, "period_index": 1, "value": 90})

        cid = self._open_cycle()
        r = self.post(
            "/pms/reviews",
            {"cycle_id": cid, "member_id": str(self.m_sara.id), "reviewer_id": str(self.m_sara.id)},
        )
        self.assertEqual(r.status_code, 200, r.content)
        rid = r.json()["id"]

        r = self.post(
            f"/pms/reviews/{rid}/objectives",
            {"title": "Lead two site inspections", "measure": "2 completed", "priority": "high"},
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(r.json()["objectives"]), 1)

        r = self.patch(f"/pms/reviews/{rid}", {"manager_summary": "Solid quarter", "overall_rating": 4})
        self.assertEqual(r.json()["overall_rating"], 4, r.content)

        # submit → snapshots scores
        r = self.post(f"/pms/reviews/{rid}/submit")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body["status"], "submitted")
        self.assertEqual(float(body["kpi_score"]), 100.0)  # value 90 == target 90

        # Sara acknowledges her own review
        self.as_(self.member_user)
        r = self.post(f"/pms/reviews/{rid}/acknowledge")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "acknowledged")

        # Sara sees it in /me/reviews
        r = self.get("/pms/me/reviews")
        self.assertIn(rid, {x["id"] for x in r.json()})

    def test_member_cannot_acknowledge_others_review(self):
        cid = self._open_cycle()
        r = self.post("/pms/reviews", {"cycle_id": cid, "member_id": str(self.m_sara.id)})
        rid = r.json()["id"]
        self.post(f"/pms/reviews/{rid}/submit")
        # owner (not the reviewed member) tries to acknowledge → 403
        r = self.post(f"/pms/reviews/{rid}/acknowledge")
        self.assertEqual(r.status_code, 403, r.content)

    # ---------------------------------------------------------------- analysis
    def test_generate_analysis_heuristic(self):
        _, kpi_id = self._make_active_kpi(owner_id=self.m_sara.id)
        self.post(f"/pms/kpis/{kpi_id}/measurements", {"period_year": 2027, "period_index": 1, "value": 50})
        cid = self._open_cycle()
        r = self.post("/pms/reviews", {"cycle_id": cid, "member_id": str(self.m_sara.id)})
        rid = r.json()["id"]
        self.post(f"/pms/reviews/{rid}/submit")

        r = self.post(f"/pms/reviews/{rid}/analysis")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["model_id"], "heuristic-local-1")
        self.assertTrue(body["summary"])
        self.assertTrue(len(body["suggested_actions"]) >= 1)

        # readable via GET
        r = self.get(f"/pms/reviews/{rid}/analysis")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["review_id"], rid)

    # ---------------------------------------------------------------- contract
    def test_typed_responses_on_all_pms_routes(self):
        from core.api import api

        schema = api.get_openapi_schema()
        paths = [p for p in schema["paths"] if p.startswith("/api/v1/pms/")]
        self.assertTrue(len(paths) >= 18, f"Expected ≥18 pms paths, got {len(paths)}")
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
