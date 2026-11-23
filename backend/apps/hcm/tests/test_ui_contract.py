"""New company members can use HR self service without rerunning a backfill."""

from django.utils import timezone

from apps.identity.models import User
from apps.org import services as org_services
from apps.org.models import OrgMember
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class HcmUiContractTest(SchemaTransactionTestCase):
    def test_new_member_can_open_profile_and_record_wellbeing_and_cpd(self):
        owner = User.objects.create_user("hr-owner-new@example.com", "x")
        employee = User.objects.create_user("hr-employee-new@example.com", "x")
        org = org_services.create_organization(name="New HR members", slug="new-hr-members", owner=owner)
        with tenant_context(org_id=org.id, user_id=owner.id):
            member = OrgMember.objects.create(org=org, user=employee, joined_at=timezone.now())
        headers = {"HTTP_X_ORG_ID": str(org.id)}
        self.client.force_login(employee)
        response = self.client.get("/api/v1/hcm/me/profile", **headers)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["member_id"], str(member.id))
        self.assertEqual(response.json()["aspiration"], "")
        response = self.client.post(
            "/api/v1/hcm/me/wellbeing",
            data={
                "hope": 75,
                "efficacy": 75,
                "resilience": 50,
                "optimism": 50,
                "overall": 75,
                "stay_intent": "0.75",
                "satisfaction": "0.50",
            },
            content_type="application/json",
            **headers,
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["hope"], 75)
        response = self.client.post(
            "/api/v1/hcm/me/cpd",
            data={
                "title": "External safety seminar",
                "provider": "Training provider",
                "completed_on": timezone.now().date().isoformat(),
                "hours": "0.50",
            },
            content_type="application/json",
            **headers,
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["title"], "External safety seminar")
        response = self.client.get("/api/v1/hcm/me/profile", **headers)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["member_id"], str(member.id))

    def test_hr_profile_read_does_not_create_a_profile_for_another_org_member(self):
        owner = User.objects.create_user("hr-contract-owner@example.com", "x")
        outside = User.objects.create_user("hr-contract-outside@example.com", "x")
        org = org_services.create_organization(name="HR company", slug="hr-company", owner=owner)
        other_org = org_services.create_organization(name="Outside company", slug="hr-outside", owner=outside)
        with tenant_context(org_id=other_org.id, user_id=outside.id):
            outside_member = OrgMember.objects.get(org=other_org, user=outside)
        self.client.force_login(owner)
        response = self.client.get(
            f"/api/v1/hcm/people/{outside_member.id}/profile", HTTP_X_ORG_ID=str(org.id)
        )
        self.assertEqual(response.status_code, 404, response.content)
