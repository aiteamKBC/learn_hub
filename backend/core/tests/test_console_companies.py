"""M5 P16: companies list/create/edit, seats, status (reason + admins told), add-ons on and
off, company admins."""

from apps.commerce.models import Addon
from apps.engagement.models import Notification
from apps.org.models import OrgMember
from apps.platform.models import Entitlement
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


def kinds(user):
    with tenant_context(staff=True):
        return list(Notification.objects.filter(user=user).values_list("kind", flat=True))


class CompaniesTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()
        with tenant_context(user_id=self.staff.id, staff=True):
            Addon.objects.create(code="content_protection", name="Content protection")
        self.client.force_login(self.staff)

    def call(self, method, path, data=None):
        return getattr(self.client, method)(f"{API}{path}", data=data or {}, content_type="application/json")

    def test_company_lifecycle(self):
        r = self.call("post", "/console/companies", {"name": "Acme Ltd", "slug": "acme", "owner_email": "omar@learnhub.example.com",
                                                     "seat_limit": 10})  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        org = r.json()["id"]
        self.assertIn("company_created", kinds(self.omar))
        rows = self.client.get(f"{API}/console/companies?q=acm").json()
        self.assertEqual((rows[0]["members"], rows[0]["admins"], rows[0]["seat_limit"]), (1, 1, 10))

        no_reason = self.call("patch", f"/console/companies/{org}", {"status": "suspended"})
        self.assertEqual(no_reason.json()["error"]["code"], "reason_required")
        self.call("patch", f"/console/companies/{org}", {"status": "suspended", "reason": "Unpaid invoice"})
        self.call("patch", f"/console/companies/{org}", {"seat_limit": 25})
        self.assertIn("company_suspended", kinds(self.omar))
        self.assertIn("company_seats_changed", kinds(self.omar))
        too_few = self.call("patch", f"/console/companies/{org}", {"seat_limit": 1})
        self.assertEqual(too_few.status_code, 200)  # 1 member uses 1 seat

        on = self.call(
            "post", f"/console/companies/{org}/entitlements", {"feature": "content_protection", "days": 30}
        )
        self.assertIn("addon_enabled", kinds(self.omar))
        detail = self.client.get(f"{API}/console/companies/{org}").json()
        self.assertTrue(detail["entitlements"][0]["active"])
        off = self.call(
            "post", f"/console/companies/{org}/entitlements/{on.json()['id']}/end", {"reason": "Trial over"}
        )
        self.assertEqual(off.status_code, 200)
        self.assertIn("addon_disabled", kinds(self.omar))
        with tenant_context(staff=True):
            self.assertIsNotNone(Entitlement.objects.get(pk=on.json()["id"]).ends_at)
        bad = self.call("post", f"/console/companies/{org}/entitlements", {"feature": "nonsense"})
        self.assertEqual(bad.json()["error"]["code"], "bad_feature")

        # admins: add Sara (joins as admin), demote her, the last owner stays
        self.call("post", f"/console/companies/{org}/admins", {"email": "sara@learnhub.example.com"})
        detail = self.client.get(f"{API}/console/companies/{org}").json()
        sara = next(a for a in detail["admins"] if a["email"] == "sara@learnhub.example.com")
        self.assertEqual(sara["role"], "admin")
        self.call(
            "post", f"/console/companies/{org}/admins/{sara['member_id']}/remove", {"reason": "Left the team"}
        )
        with tenant_context(staff=True):
            self.assertEqual(OrgMember.objects.get(pk=sara["member_id"]).role, "learner")
        owner = next(a for a in detail["admins"] if a["role"] == "owner")
        last = self.call(
            "post", f"/console/companies/{org}/admins/{owner['member_id']}/remove", {"reason": "Test it"}
        )
        self.assertEqual(last.json()["error"]["code"], "last_owner")
        actions = [
            r["action"] for r in self.client.get(f"{API}/console/audit?action=company.").json()["items"]
        ]
        self.assertIn("company.addon_off", actions)
        self.assertIn("company.admin_add", actions)
