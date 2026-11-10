"""M5 P19: the audit log filters (actor, company, action, dates, search), keyset pages,
the action list and the CSV export (staff only, itself audited)."""

from datetime import timedelta

from django.utils import timezone

from apps.platform.services import audit
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


class AuditTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()
        with tenant_context(user_id=self.staff.id, staff=True):
            for i in range(5):
                audit(
                    "course.unpublish",
                    "course",
                    f"c{i}",
                    actor_id=self.staff.id,
                    data={"reason": f"Broken {i}"},
                )
            audit("ticket.reply", "ticket", "t1", actor_id=self.teacher.id, data={"reference": "LH-1"})

    def test_filters_pages_and_export(self):
        self.client.force_login(self.staff)
        get = lambda q: self.client.get(f"{API}/console/audit?{q}").json()  # noqa: E731
        self.assertEqual(len(get("action=course.")["items"]), 5)
        self.assertEqual(len(get("actor=tom@")["items"]), 1)
        self.assertEqual(len(get("q=Broken 3")["items"]), 1)
        self.assertEqual(len(get("target=c2")["items"]), 1)
        today = timezone.now().date()
        self.assertEqual(len(get(f"start={today + timedelta(days=1)}")["items"]), 0)
        self.assertEqual(len(get(f"start={today}&end={today}")["items"]), 6)
        first = get("limit=4")
        self.assertEqual(len(first["items"]), 4)
        rest = get(f"limit=4&cursor={first['next_cursor']}")
        self.assertEqual(len(rest["items"]), 2)
        self.assertIsNone(rest["next_cursor"])
        actions = {a["action"]: a["count"] for a in self.client.get(f"{API}/console/audit/actions").json()}
        self.assertEqual(actions["course.unpublish"], 5)
        csv = self.client.get(f"{API}/console/audit/export.csv?action=course.")
        self.assertEqual(csv["Content-Type"], "text/csv; charset=utf-8")
        lines = csv.content.decode().strip().splitlines()
        self.assertEqual(len(lines), 6)  # header + 5
        self.assertIn("audit.export", [r["action"] for r in get("action=audit.")["items"]])

    def test_export_refuses_non_staff(self):
        self.client.force_login(self.sara)
        self.assertEqual(self.client.get(f"{API}/console/audit/export.csv").status_code, 403)
        self.client.logout()
        self.assertEqual(self.client.get(f"{API}/console/audit/export.csv").status_code, 401)
