"""M5 P1: every console route is staff-only; global search; nav counts; the settings
registry and the notification wording check."""

import re
import uuid

from apps.engagement import wording
from apps.identity.models import InstructorProfile
from apps.org import services as org_services
from apps.platform import registry
from apps.platform import services as platform
from core.api import api
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


def console_operations():
    """(method, concrete path) for every console operation, path params filled in."""
    for path, ops in api.get_openapi_schema()["paths"].items():
        if not path.startswith(f"{API}/console/"):
            continue
        concrete = re.sub(r"\{[a-z_]+\}", str(uuid.uuid4()), path)
        for method in ops:
            yield method, concrete


class ConsoleAccessTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()
        InstructorProfile.objects.create(user=self.teacher, status="approved")
        with tenant_context(user_id=self.omar.id):
            org_services.create_organization(name="Acme", slug="acme", owner=self.omar)  # omar: company owner

    def call(self, method, path):
        if method == "get":
            return self.client.get(path)
        return getattr(self.client, method)(path, data="{}", content_type="application/json")

    def test_every_console_route_refuses_non_staff(self):
        ops = list(console_operations())
        self.assertGreater(len(ops), 40)
        for user in (self.sara, self.teacher, self.omar):
            self.client.force_login(user)
            for method, path in ops:
                with self.subTest(user=user.email, op=f"{method} {path}"):
                    self.assertEqual(self.call(method, path).status_code, 403)
        self.client.logout()
        method, path = ops[0]
        self.assertEqual(self.call(method, path).status_code, 401)

    def test_search_and_nav_counts(self):
        f.money(self.staff)
        f.course(staff=self.staff, owner=self.teacher, slug="py", title="Python basics")
        self.client.force_login(self.staff)
        r = self.client.get(f"{API}/console/search?q=py").json()
        courses = next(g for g in r["groups"] if g["key"] == "courses")
        self.assertEqual(courses["hits"][0]["title"], "Python basics")
        self.assertTrue(courses["hits"][0]["url"].startswith("/console/courses?course="))
        people = self.client.get(f"{API}/console/search?q=tom").json()
        self.assertEqual([g["key"] for g in people["groups"]], ["instructors"])  # Tom teaches
        self.assertEqual(self.client.get(f"{API}/console/search?q=s").json()["groups"], [])  # 2+ characters
        counts = self.client.get(f"{API}/console/nav-counts").json()
        self.assertEqual(set(counts), {"approvals", "tickets_open", "reports_open", "payout_requests"})


class SettingsRegistryTest(SchemaTransactionTestCase):
    def test_defaults_validation_and_public_view(self):
        staff = f.users()[0]
        self.assertEqual(platform.get_setting("payouts.minimum_gbp_minor"), 2500)  # client question 2
        self.assertIs(platform.get_setting("access.maintenance_mode"), False)
        with tenant_context(user_id=staff.id, staff=True):
            with self.assertRaises(ServiceError):
                platform.set_setting(key="payouts.hold_days", value=-1, by=staff)
            with self.assertRaises(ServiceError):
                platform.set_setting(key="access.guest_browsing", value="yes", by=staff)
            with self.assertRaises(ServiceError):
                platform.set_setting(
                    key="general.logo_url", value="http://insecure.example/logo.png", by=staff
                )
            platform.set_setting(key="general.platform_name", value="  Kent Academy ", by=staff)
        self.assertEqual(platform.get_setting("general.platform_name"), "Kent Academy")
        public = self.client.get(f"{API}/platform/settings").json()
        self.assertEqual(public["general.platform_name"], "Kent Academy")
        self.assertIn("access.maintenance_mode", public)
        self.assertNotIn("payouts.hold_days", public)  # not public
        self.assertTrue(all(d.key in registry.BY_KEY for d in registry.SETTINGS))


class WordingTest(SchemaTransactionTestCase):
    def test_placeholders_are_checked(self):
        wording.check("course_rejected", "{course} was not approved", "Reason: {reason}")
        with self.assertRaises(ServiceError) as e:
            wording.check("course_rejected", "{course} was not approved", "Sorry.")  # dropped {reason}
        self.assertEqual(e.exception.code, "missing_placeholder")
        with self.assertRaises(ServiceError) as e:
            wording.check("course_rejected", "{cours} was not approved", "{reason}")  # misspelled
        self.assertEqual(e.exception.code, "bad_placeholder")
        with self.assertRaises(ServiceError):
            wording.check("course_rejected", "{Course} was not approved {course}", "{reason}")  # bad braces
        wording.check(
            "account_suspended", "Hello from {platform}", "Suspended."
        )  # {platform} is always allowed
