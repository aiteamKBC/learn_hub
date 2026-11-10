"""M5 P15: learners report reviews/questions/answers; staff hide (reason, author told,
reporters thanked) or dismiss; hidden content leaves the course page."""

from apps.engagement import services as social
from apps.engagement.models import ContentReport, Notification
from apps.learning import services as learning
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


def kinds(user):
    with tenant_context(staff=True):
        return list(Notification.objects.filter(user=user).values_list("kind", flat=True))


class ModerationTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()
        f.money(self.staff)
        self.course = f.course(
            staff=self.staff, owner=self.teacher, slug="py", title="Python basics", free=True
        )
        for u in (self.sara, self.omar):
            with tenant_context(user_id=u.id):
                learning.enrol(user=u, course=self.course, source="free")
        with tenant_context(user_id=self.sara.id):
            self.review = social.write_review(
                user=self.sara, course_id=self.course.id, rating=1, body="Spam link here"
            )
            self.question = social.ask(
                user=self.sara, course_id=self.course.id, title="Buy cheap", body="Spam"
            )

    def post(self, path, data):
        return self.client.post(f"{API}{path}", data=data, content_type="application/json")

    def test_report_hide_and_notifications(self):
        self.client.force_login(self.omar)
        r = self.post("/engagement/reports", {"target_type": "review", "target_id": str(self.review.id),
                                              "reason": "Advertising"})  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        again = self.post("/engagement/reports", {"target_type": "review", "target_id": str(self.review.id),
                                                  "reason": "Advertising"})  # fmt: skip
        self.assertEqual(again.json()["error"]["code"], "already_reported")
        self.client.force_login(self.sara)
        own = self.post("/engagement/reports", {"target_type": "review", "target_id": str(self.review.id),
                                                "reason": "Mine"})  # fmt: skip
        self.assertEqual(own.json()["error"]["code"], "own_content")
        self.assertIn("staff_content_reported", kinds(self.staff))

        self.client.force_login(self.staff)
        queue = self.client.get(f"{API}/console/moderation/reports").json()["items"]
        self.assertEqual(queue[0]["content_text"], "Spam link here")
        no_reason = self.post(
            f"/console/moderation/reports/{queue[0]['id']}/hide", {"hide": True, "reason": ""}
        )
        self.assertEqual(no_reason.json()["error"]["code"], "reason_required")
        ok = self.post(
            f"/console/moderation/reports/{queue[0]['id']}/hide", {"hide": True, "reason": "Advertising"}
        )
        self.assertEqual(ok.status_code, 200)
        with tenant_context(staff=True):
            self.assertEqual(ContentReport.objects.get().status, "actioned")
        self.assertIn("content_hidden", kinds(self.sara))
        self.assertIn("report_handled", kinds(self.omar))
        # gone from the public course page
        self.client.logout()
        page = self.client.get(f"{API}/engagement/courses/{self.course.id}/reviews").json()
        self.assertEqual(page["items"], [])
        # and shown again
        self.client.force_login(self.staff)
        self.post(f"/console/moderation/review/{self.review.id}", {"hide": False})
        items = self.client.get(f"{API}/console/moderation/items?kind=review&status=visible").json()["items"]
        self.assertEqual([i["id"] for i in items], [str(self.review.id)])

    def test_dismiss_and_question_hide(self):
        self.client.force_login(self.omar)
        rep = self.post("/engagement/reports", {"target_type": "question", "target_id": str(self.question.id),
                                                "reason": "Looks like spam"}).json()  # fmt: skip
        self.client.force_login(self.staff)
        self.assertEqual(
            self.post(f"/console/moderation/reports/{rep['id']}/dismiss", {"note": "Fine"}).status_code, 200
        )
        self.assertIn("report_handled", kinds(self.omar))
        twice = self.post(f"/console/moderation/reports/{rep['id']}/dismiss", {})
        self.assertEqual(twice.json()["error"]["code"], "already_handled")
        self.post(f"/console/moderation/question/{self.question.id}", {"hide": True, "reason": "Off topic"})
        hidden = self.client.get(f"{API}/console/moderation/items?kind=question&status=hidden").json()[
            "items"
        ]
        self.assertEqual(len(hidden), 1)
        summary = self.client.get(f"{API}/console/moderation/summary").json()
        self.assertEqual((summary["hidden_questions"], summary["open_reports"]), (1, 0))
