"""M5 P14: support tickets (KPIs, search, internal notes, rich replies, ticket for a user),
broadcasts by audience, announcements with a banner, notification templates."""

from django.core import mail

from apps.engagement.models import Broadcast, Notification, NotificationTemplate, Ticket
from apps.identity.models import InstructorProfile
from apps.org import services as org_services
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


def kinds(user):
    with tenant_context(staff=True):
        return list(Notification.objects.filter(user=user).values_list("kind", flat=True))


class CommsTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()
        InstructorProfile.objects.create(user=self.teacher, status="approved")
        with tenant_context(user_id=self.omar.id):
            self.acme = org_services.create_organization(name="Acme", slug="acme", owner=self.omar)

    def post(self, path, data, method="post"):
        return getattr(self.client, method)(f"{API}{path}", data=data, content_type="application/json")

    def test_ticket_flow_notes_rich_reply_and_kpis(self):
        self.client.force_login(self.sara)
        t = self.post("/engagement/tickets", {"subject": "Can't play video", "category": "technical",
                                              "body": "The player is black."}).json()  # fmt: skip
        self.assertIn("ticket_opened", kinds(self.sara))
        self.assertIn("staff_ticket_new", kinds(self.staff))
        self.client.force_login(self.staff)
        r = self.client.get(f"{API}/console/tickets?q=black").json()
        self.assertEqual(r["total"], 0)  # body is not searched; subject is
        r = self.client.get(f"{API}/console/tickets?q=video").json()
        self.assertEqual([i["id"] for i in r["items"]], [t["id"]])
        note = self.post(f"/console/tickets/{t['id']}/messages", {"body": "Check CDN logs", "internal": True})
        self.assertEqual(note.status_code, 200)
        reply = self.post(f"/console/tickets/{t['id']}/messages",
                          {"body": '<p><strong>Fixed</strong><script>x()</script> <a href="javascript:x">x</a></p>'})  # fmt: skip
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(
            self.post(f"/console/tickets/{t['id']}", {"status": "resolved"}, "patch").status_code, 200
        )
        self.assertIn("ticket_resolved", kinds(self.sara))
        kpis = self.client.get(f"{API}/console/tickets/kpis").json()
        self.assertEqual(kpis["resolved_month"]["value"], 1)
        self.assertIsNotNone(kpis["avg_first_response_minutes"])
        # the learner sees the reply (cleaned), never the note
        self.client.force_login(self.sara)
        d = self.client.get(f"{API}/engagement/tickets/{t['id']}").json()
        htmls = [m["body_html"] for m in d["messages"]]
        self.assertEqual(len(htmls), 2)
        self.assertIn("<strong>Fixed</strong>", htmls[1])
        self.assertNotIn("script", htmls[1])
        self.assertNotIn("javascript", htmls[1])
        self.assertNotIn("CDN", " ".join(htmls))
        self.assertIn("ticket_reply", kinds(self.sara))

    def test_staff_opens_ticket_for_a_user(self):
        self.client.force_login(self.staff)
        r = self.post("/console/tickets", {"user_email": "SARA@learnhub.example.com", "subject": "Your refund",
                                           "category": "payment", "priority": "high", "body": "<p>Done.</p>"})  # fmt: skip
        self.assertEqual(r.status_code, 200)
        with tenant_context(staff=True):
            t = Ticket.objects.get(pk=r.json()["id"])
        self.assertEqual((t.user_id, t.priority, t.assigned_to_id), (self.sara.id, "high", self.staff.id))
        self.assertIn("ticket_opened", kinds(self.sara))
        bad = self.post("/console/tickets", {"user_email": "nobody@x.com", "subject": "Hi there", "category": "payment",
                                             "body": "x"})  # fmt: skip
        self.assertEqual(bad.json()["error"]["code"], "no_user")

    def test_broadcast_audiences_email_and_banner(self):
        self.client.force_login(self.staff)

        def count(a, extra=""):
            return self.client.get(f"{API}/console/broadcasts/audience?audience={a}{extra}").json()["count"]

        self.assertEqual(count("instructors"), 1)  # Tom
        self.assertEqual(count("learners"), 2)  # Sara, Omar (not staff, not Tom)
        self.assertEqual(count("company_admins"), 1)  # Omar owns Acme
        self.assertEqual(count("company", f"&org_id={self.acme.id}"), 1)
        self.assertEqual(count("everyone"), 4)
        r = self.post("/console/broadcasts", {"title": "New courses", "body": "Take a look", "audience": "learners",
                                              "send_in_app": True, "send_email": True})  # fmt: skip
        self.assertEqual(r.json()["recipient_count"], 2)
        self.assertIn("broadcast", kinds(self.sara))
        self.assertNotIn("broadcast", kinds(self.teacher))
        self.assertEqual(len(mail.outbox), 2)
        # email only: no inbox rows
        mail.outbox.clear()
        self.post("/console/broadcasts", {"title": "Teach more", "body": "Tips", "audience": "instructors",
                                          "send_in_app": False, "send_email": True})  # fmt: skip
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(kinds(self.teacher), [])
        # an announcement banner shows publicly until ended
        a = self.post("/console/broadcasts", {"kind": "announcement", "title": "Maintenance Sunday", "body": "2am",
                                              "audience": "everyone", "send_in_app": False, "show_as_banner": True})  # fmt: skip
        self.client.logout()
        self.assertEqual(self.client.get(f"{API}/platform/banner").json()["title"], "Maintenance Sunday")
        self.client.force_login(self.staff)
        self.post(f"/console/broadcasts/{a.json()['id']}/end-banner", {})
        self.assertIsNone(self.client.get(f"{API}/platform/banner").json())
        with tenant_context(staff=True):
            self.assertEqual(Broadcast.objects.count(), 3)
        bad = self.post(
            "/console/broadcasts", {"title": "x", "body": "y", "audience": "learners", "url": "https://evil"}
        )
        self.assertEqual(bad.json()["error"]["code"], "bad_url")

    def test_templates_validate_preview_and_are_used(self):
        self.client.force_login(self.staff)
        rows = {t["code"]: t for t in self.client.get(f"{API}/console/templates").json()}
        self.assertIn("{reference}", " ".join("{" + p + "}" for p in rows["ticket_reply"]["placeholders"]))
        broken = self.post(
            "/console/templates/ticket_reply", {"title": "Reply on {referance}", "body": "x"}, "put"
        )
        self.assertEqual(broken.json()["error"]["code"], "bad_placeholder")
        dropped = self.post("/console/templates/ticket_reply", {"title": "New reply", "body": "Look"}, "put")
        self.assertEqual(dropped.json()["error"]["code"], "missing_placeholder")
        p = self.post("/console/templates/ticket_reply/preview",
                      {"title": "{platform}: {reference}", "body": "About {subject}"}).json()  # fmt: skip
        self.assertEqual(p["title"], "LearnHub: LH-482913")
        ok = self.post("/console/templates/ticket_reply",
                       {"title": "Answer for {reference}", "body": "We replied on {subject}."}, "put")  # fmt: skip
        self.assertEqual(ok.status_code, 200)
        self.client.force_login(self.sara)
        t = self.post(
            "/engagement/tickets", {"subject": "Help me", "category": "account", "body": "Hello there"}
        ).json()
        self.client.force_login(self.staff)
        self.post(f"/console/tickets/{t['id']}/messages", {"body": "Hi"})
        with tenant_context(staff=True):
            n = Notification.objects.get(user=self.sara, kind="ticket_reply")
        self.assertTrue(n.title.startswith("Answer for LH-"))
        self.post("/console/templates/ticket_reply/reset", {})
        with tenant_context(staff=True):
            self.assertEqual(
                NotificationTemplate.objects.get(code="ticket_reply").title, "Support replied ({reference})"
            )
