"""M5 P4 console approvals: the queue (tabs, search, major changes, certificate templates),
the review workspace, and decisions with their audits and notifications."""

from apps.catalog import services as cat
from apps.catalog.models import CertificateTemplate, CourseVersion
from apps.engagement.models import Notification
from apps.identity.models import InstructorProfile
from apps.platform.models import AuditLog
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


class ApprovalsTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()
        self.cat = f.money(self.staff)
        InstructorProfile.objects.create(user=self.teacher, status="approved")

    def post(self, path, data=None):
        return self.client.post(API + path, data=data or {}, content_type="application/json")

    def get(self, path):
        return self.client.get(API + path)

    def new_course(self, title):
        """An instructor's first submission (in review)."""
        self.client.force_login(self.teacher)
        c = self.post("/studio/courses", {"title": title}).json()
        v = self.get(f"/studio/courses/{c['id']}").json()["working_version"]["id"]
        sec = self.post(f"/studio/versions/{v}/sections", {"title": "One"}).json()["id"]
        self.post(
            f"/studio/sections/{sec}/lectures", {"kind": "article", "title": "Hello", "body": "<p>Hi</p>"}
        )
        self.assertEqual(self.post(f"/studio/versions/{v}/submit").json()["status"], "in_review")
        return c["id"], v

    def kinds(self, user):
        with tenant_context(staff=True):
            return list(Notification.objects.filter(user=user).values_list("kind", flat=True))

    def audited(self, **filters):
        with tenant_context(staff=True):
            return list(AuditLog.objects.filter(**filters).values_list("action", flat=True))

    def test_queue_tabs_search_and_major_change(self):
        live = f.course(staff=self.staff, owner=self.teacher, slug="py", title="Python basics")
        with tenant_context(user_id=self.teacher.id):
            draft = cat.create_draft(course=live, by=self.teacher)
            cat.submit(version=draft, by=self.teacher, change_summary="New section", is_major_change=True)
        self.new_course("Rust for Beginners")
        self.assertIn("staff_course_submitted", self.kinds(self.staff))  # staff told about submissions

        self.client.force_login(self.staff)
        r = self.get("/console/approvals").json()
        self.assertEqual(r["counts"], {"all": 2, "new": 1, "changes": 1, "major": 1, "templates": 0})
        labels = {i["title"]: i["label"] for i in r["items"]}
        self.assertEqual(
            labels, {"Python basics": "Course change (major)", "Rust for Beginners": "New course"}
        )
        self.assertEqual([i["title"] for i in self.get("/console/approvals?tab=new").json()["items"]],
                         ["Rust for Beginners"])  # fmt: skip
        self.assertEqual([i["title"] for i in self.get("/console/approvals?q=pyth").json()["items"]],
                         ["Python basics"])  # fmt: skip
        self.assertEqual(self.get("/console/approvals?tab=nope").status_code, 400)

        d = self.get(f"/console/review/versions/{draft.id}").json()
        self.assertTrue(d["is_major_change"])
        self.assertFalse(d["first_release"])
        self.assertEqual([h["number"] for h in d["history"]], [2, 1])  # every version, newest first
        self.assertEqual(d["instructors"][0]["name"], "Tom Teacher")
        self.assertEqual(d["includes"]["quizzes"], 1)
        self.assertTrue(any(q["label"] == "Price is set" and q["ok"] for q in d["quick_checks"]))
        self.assertIsNotNone(d["preview_lecture_id"])
        play = self.get(f"/console/review/lectures/{d['preview_lecture_id']}/play")
        self.assertEqual(play.status_code, 200)

    def test_first_release_is_never_major(self):
        _, v = self.new_course("Go basics")
        self.assertFalse(CourseVersion.objects.get(pk=v).is_major_change)

    def test_decisions_audit_and_notify(self):
        course_id, v = self.new_course("Rust for Beginners")
        self.client.force_login(self.staff)
        self.assertEqual(
            self.post(f"/console/review/versions/{v}/request-changes", {"notes": " "}).status_code, 400
        )
        self.assertEqual(self.post(f"/console/review/versions/{v}/request-changes", {"notes": "x" * 1001}).status_code,
                         422)  # fmt: skip
        self.assertEqual(self.post(f"/console/review/versions/{v}/request-changes",
                                   {"notes": "Add a quiz"}).json()["status"], "changes_requested")  # fmt: skip
        self.assertIn("course_changes_requested", self.kinds(self.teacher))
        # the instructor sees the notes in the studio
        self.client.force_login(self.teacher)
        versions = self.get(f"/studio/courses/{course_id}").json()["versions"]
        self.assertEqual(versions[0]["review_notes"], "Add a quiz")
        self.post(f"/studio/versions/{v}/submit")

        self.client.force_login(self.staff)
        self.assertEqual(self.post(f"/console/review/versions/{v}/reject", {"reason": ""}).status_code, 422)
        self.assertEqual(self.post(f"/console/review/versions/{v}/reject",
                                   {"reason": "Copied content"}).json()["status"], "rejected")  # fmt: skip
        self.assertIn("course_rejected", self.kinds(self.teacher))
        self.assertEqual(
            self.post(f"/console/review/versions/{v}/approve").status_code, 400
        )  # decided already
        actions = set(self.audited(target_id=v))
        self.assertEqual(actions, {"course.request_changes", "course.reject"})

        # a rejected first release: the instructor can start again from it
        with tenant_context(user_id=self.teacher.id):
            from apps.catalog.models import Course

            again = cat.create_draft(course=Course.objects.get(pk=course_id), by=self.teacher)
        self.assertEqual((again.number, again.status), (2, "draft"))
        self.assertEqual(again.lectures.count(), 1)

        # approve the resubmission: live, instructor told, audited
        with tenant_context(user_id=self.teacher.id):
            cat.submit(version=again, by=self.teacher)
        self.assertEqual(self.post(f"/console/review/versions/{again.id}/approve", {"notes": "Great"}).json()["status"],
                         "published")  # fmt: skip
        self.assertIn("course_approved", self.kinds(self.teacher))
        self.assertTrue(self.audited(action="course.approve", target_id=str(again.id)))

    def test_instructor_templates_are_approved_here(self):
        self.client.force_login(self.teacher)
        t = self.post(
            "/studio/certificate-templates", {"name": "Modern blue", "layout": {"style": "modern"}}
        ).json()
        self.assertEqual(t["status"], "pending")
        self.assertIn("staff_template_submitted", self.kinds(self.staff))
        self.assertEqual(self.post("/studio/certificate-templates", {"name": "Bad", "layout": {"primary": "red"}})
                         .status_code, 400)  # fmt: skip
        # learners and instructors can't decide
        self.assertEqual(self.post(f"/console/certificates/templates/{t['id']}/approve").status_code, 403)

        self.client.force_login(self.staff)
        q = self.get("/console/approvals?tab=templates").json()
        self.assertEqual(q["counts"]["templates"], 1)
        self.assertEqual(q["items"][0]["label"], "Certificate template")
        self.assertEqual(self.post(f"/console/certificates/templates/{t['id']}/reject", {"reason": "Blurry logo"})
                         .json()["status"], "rejected")  # fmt: skip
        self.assertIn("template_rejected", self.kinds(self.teacher))

        # an edit sends it back for approval; then staff approve it
        self.client.force_login(self.teacher)
        self.client.patch(f"{API}/studio/certificate-templates/{t['id']}", data={"name": "Modern blue 2"},
                          content_type="application/json")  # fmt: skip
        self.assertEqual(CertificateTemplate.objects.get(pk=t["id"]).status, "pending")
        self.client.force_login(self.staff)
        self.assertEqual(
            self.post(f"/console/certificates/templates/{t['id']}/approve").json()["status"], "active"
        )
        self.assertIn("template_approved", self.kinds(self.teacher))
        self.assertTrue(self.audited(action="certificate_template.approve"))
