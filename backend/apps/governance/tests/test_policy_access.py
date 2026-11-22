"""Regression tests for the employee policy journeys exposed by the new UI."""

from django.utils import timezone

from apps.identity.models import User
from apps.org import services as org_services
from apps.org.models import MemberUnit, OrgMember, OrgUnit
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class PolicyAccessTest(SchemaTransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_user("policy-owner@example.com", "x")
        self.employee = User.objects.create_user("policy-employee@example.com", "x")
        self.colleague = User.objects.create_user("policy-colleague@example.com", "x")
        self.org = org_services.create_organization(
            name="Policy contracts", slug="policy-contracts", owner=self.owner
        )
        self.headers = {"HTTP_X_ORG_ID": str(self.org.id)}
        with tenant_context(org_id=self.org.id, user_id=self.owner.id):
            self.member = OrgMember.objects.create(org=self.org, user=self.employee, joined_at=timezone.now())
            self.other_member = OrgMember.objects.create(
                org=self.org, user=self.colleague, joined_at=timezone.now()
            )

    def get(self, path):
        return self.client.get("/api/v1/governance" + path, **self.headers)

    def write(self, method, path, data=None):
        return getattr(self.client, method)(
            "/api/v1/governance" + path,
            data=data or {},
            content_type="application/json",
            **self.headers,
        )

    def policy(self):
        self.client.force_login(self.owner)
        response = self.write("post", "/policies", {"code": "SAFE-1", "title": "Safe working"})
        self.assertEqual(response.status_code, 200, response.content)
        pid = response.json()["id"]
        response = self.get(f"/policies/{pid}/versions")
        vid = response.json()[0]["id"]
        response = self.write(
            "patch",
            f"/policy-versions/{vid}",
            {
                "summary": "Published safety guidance",
                "sections": [["Procedure", ["Stop and report hazards."]]],
                "understanding_check": {
                    "q": "What should you do?",
                    "options": ["Continue", "Stop and report"],
                    "answer": 1,
                },
            },
        )
        self.assertEqual(response.status_code, 200, response.content)
        response = self.write("post", f"/policy-versions/{vid}/approve")
        self.assertEqual(response.status_code, 200, response.content)
        return pid, vid

    def test_unstarted_policy_has_employee_identity_and_no_adoption(self):
        pid, _ = self.policy()
        self.client.force_login(self.employee)
        response = self.get("/me/policies")
        self.assertEqual(response.status_code, 200, response.content)
        record = next(row for row in response.json() if row["doc_id"] == pid)
        self.assertEqual(record["member_id"], str(self.member.id))
        self.assertEqual(record["adoption_stage"], 0)
        self.assertIsNone(record["ack_at"])

    def test_person_allocation_is_enforced_for_reads_and_acknowledgement(self):
        pid, vid = self.policy()
        response = self.write(
            "put",
            f"/policies/{pid}/allocation",
            {"scope": "depts", "depts": [], "persons": [str(self.member.id)]},
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.client.force_login(self.employee)
        self.assertEqual(self.get(f"/me/policies/{pid}").status_code, 200)
        self.client.force_login(self.colleague)
        response = self.get("/me/policies")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn(pid, {row["doc_id"] for row in response.json()})
        for path in (
            f"/me/policies/{pid}",
            f"/policies/{pid}",
            f"/policies/{pid}/versions",
            f"/policy-versions/{vid}",
        ):
            with self.subTest(path=path):
                response = self.get(path)
                self.assertIn(response.status_code, (403, 404), response.content)
        for action in ("read", "acknowledge", "check"):
            with self.subTest(action=action):
                response = self.write("post", f"/policies/{pid}/{action}", {"answer_index": 1})
                self.assertIn(response.status_code, (403, 404), response.content)

    def test_member_receives_published_content_without_answer_or_draft(self):
        pid, vid = self.policy()
        response = self.write("post", f"/policies/{pid}/versions")
        self.assertEqual(response.status_code, 200, response.content)
        draft_id = response.json()["id"]
        response = self.write("patch", f"/policy-versions/{draft_id}", {"summary": "PRIVATE DRAFT CONTENT"})
        self.assertEqual(response.status_code, 200, response.content)
        self.client.force_login(self.employee)
        for path in (f"/me/policies/{pid}", f"/policies/{pid}/versions", f"/policy-versions/{vid}"):
            with self.subTest(path=path):
                response = self.get(path)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertNotIn(b"PRIVATE DRAFT CONTENT", response.content)
                self.assertNotIn(b'"answer":', response.content)
                self.assertNotIn(b'"answer_index":', response.content)
        self.assertIn(self.get(f"/policy-versions/{draft_id}").status_code, (403, 404))

    def test_department_allocation_matches_unit_name_and_named_people_override(self):
        pid, _ = self.policy()
        with tenant_context(org_id=self.org.id, user_id=self.owner.id):
            root = OrgUnit.objects.get(org=self.org, parent__isnull=True)
            department = org_services.create_unit(parent=root, kind="department", name="Operations")
            MemberUnit.objects.create(org=self.org, member=self.member, unit=department, is_primary=True)
        response = self.write(
            "put", f"/policies/{pid}/allocation", {"scope": "depts", "depts": ["Operations"]}
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.client.force_login(self.employee)
        self.assertEqual(self.get(f"/me/policies/{pid}").status_code, 200)
        self.client.force_login(self.colleague)
        self.assertIn(self.get(f"/me/policies/{pid}").status_code, (403, 404))
        self.client.force_login(self.owner)
        response = self.write(
            "put",
            f"/policies/{pid}/allocation",
            {"scope": "depts", "depts": ["Operations"], "persons": [str(self.other_member.id)]},
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.client.force_login(self.colleague)
        self.assertEqual(self.get(f"/me/policies/{pid}").status_code, 200)

    def test_reading_revised_policy_does_not_reuse_previous_acknowledgement_or_check(self):
        pid, _ = self.policy()
        self.write("put", f"/policies/{pid}/allocation", {"scope": "org", "require_reack": True})
        self.client.force_login(self.employee)
        self.assertEqual(self.write("post", f"/policies/{pid}/acknowledge").status_code, 200)
        response = self.write("post", f"/policies/{pid}/check", {"answer_index": 1})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["adoption_stage"], 2)
        self.client.force_login(self.owner)
        response = self.write("post", f"/policies/{pid}/versions")
        vid = response.json()["id"]
        response = self.write("post", f"/policy-versions/{vid}/approve")
        self.assertEqual(response.status_code, 200, response.content)
        self.client.force_login(self.employee)
        self.assertEqual(self.write("post", f"/policies/{pid}/read").status_code, 200)
        response = self.get("/me/policies")
        record = next(row for row in response.json() if row["doc_id"] == pid)
        self.assertEqual(record["adoption_stage"], 0)
        self.assertEqual(self.write("post", f"/policies/{pid}/acknowledge").status_code, 200)
        response = self.get("/me/policies")
        record = next(row for row in response.json() if row["doc_id"] == pid)
        self.assertEqual(record["adoption_stage"], 1)
        self.assertIsNone(record["check_at"])
        self.assertIsNone(record["check_score"])

    def test_question_bank_answers_are_only_available_to_admins(self):
        self.client.force_login(self.owner)
        response = self.write(
            "post",
            "/questions",
            {
                "q_type": "mcq",
                "prompt": "How do you stay safe?",
                "options": ["Ignore", "Report"],
                "answer_index": 1,
            },
        )
        self.assertEqual(response.status_code, 200, response.content)
        qid = response.json()["id"]
        self.client.force_login(self.employee)
        for path in ("/questions", f"/questions/{qid}"):
            with self.subTest(path=path):
                self.assertEqual(self.get(path).status_code, 403)
