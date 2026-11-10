"""The business (HR) API end to end: roles, manager scope, requirements, the matrix,
actions, invites, assigning training, exports and the audit trail."""

import csv
import io
from datetime import timedelta

from django.core import mail
from django.utils import timezone

from apps.identity.models import User
from apps.org import services as org_services
from apps.org.models import OrgMember, OrgUnit, UnitManager
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


class BusinessApiTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()
        f.money(self.staff)
        self.hr = User.objects.create_user("hana@acme.example.com", "x", full_name="Hana HR")
        self.manager = User.objects.create_user("mo@acme.example.com", "x", full_name="Mo Manager")
        self.evil = User.objects.create_user('=HYPERLINK("x")@acme.example.com', "x", full_name="=CMD()")
        self.acme = org_services.create_organization(name="Acme", slug="acme", owner=self.hr)
        self.H = {"HTTP_X_ORG_ID": str(self.acme.id)}
        with tenant_context(org_id=self.acme.id, user_id=self.hr.id):
            root = OrgUnit.objects.get(org=self.acme, parent__isnull=True)
            self.north = org_services.create_unit(parent=root, kind="region", name="North")
            self.leeds = org_services.create_unit(parent=self.north, kind="site", name="Leeds")
            self.south = org_services.create_unit(parent=root, kind="region", name="South")
            now = timezone.now()
            self.m_sara = OrgMember.objects.create(org=self.acme, user=self.sara, joined_at=now)
            self.m_omar = OrgMember.objects.create(org=self.acme, user=self.omar, joined_at=now)
            self.m_mgr = OrgMember.objects.create(
                org=self.acme, user=self.manager, role="manager", joined_at=now
            )
            self.m_evil = OrgMember.objects.create(org=self.acme, user=self.evil, joined_at=now)
            org_services.add_member_to_unit(member=self.m_sara, unit=self.leeds, primary=True)
            org_services.add_member_to_unit(member=self.m_evil, unit=self.leeds, primary=True)
            org_services.add_member_to_unit(member=self.m_omar, unit=self.south, primary=True)
            org_services.add_member_to_unit(member=self.m_mgr, unit=self.leeds, primary=True)
            UnitManager.objects.create(org=self.acme, unit=self.leeds, member=self.m_mgr)
        self.fire = f.course(
            staff=self.staff, owner=self.staff, slug="fire", title="Fire Safety", ownership="platform"
        )

    def as_(self, user):
        self.client.force_login(user)

    def get(self, path, **kw):
        return self.client.get(API + path, **{**self.H, **kw})

    def post(self, path, data=None, **kw):
        return self.client.post(
            API + path, data=data or {}, content_type="application/json", **{**self.H, **kw}
        )

    def patch(self, path, data):
        return self.client.patch(API + path, data=data, content_type="application/json", **self.H)

    def test_roles_scope_requirements_matrix_and_actions(self):
        # learners and outsiders get nothing from the HR API
        self.as_(self.sara)
        self.assertEqual(self.get("/compliance/matrix").status_code, 403)
        self.as_(self.teacher)
        self.assertEqual(self.get("/org/people").status_code, 403)  # X-Org-Id ignored: not a member

        self.as_(self.hr)
        req = self.post("/compliance/requirements", {"course_id": str(self.fire.id), "name": "Fire", "renewal_months": 12,
                                                     "targets": [{}]})  # fmt: skip
        self.assertEqual(req.status_code, 200, req.content)
        rows = self.get("/compliance/matrix").json()["rows"]
        self.assertEqual(len(rows), 5)  # everyone, including the owner
        dash = self.get("/compliance/dashboard").json()
        self.assertEqual(dash["headcount"], 5)
        self.assertEqual(dash["people_overdue"], 0)  # nobody is past due on day one
        leeds = next(u for u in self.get("/org/units").json() if u["id"] == str(self.leeds.id))
        self.assertEqual(leeds["manager_ids"], [str(self.m_mgr.id)])

        # the manager sees only Leeds, and cannot look at the South
        self.as_(self.manager)
        names = [r["name"] for r in self.get("/compliance/matrix").json()["rows"]]
        self.assertEqual(names, ["=CMD()", "Mo Manager", "Sara Ahmed"])  # alphabetical
        page1 = self.get("/compliance/matrix?limit=2").json()
        page2 = self.get(f"/compliance/matrix?limit=2&cursor={page1['next_cursor']}").json()
        self.assertEqual([r["name"] for r in page1["rows"] + page2["rows"]], names)
        self.assertIsNone(page2["next_cursor"])
        self.assertEqual([u["name"] for u in self.get("/org/units").json()], ["Leeds"])  # only their units
        self.assertEqual(self.get(f"/compliance/matrix?unit_id={self.south.id}").status_code, 403)
        self.assertEqual(self.get(f"/compliance/people/{self.m_omar.id}").status_code, 404)
        self.assertEqual(self.post("/compliance/requirements", {"course_id": str(self.fire.id), "name": "Extra rule",
                                                                "targets": [{}]}).status_code, 403)  # fmt: skip
        sara_cell = next(
            r for r in self.get("/compliance/matrix").json()["rows"] if r["name"] == "Sara Ahmed"
        )
        status_id = next(iter(sara_cell["cells"].values()))["id"]
        self.assertEqual(self.post(f"/compliance/statuses/{status_id}/remind").status_code, 200)  # may nudge
        self.assertEqual(
            self.post(f"/compliance/statuses/{status_id}/exempt", {"reason": "nope"}).status_code, 403
        )
        self.assertEqual(len(mail.outbox), 1)

        # HR actions on one person
        self.as_(self.hr)
        due = (timezone.now() + timedelta(days=60)).isoformat()
        self.assertEqual(
            self.post(f"/compliance/statuses/{status_id}/extend", {"due_at": due}).status_code, 200
        )
        rec = self.post(f"/compliance/statuses/{status_id}/records",
                        {"completed_at": timezone.now().isoformat(), "note": "Paper certificate seen"}).json()  # fmt: skip
        person = self.get(f"/compliance/people/{self.m_sara.id}").json()
        self.assertEqual(person["requirements"][0]["status"], "compliant")
        self.post(f"/compliance/records/{rec['record_id']}/void", {"reason": "Wrong person"})
        self.assertEqual(self.get(f"/compliance/people/{self.m_sara.id}").json()["requirements"][0]["status"],
                         "not_started")  # fmt: skip

        # export: scoped, audited, and safe to open in Excel
        self.as_(self.manager)
        out = self.client.get(f"{API}/compliance/export.csv", **self.H)
        table = list(csv.reader(io.StringIO(b"".join(out.streaming_content).decode())))
        self.assertEqual(len(table), 1 + 3)  # header + the 3 Leeds people
        self.assertIn("'=CMD()", [row[0] for row in table])  # formula neutralised
        self.as_(self.hr)
        actions = [a["action"] for a in self.get("/org/audit").json()["items"]]
        for expected in ("requirement.create", "compliance.extend", "compliance.void", "compliance.export"):
            self.assertIn(expected, actions)
        self.as_(self.manager)
        self.assertEqual(self.get("/org/audit").status_code, 403)

        # the learner's own view
        self.as_(self.sara)
        mine = self.get("/compliance/my").json()
        self.assertEqual((mine[0]["requirement"], mine[0]["status"]), ("Fire", "not_started"))

        # an archived requirement leaves the matrix: no cells, no matches on its statuses
        self.as_(self.hr)
        self.assertEqual(
            self.client.delete(f"{API}/compliance/requirements/{req.json()['id']}", **self.H).status_code, 200
        )
        matrix = self.get("/compliance/matrix").json()
        self.assertEqual(matrix["requirements"], [])
        self.assertTrue(all(r["cells"] == {} for r in matrix["rows"]))
        self.assertEqual(self.get("/compliance/matrix?status=not_started").json()["rows"], [])

    def test_people_roles_invites_and_assigning(self):
        self.as_(self.hr)
        people = self.get("/org/people?q=sara").json()["items"]
        self.assertEqual([p["name"] for p in people], ["Sara Ahmed"])
        r = self.patch(
            f"/org/people/{self.m_sara.id}", {"unit_ids": [str(self.south.id)], "job_title": "Carer"}
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            self.get(f"/org/people?unit_id={self.south.id}").json()["items"][0]["units"], ["South"]
        )
        self.assertEqual(
            self.patch(f"/org/people/{self.hr_member().id}", {"role": "learner"}).status_code, 400
        )  # last owner

        # invites: one-time token, only for the invited address
        mail.outbox.clear()
        inv = self.post(
            "/org/invites", {"email": "New.Person@Acme.example.com", "unit_id": str(self.leeds.id)}
        )
        self.assertEqual(inv.status_code, 200, inv.content)
        token = mail.outbox[0].body.split("/invite/")[1].split()[0]
        self.client.logout()
        self.assertEqual(
            self.client.get(f"{API}/org/invitations/{token}").json(), {"org_name": "Acme", "role": "learner"}
        )
        self.as_(self.omar)
        self.assertEqual(self.client.post(f"{API}/org/invitations/{token}/accept").status_code, 403)
        newbie = User.objects.create_user("new.person@acme.example.com", "x", full_name="New Person")
        self.as_(newbie)
        self.assertEqual(self.client.post(f"{API}/org/invitations/{token}/accept").status_code, 200)
        self.assertEqual(
            self.client.post(f"{API}/org/invitations/{token}/accept").status_code, 404
        )  # used up
        self.assertEqual(
            [m["name"] for m in self.client.get(f"{API}/identity/me").json()["memberships"]], ["Acme"]
        )

        # assigning training: the manager's targets outside Leeds are ignored
        self.as_(self.manager)
        lib = self.get("/org/library").json()
        self.assertEqual([c["slug"] for c in lib], ["fire"])
        target = {
            "course_id": str(self.fire.id),
            "unit_ids": [str(self.leeds.id)],
            "member_ids": [str(self.m_omar.id)],
        }
        preview = self.post("/org/assign", {**target, "dry_run": True}).json()
        self.assertEqual(preview, {"enrolled": 3, "already_had_it": 0})  # counted, nothing written
        r = self.post("/org/assign", target).json()
        self.assertEqual(r["enrolled"], 3)
        self.assertEqual(
            self.post("/org/assign", {**target, "dry_run": True}).json()["already_had_it"], 3
        )  # Mo, the new person and "=CMD()" (Sara moved to the South)
        self.as_(newbie)
        self.assertIn(
            "course_assigned",
            [n["kind"] for n in self.client.get(f"{API}/engagement/notifications").json()["items"]],
        )

        # structure changes are admin-only
        self.as_(self.manager)
        self.assertEqual(self.post("/org/units", {"parent_id": str(self.north.id), "kind": "site",
                                                  "name": "York"}).status_code, 403)  # fmt: skip
        self.as_(self.hr)
        york = self.post(
            "/org/units", {"parent_id": str(self.north.id), "kind": "site", "name": "York"}
        ).json()
        self.assertEqual(
            self.client.delete(f"{API}/org/units/{self.leeds.id}", **self.H).status_code, 400
        )  # not empty
        self.assertEqual(self.client.delete(f"{API}/org/units/{york['id']}", **self.H).status_code, 200)

    def hr_member(self):
        with tenant_context(org_id=self.acme.id, user_id=self.hr.id):
            return OrgMember.objects.get(org=self.acme, user=self.hr)
