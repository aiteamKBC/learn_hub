"""Contracts needed to choose role versions and render real maturity surveys."""

from django.utils import timezone

from apps.frameworks.models import MaturityCriterion, MaturityDimension, MaturityFramework, MaturityVersion
from apps.identity.models import User
from apps.org import services as org_services
from apps.org.models import JobRole, OrgMember
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class FrameworkUiContractTest(SchemaTransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_user("framework-owner@example.com", "x")
        self.employee = User.objects.create_user("framework-employee@example.com", "x")
        self.org = org_services.create_organization(
            name="Framework contracts", slug="framework-contracts", owner=self.owner
        )
        self.headers = {"HTTP_X_ORG_ID": str(self.org.id)}
        with tenant_context(org_id=self.org.id, user_id=self.owner.id):
            self.member = OrgMember.objects.create(org=self.org, user=self.employee, joined_at=timezone.now())
            self.job = JobRole.objects.create(org=self.org, name="Supervisor")
            self.framework = MaturityFramework.objects.create(
                owner_org=self.org,
                code="QUALITY",
                kind="maturity",
                dept="Operations",
                title="Quality maturity",
            )
            self.version = MaturityVersion.objects.create(
                owner_org=self.org, framework=self.framework, number=1, status="published"
            )
            dimension = MaturityDimension.objects.create(
                owner_org=self.org, version=self.version, name="Evidence", target_level=4, weight=50
            )
            self.criterion = MaturityCriterion.objects.create(
                owner_org=self.org,
                dimension=dimension,
                practice="Inspection",
                question="How consistently is work inspected?",
                anchors=["Never", "Rarely", "Sometimes", "Usually", "Always"],
                weight=50,
            )

    def get(self, path):
        return self.client.get("/api/v1/frameworks" + path, **self.headers)

    def test_maturity_list_exposes_published_version_and_employee_can_read_real_questions(self):
        self.client.force_login(self.employee)
        response = self.get("/maturity/frameworks")
        self.assertEqual(response.status_code, 200, response.content)
        framework = next(row for row in response.json() if row["id"] == str(self.framework.id))
        self.assertEqual(framework["published_version_id"], str(self.version.id))
        response = self.get(f"/maturity/versions/{self.version.id}")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["framework_id"], str(self.framework.id))
        criterion = body["dimensions"][0]["criteria"][0]
        self.assertEqual(criterion["id"], str(self.criterion.id))
        self.assertEqual(criterion["question"], "How consistently is work inspected?")
        self.assertEqual(criterion["anchors"], ["Never", "Rarely", "Sometimes", "Usually", "Always"])

    def test_maturity_version_from_another_company_is_not_readable(self):
        another = org_services.create_organization(
            name="Other company", slug="other-contracts", owner=self.owner
        )
        with tenant_context(org_id=another.id, user_id=self.owner.id):
            framework = MaturityFramework.objects.create(
                owner_org=another, code="PRIVATE", kind="maturity", dept="Other", title="Private framework"
            )
            version = MaturityVersion.objects.create(
                owner_org=another, framework=framework, number=1, status="published"
            )
        self.client.force_login(self.employee)
        self.assertEqual(self.get(f"/maturity/versions/{version.id}").status_code, 404)

    def test_role_list_exposes_the_uuid_needed_to_open_the_latest_version(self):
        self.client.force_login(self.owner)
        response = self.client.post(
            "/api/v1/frameworks/roles",
            data={"job_role_id": str(self.job.id), "title": "Site supervisor", "level": 2},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(response.status_code, 200, response.content)
        role = response.json()
        self.assertTrue(role["latest_version_id"])
        self.client.force_login(self.employee)
        response = self.get("/roles")
        self.assertEqual(response.status_code, 200, response.content)
        listed = next(row for row in response.json() if row["id"] == role["id"])
        self.assertEqual(listed["latest_version_id"], role["latest_version_id"])
        self.assertEqual(self.get(f"/versions/{listed['latest_version_id']}").status_code, 200)
