"""M5 P6: students and instructors in the console: lists, KPIs, filters, export, detail,
edit, suspend / reactivate (with notifications), delete guards, permissions enforced in
the studio, instructor suspension and the invite-to-teach flow."""

from django.core.cache import cache

from apps.catalog.models import CourseVersion
from apps.engagement.models import Notification
from apps.identity import invites
from apps.identity.models import InstructorProfile, User
from apps.platform import services as platform
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


class ConsolePeopleTest(SchemaTransactionTestCase):
    def setUp(self):
        cache.clear()  # settings are cached for 60 s
        self.addCleanup(cache.clear)  # and must not leak into the next test class
        self.staff, self.tom, self.sara, self.omar = f.users()
        f.money(self.staff)
        InstructorProfile.objects.create(user=self.tom, status="approved")
        self.course = f.course(staff=self.staff, owner=self.tom, slug="py", title="Python")

    def as_(self, user):
        self.client.force_login(user)

    def get(self, path):
        return self.client.get(API + path)

    def post(self, path, data=None):
        return self.client.post(API + path, data=data or {}, content_type="application/json")

    def send(self, method, path, data):
        return getattr(self.client, method)(API + path, data=data, content_type="application/json")

    def kinds(self, user):
        with tenant_context(staff=True):
            return list(Notification.objects.filter(user=user).values_list("kind", flat=True))

    def test_students_list_detail_edit_suspend_delete(self):
        self.as_(self.staff)
        kpis = self.get("/console/people/students/kpis").json()
        self.assertEqual((kpis["total"], kpis["active"], kpis["suspended"]), (3, 3, 0))  # staff not counted
        self.assertEqual(kpis["new_30d"]["value"], 3)
        rows = self.get("/console/people/students?q=sara").json()["items"]
        self.assertEqual([r["email"] for r in rows], ["sara@learnhub.example.com"])
        self.assertEqual(self.get("/console/people/students?enrolment=active").json()["items"], [])
        self.assertEqual(self.get("/console/people/students?status=bogus").status_code, 422)
        self.assertEqual(len(self.get("/console/people/students/export").json()), 3)
        detail = self.get(f"/console/people/students/{self.sara.id}").json()
        self.assertEqual((detail["status"], detail["enrolments"], detail["can_delete"]), ("active", 0, True))

        r = self.send(
            "patch",
            f"/console/people/accounts/{self.sara.id}",
            {"full_name": "Sara A.", "email": "Sara.New@x.test"},
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(User.objects.get(pk=self.sara.id).email, "sara.new@x.test")
        self.assertEqual(self.send("patch", f"/console/people/accounts/{self.sara.id}",
                                   {"email": "omar@learnhub.example.com"}).status_code, 400)  # fmt: skip

        self.assertEqual(
            self.post(f"/console/people/accounts/{self.sara.id}/suspend", {"reason": ""}).status_code, 422
        )
        self.assertEqual(self.post(f"/console/people/accounts/{self.sara.id}/suspend", {"reason": "Chargebacks"}).status_code,
                         200)  # fmt: skip
        self.assertFalse(User.objects.get(pk=self.sara.id).is_active)
        self.assertEqual(
            self.get("/console/people/students?status=suspended").json()["items"][0]["id"], str(self.sara.id)
        )
        self.post(f"/console/people/accounts/{self.sara.id}/reactivate")
        self.assertEqual(set(self.kinds(self.sara)), {"account_suspended", "account_reactivated"})
        self.assertEqual(
            self.post(f"/console/people/accounts/{self.staff.id}/suspend", {"reason": "Testing"}).status_code,
            400,
        )

        # delete = anonymise: never yourself, never staff, never a seeded demo account
        self.assertEqual(self.post(f"/console/users/{self.staff.id}/anonymize").status_code, 400)
        with tenant_context(user_id=self.staff.id, staff=True):
            platform.set_setting(key="demo.seeded", value="2026-11-07", by=self.staff)
        self.assertEqual(
            self.post(f"/console/users/{self.omar.id}/anonymize").json()["error"]["code"], "demo_account"
        )
        self.assertFalse(self.get(f"/console/people/students/{self.omar.id}").json()["can_delete"])
        self.assertEqual(
            self.post(f"/console/users/{self.sara.id}/anonymize").status_code, 200
        )  # no longer a demo email
        actions = {a["action"] for a in self.get("/console/audit").json()["items"]}
        self.assertTrue(
            {"user.edit", "user.suspend", "user.reactivate", "user.anonymize", "people.export"} <= actions
        )

    def test_instructors_permissions_enforced_and_suspension(self):
        self.as_(self.staff)
        kpis = self.get("/console/people/instructors/kpis").json()
        self.assertEqual((kpis["total"], kpis["active"]), (1, 1))
        row = self.get("/console/people/instructors?q=tom").json()["items"][0]
        self.assertEqual((row["courses"], row["status"]), (1, "approved"))
        self.assertEqual(
            self.get("/console/people/instructors?permission=publish_without_review").json()["items"], []
        )

        perms = {"can_publish_without_review": True, "can_create_coupons": False, "can_use_drm": False,
                 "can_issue_certificates": True, "max_courses": 1}  # fmt: skip
        r = self.send("put", f"/console/people/instructors/{self.tom.id}/permissions", perms)
        self.assertEqual((r.json()["max_courses"], r.json()["is_custom"]), (1, True))
        self.assertIn("permissions_changed", self.kinds(self.tom))
        self.assertEqual(len(self.get("/console/people/instructors?permission=custom").json()["items"]), 1)
        detail = self.get(f"/console/people/instructors/{self.tom.id}").json()
        self.assertEqual((detail["courses"], detail["permissions"]["can_create_coupons"]), (1, False))

        # the studio enforces them
        self.as_(self.tom)
        coupon = self.post(
            f"/studio/courses/{self.course.id}/coupons", {"code": "TOM10", "percent_off": 10, "days": 7}
        )
        self.assertEqual(coupon.json()["error"]["code"], "coupons_off")
        self.assertEqual(
            self.post("/studio/courses", {"title": "Second course"}).json()["error"]["code"], "course_limit"
        )
        self.as_(self.staff)
        self.send(
            "put", f"/console/people/instructors/{self.tom.id}/permissions", perms | {"max_courses": None}
        )
        self.as_(self.tom)
        c = self.post("/studio/courses", {"title": "Rust basics"}).json()
        v = self.get(f"/studio/courses/{c['id']}").json()["working_version"]["id"]
        sec = self.post(f"/studio/versions/{v}/sections", {"title": "One"}).json()["id"]
        self.post(f"/studio/sections/{sec}/lectures", {"kind": "article", "title": "Hi", "body": "<p>Hi</p>"})
        self.assertEqual(self.post(f"/studio/versions/{v}/submit").json()["status"], "published")  # no review
        self.assertEqual(CourseVersion.objects.get(pk=v).status, "published")

        # suspended: the course stays live, the studio is closed
        self.as_(self.staff)
        self.assertEqual(self.post(f"/console/people/instructors/{self.tom.id}/suspend", {"reason": "Unpaid refunds"})
                         .json()["status"], "suspended")  # fmt: skip
        self.assertIn("instructor_suspended", self.kinds(self.tom))
        self.as_(self.tom)
        self.assertEqual(self.get(f"/studio/courses/{self.course.id}").status_code, 403)
        self.assertEqual(self.get(f"/catalog/courses/{self.course.slug}").status_code, 200)
        self.as_(self.staff)
        self.post(f"/console/people/instructors/{self.tom.id}/reactivate")
        self.as_(self.tom)
        self.assertEqual(self.get(f"/studio/courses/{self.course.id}").status_code, 200)

    def test_applications_and_invite(self):
        InstructorProfile.objects.create(user=self.omar, headline="Chef")
        self.as_(self.staff)
        self.assertEqual(
            self.post(f"/console/instructors/{self.omar.id}/decision", {"approve": False}).status_code, 400
        )
        self.post(
            f"/console/instructors/{self.omar.id}/decision",
            {"approve": False, "reason": "Add your experience"},
        )
        self.assertIn("instructor_rejected", self.kinds(self.omar))

        r = self.post(
            "/console/people/instructors/invite", {"email": "Sara@learnhub.example.com", "name": "Sara"}
        )
        self.assertEqual(r.json(), {"email": "sara@learnhub.example.com", "expires_days": 7})
        self.assertEqual(self.post("/console/people/instructors/invite", {"email": "tom@learnhub.example.com"})
                         .json()["error"]["code"], "already_instructor")  # fmt: skip
        token = invites.make_token(email="sara@learnhub.example.com", invited_by=self.staff)
        self.assertEqual(self.client.get(f"{API}/identity/instructor-invites/preview", {"token": token}).json(),
                         {"email": "sara@learnhub.example.com"})  # fmt: skip
        self.assertEqual(self.client.get(f"{API}/identity/instructor-invites/preview", {"token": token + "x"})
                         .status_code, 404)  # fmt: skip
        self.as_(self.omar)  # someone else's invitation
        self.assertEqual(self.post("/identity/instructor-invites/accept", {"token": token}).status_code, 403)
        self.as_(self.sara)
        self.assertEqual(
            self.post("/identity/instructor-invites/accept", {"token": token}).json()["status"], "approved"
        )
        self.assertTrue(self.get("/identity/me").json()["is_instructor"])
        self.assertIn("instructor_approved", self.kinds(self.sara))

    def test_pending_invites_resend_and_cancel(self):
        from django.core import mail

        self.as_(self.staff)
        self.post("/console/people/instructors/invite", {"email": "new@x.test", "name": "Nadia"})
        self.post("/console/people/instructors/invite", {"email": "new@x.test"})  # again: one row, sent twice
        self.post("/console/people/instructors/invite", {"email": "omar@learnhub.example.com"})
        rows = self.get("/console/people/instructors/invites").json()
        self.assertEqual([r["email"] for r in rows], ["omar@learnhub.example.com", "new@x.test"])
        nadia = rows[1]
        self.assertEqual((nadia["name"], nadia["send_count"], nadia["expired"]), ("Nadia", 2, False))

        mail.outbox.clear()
        r = self.post(f"/console/people/instructors/invites/{nadia['id']}/resend")
        self.assertEqual(r.json()["send_count"], 3)
        self.assertEqual(mail.outbox[0].to, ["new@x.test"])
        token = mail.outbox[0].body.split("/teach/invite/")[1].split()[0]
        self.assertEqual(self.client.get(f"{API}/identity/instructor-invites/preview", {"token": token}).status_code,
                         200)  # fmt: skip

        self.assertEqual(
            self.post(f"/console/people/instructors/invites/{nadia['id']}/cancel").json(), {"ok": True}
        )
        r = self.client.get(f"{API}/identity/instructor-invites/preview", {"token": token})
        self.assertEqual(r.json()["error"]["code"], "invite_cancelled")  # every link for it stops working
        self.assertEqual(
            self.post(f"/console/people/instructors/invites/{nadia['id']}/resend").status_code, 404
        )

        omar = self.get("/console/people/instructors/invites").json()[0]
        mail.outbox.clear()
        self.post(f"/console/people/instructors/invites/{omar['id']}/resend")
        omar_token = mail.outbox[0].body.split("/teach/invite/")[1].split()[0]
        self.as_(self.omar)
        self.assertEqual(self.post("/identity/instructor-invites/accept", {"token": omar_token}).json()["status"],
                         "approved")  # fmt: skip
        self.as_(self.staff)
        self.assertEqual(
            self.get("/console/people/instructors/invites").json(), []
        )  # accepted: no longer pending
        self.as_(self.sara)
        self.assertEqual(self.get("/console/people/instructors/invites").status_code, 403)
