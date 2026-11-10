"""M5 P18: typed settings saved together and audited; the switches the backend enforces
(staff always bypass), and with every switch at its default the M1–M4 behaviour."""

from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError

from apps.identity.models import InstructorProfile
from apps.platform import services as platform
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


class SettingsTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()

    def tearDown(self):
        # the rows are flushed after each test but cached settings would outlive them
        # (maintenance mode would leak into the next test)
        cache.clear()

    def save(self, values):
        self.client.force_login(self.staff)
        return self.client.put(
            f"{API}/console/settings", data={"values": values}, content_type="application/json"
        )

    def test_save_validates_everything_first_and_audits(self):
        r = self.save({"general.platform_name": "Kent Academy", "payouts.hold_days": 999})
        self.assertEqual(r.json()["error"]["code"], "bad_value")
        self.assertEqual(platform.get_setting("general.platform_name"), "LearnHub")  # nothing half-saved
        r = self.save({"general.platform_name": "Kent Academy", "general.tagline": "Learn. Practise. Grow."})
        self.assertEqual(r.json()["changed"], ["general.platform_name"])  # the tagline did not change
        rows = {s["key"]: s for s in self.client.get(f"{API}/console/settings").json()["settings"]}
        self.assertEqual(rows["general.platform_name"]["value"], "Kent Academy")
        self.assertEqual(rows["general.platform_name"]["updated_by"], "Staff")
        audit = self.client.get(f"{API}/console/audit?action=setting.").json()["items"]
        self.assertEqual(audit[0]["data"], {"from": "LearnHub", "to": "Kent Academy"})
        self.assertEqual(self.save({"nope.key": 1}).json()["error"]["code"], "bad_key")
        self.assertEqual(
            self.save({"general.logo_url": "/api/v1/platform/branding/logo?v=abc"}).status_code, 200
        )
        self.assertEqual(
            self.save({"general.logo_url": "/api/v1/other"}).json()["error"]["code"], "bad_value"
        )

    def test_maintenance_blocks_everyone_but_staff(self):
        self.client.force_login(self.sara)
        self.assertEqual(self.client.get(f"{API}/engagement/tickets").status_code, 200)  # default: off
        self.save({"access.maintenance_mode": True, "access.maintenance_message": "Back at 3pm"})
        self.client.force_login(self.sara)
        r = self.client.get(f"{API}/engagement/tickets")
        self.assertEqual((r.status_code, r.json()["error"]["message"]), (503, "Back at 3pm"))
        self.assertEqual(
            self.client.get(f"{API}/platform/settings").status_code, 200
        )  # the app can still read it
        self.client.logout()
        self.assertEqual(self.client.get(f"{API}/catalog/courses").status_code, 503)
        self.client.force_login(self.staff)
        self.assertEqual(self.client.get(f"{API}/engagement/tickets").status_code, 200)  # staff bypass
        self.assertEqual(self.client.get(f"{API}/console/tickets").status_code, 200)

    def test_guest_browsing_applications_and_registration(self):
        self.assertEqual(self.client.get(f"{API}/catalog/courses").status_code, 200)  # default: guests browse
        self.save({"access.guest_browsing": False, "access.instructor_applications": False,
                   "access.registration_enabled": False})  # fmt: skip
        self.client.logout()
        r = self.client.get(f"{API}/catalog/courses")
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (401, "sign_in_required"))
        self.client.force_login(self.sara)
        self.assertEqual(self.client.get(f"{API}/catalog/courses").status_code, 200)
        r = self.client.post(f"{API}/studio/instructor-profile", data={"headline": "Teacher", "bio": "Hi"},
                             content_type="application/json")  # fmt: skip
        self.assertEqual(r.json()["error"]["code"], "applications_closed")
        self.assertFalse(InstructorProfile.objects.filter(user=self.sara).exists())
        self.client.logout()
        r = self.client.post("/_allauth/browser/v1/auth/signup", data={"email": "new@x.com", "password": "a-long-pass-123"},
                             content_type="application/json")  # fmt: skip
        self.assertEqual(r.status_code, 403)

    def test_password_length_and_mfa_switch(self):
        validate_password("eight-ch")  # default 8, as before
        with tenant_context(user_id=self.staff.id, staff=True):
            platform.set_setting(key="security.password_min_length", value=12, by=self.staff)
        with self.assertRaises(ValidationError):
            validate_password("eleven-char")
        with self.assertRaises(ServiceError):
            with tenant_context(user_id=self.staff.id, staff=True):
                platform.set_setting(key="security.password_min_length", value=4, by=self.staff)
        self.save({"security.mfa_enabled": False})
        self.client.force_login(self.sara)
        r = self.client.post("/_allauth/browser/v1/account/authenticators/totp", data={"code": "123456"},
                             content_type="application/json")  # fmt: skip
        self.assertEqual(r.json()["error"]["code"], "mfa_disabled")

    def test_staff_must_use_mfa_when_required(self):
        self.save({"security.mfa_required_for_staff": True})
        r = self.client.get(f"{API}/console/tickets")
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (403, "mfa_required"))
        from allauth.mfa.models import Authenticator

        Authenticator.objects.create(user=self.staff, type="totp", data={"secret": "x"})
        self.assertEqual(self.client.get(f"{API}/console/tickets").status_code, 200)
