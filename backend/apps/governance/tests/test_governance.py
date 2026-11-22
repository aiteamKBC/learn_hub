"""Governance tests: strategy versioning + approval, policy authoring/approval,
member adoption (acknowledge + check → adoption stage), and the question bank."""

from __future__ import annotations

from django.utils import timezone

from apps.identity.models import User
from apps.org import services as org_services
from apps.org.models import OrgMember
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


class GovernanceApiTest(SchemaTransactionTestCase):
    def setUp(self):
        self.owner_user = User.objects.create_user("hr@acme.example.com", "x", full_name="Hana HR")
        self.member_user = User.objects.create_user("sara@acme.example.com", "x", full_name="Sara Staff")
        self.acme = org_services.create_organization(name="Acme", slug="acme-gov", owner=self.owner_user)
        self.H = {"HTTP_X_ORG_ID": str(self.acme.id)}
        with tenant_context(org_id=self.acme.id, user_id=self.owner_user.id):
            self.m_sara = OrgMember.objects.create(
                org=self.acme, user=self.member_user, joined_at=timezone.now()
            )

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

    def put(self, path, data, **kw):
        return self.client.put(API + path, data=data, content_type="application/json", **{**self.H, **kw})

    # ---------------------------------------------------------------- health
    def test_health_requires_org(self):
        self.as_(self.owner_user)
        r = self.client.get(API + "/governance/health")
        self.assertIn(r.status_code, [401, 403])

    # ---------------------------------------------------------------- strategy
    def test_strategy_versioning_and_approval(self):
        self.as_(self.owner_user)
        r = self.post("/governance/strategies", {"name": "Company strategy"})
        self.assertEqual(r.status_code, 200, r.content)
        sid = r.json()["id"]

        r = self.get(f"/governance/strategies/{sid}/versions")
        vid = r.json()[0]["id"]
        self.assertEqual(r.json()[0]["status"], "draft")

        r = self.patch(
            f"/governance/strategy-versions/{vid}",
            {"vision": "Right first time", "values": ["Trust", "Quality"]},
        )
        self.assertEqual(r.json()["vision"], "Right first time", r.content)

        r = self.post(
            f"/governance/strategy-versions/{vid}/objectives",
            {"code": "SO1", "title": "Safe delivery", "priority": "high", "measure": "pass rate >= 96%"},
        )
        self.assertEqual(len(r.json()["objectives"]), 1, r.content)

        r = self.post(f"/governance/strategy-versions/{vid}/approve")
        self.assertEqual(r.json()["status"], "approved", r.content)

        # editing an approved version is refused
        r = self.patch(f"/governance/strategy-versions/{vid}", {"vision": "late"})
        self.assertEqual(r.status_code, 409)

    def test_non_admin_cannot_create_strategy(self):
        self.as_(self.member_user)
        r = self.post("/governance/strategies", {"name": "Nope"})
        self.assertEqual(r.status_code, 403)

    # ---------------------------------------------------------------- policies
    def _approved_policy_with_check(self):
        """Create + approve a policy whose current version has an understanding check
        with correct answer index 1. Return the policy id."""
        self.as_(self.owner_user)
        r = self.post(
            "/governance/policies",
            {"code": "POL-01", "title": "Site Safety", "doc_type": "policy", "category": "H&S"},
        )
        pid = r.json()["id"]
        r = self.get(f"/governance/policies/{pid}/versions")
        vid = r.json()[0]["id"]
        self.patch(
            f"/governance/policy-versions/{vid}",
            {
                "summary": "Induction and RAMS.",
                "sections": [["Purpose", ["Stay safe."]]],
                "understanding_check": {
                    "q": "Asbestos?",
                    "options": ["Carry on", "Stop and report"],
                    "answer": 1,
                },
            },
        )
        r = self.post(f"/governance/policy-versions/{vid}/approve")
        self.assertEqual(r.json()["status"], "approved", r.content)
        return pid

    def test_policy_authoring_and_approval(self):
        pid = self._approved_policy_with_check()
        r = self.get(f"/governance/policies/{pid}")
        self.assertEqual(r.json()["status"], "approved")
        self.assertEqual(r.json()["current_version"], 1)

        # set allocation to the whole org
        r = self.put(f"/governance/policies/{pid}/allocation", {"scope": "org", "require_reack": True})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["published_version"], 1)

    def test_member_adoption_flow(self):
        pid = self._approved_policy_with_check()

        # Sara reads, acknowledges, then passes the check → adoption stage 2 (Understands)
        self.as_(self.member_user)
        self.assertEqual(self.post(f"/governance/policies/{pid}/read").status_code, 200)
        self.assertEqual(self.post(f"/governance/policies/{pid}/acknowledge").status_code, 200)
        r = self.post(f"/governance/policies/{pid}/check", {"answer_index": 1})
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body["check_score"], 100)
        self.assertEqual(body["adoption_stage"], 2)
        self.assertEqual(body["adoption_label"], "Understands")

        # appears in /me/policies
        r = self.get("/governance/me/policies")
        mine = {p["doc_id"]: p for p in r.json()}
        self.assertEqual(mine[pid]["adoption_stage"], 2)

        # admin adds an observation → stage 3 (Applies)
        self.as_(self.owner_user)
        r = self.post(
            f"/governance/policies/{pid}/observations",
            {"member_id": str(self.m_sara.id), "note": "Observed following the procedure on site"},
        )
        self.assertEqual(r.status_code, 200, r.content)
        r = self.get(f"/governance/policies/{pid}/records")
        rec = next(x for x in r.json() if x["member_id"] == str(self.m_sara.id))
        self.assertEqual(rec["adoption_stage"], 3)

    def test_wrong_check_answer_scores_zero(self):
        pid = self._approved_policy_with_check()
        self.as_(self.member_user)
        self.post(f"/governance/policies/{pid}/acknowledge")
        r = self.post(f"/governance/policies/{pid}/check", {"answer_index": 0})
        self.assertEqual(r.json()["check_score"], 0, r.content)
        self.assertEqual(r.json()["adoption_stage"], 1)  # Aware only

    # ---------------------------------------------------------------- question bank
    def test_question_bank_crud(self):
        self.as_(self.owner_user)
        r = self.post(
            "/governance/questions",
            {
                "dept": "decor",
                "q_type": "mcq",
                "prompt": "Before the first coat, what does the SOP require?",
                "options": ["Apply immediately", "Prep and photograph"],
                "answer_index": 1,
                "level": 2,
            },
        )
        self.assertEqual(r.status_code, 200, r.content)
        qid = r.json()["id"]

        r = self.patch(f"/governance/questions/{qid}", {"level": 3})
        self.assertEqual(r.json()["level"], 3, r.content)

        r = self.get("/governance/questions")
        self.assertIn(qid, {q["id"] for q in r.json()})

        r = self.post(f"/governance/questions/{qid}/archive")
        self.assertTrue(r.json()["archived"])
        # archived hidden by default
        r = self.get("/governance/questions")
        self.assertNotIn(qid, {q["id"] for q in r.json()})

    def test_non_admin_cannot_create_question(self):
        self.as_(self.member_user)
        r = self.post("/governance/questions", {"prompt": "Nope?", "q_type": "mcq"})
        self.assertEqual(r.status_code, 403)

    # ---------------------------------------------------------------- contract
    def test_typed_responses_on_all_governance_routes(self):
        from core.api import api

        schema = api.get_openapi_schema()
        paths = [p for p in schema["paths"] if p.startswith("/api/v1/governance/")]
        self.assertTrue(len(paths) >= 18, f"Expected ≥18 governance paths, got {len(paths)}")
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
