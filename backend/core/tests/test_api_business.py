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
        self.assertEqual(
            preview, {"enrolled": 3, "already_had_it": 0, "seats": None}
        )  # counted, nothing written
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

    # ------------------------------------------------------------ People: units, bulk actions
    def test_view_members_direct_and_inside(self):
        self.as_(self.hr)
        inside = {p["name"] for p in self.get(f"/org/people?unit_id={self.north.id}").json()["items"]}
        self.assertEqual(inside, {"Sara Ahmed", "=CMD()", "Mo Manager"})  # Leeds is inside North
        self.assertEqual(self.get(f"/org/people?unit_id={self.north.id}&direct=true").json()["items"], [])
        direct = {
            p["name"] for p in self.get(f"/org/people?unit_id={self.leeds.id}&direct=true").json()["items"]
        }
        self.assertEqual(direct, inside)
        self.assertEqual(self.get("/org/people?unit_id=not-a-uuid").status_code, 404)

    def test_move_people_keeps_history_and_stays_in_company(self):
        from apps.learning.models import Enrollment
        from apps.org.models import MemberUnit

        self.as_(self.hr)
        self.assertEqual(self.post("/org/assign", {"course_id": str(self.fire.id),
                                                   "member_ids": [str(self.m_sara.id)]}).status_code, 200)  # fmt: skip
        with tenant_context(org_id=self.acme.id, user_id=self.hr.id):
            extra = org_services.add_member_to_unit(member=self.m_sara, unit=self.south)  # an additional unit
            enrolments = Enrollment.objects.filter(user=self.sara, org=self.acme).count()
        ids = [str(self.m_sara.id), str(self.m_omar.id)]
        r = self.post("/org/people/move", {"member_ids": ids, "unit_id": str(self.north.id)})
        self.assertEqual(r.json(), {"moved": 2, "unchanged": 0}, r.content)
        self.assertEqual(self.post("/org/people/move", {"member_ids": ids, "unit_id": str(self.north.id)}).json(),
                         {"moved": 0, "unchanged": 2})  # fmt: skip
        with tenant_context(org_id=self.acme.id, user_id=self.hr.id):
            links = {(u.unit_id, u.is_primary) for u in MemberUnit.objects.filter(member=self.m_sara)}
            self.assertEqual(links, {(self.north.id, True), (extra.unit_id, False)})  # Leeds gone, South kept
            self.assertEqual(Enrollment.objects.filter(user=self.sara, org=self.acme).count(), enrolments)
            self.assertEqual(OrgMember.objects.get(pk=self.m_sara.pk).role, "learner")
        self.assertIn("member.move", [a["action"] for a in self.get("/org/audit").json()["items"]])

        # another company's unit or person: refused, nothing moves
        beta = org_services.create_organization(name="Beta", slug="beta", owner=self.teacher)
        with tenant_context(org_id=beta.id, user_id=self.teacher.id):
            beta_root = OrgUnit.objects.get(org=beta, parent__isnull=True)
            beta_member = OrgMember.objects.get(org=beta, user=self.teacher)
        self.assertEqual(
            self.post("/org/people/move", {"member_ids": ids, "unit_id": str(beta_root.id)}).status_code, 404
        )
        self.assertEqual(self.post("/org/people/move", {"member_ids": [str(beta_member.id)],
                                                        "unit_id": str(self.south.id)}).status_code, 404)  # fmt: skip
        # managers cannot move people
        self.as_(self.manager)
        self.assertEqual(
            self.post("/org/people/move", {"member_ids": ids, "unit_id": str(self.south.id)}).status_code, 403
        )

    def test_bulk_remind_and_export_selected(self):
        self.as_(self.hr)
        self.post(
            "/compliance/requirements", {"course_id": str(self.fire.id), "name": "Fire", "targets": [{}]}
        )
        ids = [str(self.m_sara.id), str(self.m_omar.id)]
        mail.outbox.clear()
        first = self.post("/org/people/remind", {"member_ids": ids}).json()
        self.assertEqual((first["sent"], first["skipped"], first["failed"]), (2, 0, 0))
        self.assertEqual(len(mail.outbox), 2)  # through the existing reminder delivery
        again = self.post("/org/people/remind", {"member_ids": ids}).json()
        self.assertEqual((again["sent"], again["skipped"]), (0, 2))  # once a day, never doubled

        rows = self.post("/org/people/rows", {"member_ids": ids}).json()["items"]
        self.assertEqual([r["name"] for r in rows], ["Omar", "Sara Ahmed"])
        self.assertEqual(rows[1]["units"], ["Leeds"])
        # a manager only gets their own people (Omar is in the South)
        self.as_(self.manager)
        self.assertEqual(self.post("/org/people/rows", {"member_ids": ids}).status_code, 404)
        self.assertEqual(
            self.post("/org/people/rows", {"member_ids": [str(self.m_sara.id)]}).status_code, 200
        )

    # ------------------------------------------------------------ invitations: resend and lifecycle
    def test_invite_resend_and_statuses(self):
        from apps.org.models import Invite

        self.as_(self.hr)
        mail.outbox.clear()
        inv = self.post(
            "/org/invites", {"email": "new@acme.example.com", "unit_id": str(self.leeds.id)}
        ).json()
        self.assertEqual((inv["status"], inv["unit_name"]), ("pending", "Leeds"))
        self.assertEqual(self.post(f"/org/invites/{inv['id']}/resend").status_code, 429)  # too soon

        def age(invite_id, **kw):
            with tenant_context(org_id=self.acme.id, user_id=self.hr.id):
                Invite.objects.filter(pk=invite_id).update(**kw)

        age(inv["id"], created_at=timezone.now() - timedelta(minutes=10),
            expires_at=timezone.now() - timedelta(minutes=1))  # fmt: skip
        self.assertEqual([i["id"] for i in self.get("/org/invites").json()], [])  # expired: not pending
        self.assertEqual([i["status"] for i in self.get("/org/invites?status=expired").json()], ["expired"])
        old_token = mail.outbox[0].body.split("/invite/")[1].split()[0]
        again = self.post(f"/org/invites/{inv['id']}/resend")
        self.assertEqual(again.status_code, 200, again.content)
        new = again.json()
        self.assertNotEqual(new["id"], inv["id"])
        self.assertEqual((new["status"], new["unit_name"]), ("pending", "Leeds"))
        self.assertEqual([i["id"] for i in self.get("/org/invites").json()], [new["id"]])  # one active invite
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(
            self.client.get(f"{API}/org/invitations/{old_token}").status_code, 404
        )  # old link dead
        history = {i["id"]: i["status"] for i in self.get("/org/invites?status=history").json()}
        self.assertEqual(history, {inv["id"]: "revoked"})
        self.assertEqual(
            self.post(f"/org/invites/{inv['id']}/resend").status_code, 409
        )  # revoked: never reused

        # accepted: cannot be resent
        token = mail.outbox[1].body.split("/invite/")[1].split()[0]
        newbie = User.objects.create_user("new@acme.example.com", "x", full_name="New Person")
        self.as_(newbie)
        self.assertEqual(self.client.post(f"{API}/org/invitations/{token}/accept").status_code, 200)
        self.as_(self.hr)
        age(new["id"], created_at=timezone.now() - timedelta(minutes=10))
        self.assertEqual(self.post(f"/org/invites/{new['id']}/resend").status_code, 409)
        self.assertEqual([i["status"] for i in self.get("/org/invites?status=accepted").json()], ["accepted"])
        self.assertEqual(self.get("/org/invites?status=bogus").status_code, 400)

    # ------------------------------------------------------------ company logo upload
    def test_logo_upload_checks_content_and_stays_in_company(self):
        from unittest import mock

        from apps.org import logos

        png = b"\x89PNG\r\n\x1a\n" + b"0" * 100
        store = {}
        patches = [
            mock.patch("core.storage.configured", return_value=True),
            mock.patch("core.storage.upload_url", side_effect=lambda k: f"https://blob.test/{k}?sas=w"),
            mock.patch("core.storage.download_url", side_effect=lambda k, *a: f"https://blob.test/{k}?sas=r"),
            mock.patch("core.storage.properties", side_effect=lambda k: {"size": len(store[k]), "content_type": ""} if k in store else None),
            mock.patch("core.storage.read", side_effect=lambda k, n: store[k][:n]),
            mock.patch("core.storage.delete", side_effect=lambda k: store.pop(k, None)),
        ]  # fmt: skip
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

        def upload(name, data):
            r = self.post("/org/company/logo/upload", {"filename": name, "size_bytes": len(data)})
            if r.status_code != 200:
                return r
            store[f"org-logos/{self.acme.id}/{r.json()['key']}"] = data
            return self.post("/org/company/logo/confirm", {"key": r.json()["key"]})

        self.as_(self.hr)
        # wrong type by name, too big, and content that is not what the name says
        self.assertEqual(upload("logo.gif", png).status_code, 400)
        self.assertEqual(upload("logo.png", b"x" * (logos.LIMIT + 1)).status_code, 400)
        self.assertEqual(upload("logo.png", b"<html>not an image</html>").status_code, 400)
        self.assertEqual(
            upload(
                "logo.svg", b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
            ).status_code,
            400,
        )
        self.assertEqual(upload("logo.svg", b'<svg onload="x()"></svg>').status_code, 400)
        self.assertEqual(store, {})  # refused files are deleted
        # a clean SVG and a real PNG are fine; nothing is live until the branding is saved
        self.assertEqual(
            upload(
                "logo.svg", b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>'
            ).status_code,
            200,
        )
        first = upload("logo.png", png).json()["url"]
        self.assertTrue(first.startswith(f"/api/v1/org/logos/{self.acme.id}/"))
        self.assertEqual(self.get("/org/company").json()["logo_url"], "")
        self.assertEqual(self.client.put(f"{API}/org/company/branding", data={"logo_url": first, "primary_color": "#0f766e",
                         "accent_color": ""}, content_type="application/json", **self.H).status_code, 200)  # fmt: skip
        self.assertEqual(self.get("/org/company").json()["logo_url"], first)
        # the path serves the image through a short signed link
        r = self.client.get(first)
        self.assertEqual(r.status_code, 302)
        self.assertIn("sas=r", r["Location"])
        # replacing it removes the old file; an https link still works (backwards compatible)
        second = upload("logo.png", png).json()["url"]
        self.client.put(f"{API}/org/company/branding", data={"logo_url": second, "primary_color": "", "accent_color": ""},
                        content_type="application/json", **self.H)  # fmt: skip
        self.assertNotIn(f"org-logos/{self.acme.id}/{first.rsplit('/', 1)[-1]}", store)
        ok = self.client.put(f"{API}/org/company/branding", data={"logo_url": "https://cdn.example.com/l.png",
                             "primary_color": "", "accent_color": ""}, content_type="application/json", **self.H)  # fmt: skip
        self.assertEqual(ok.status_code, 200)

        # another company's uploaded path cannot be saved as ours; managers cannot upload
        other = f"/api/v1/org/logos/{OrgUnit.objects.none().model.__name__ and self.acme.id}x/{'a' * 32}.png"
        beta = org_services.create_organization(name="Beta", slug="beta", owner=self.teacher)
        foreign = f"/api/v1/org/logos/{beta.id}/{'a' * 32}.png"
        for bad in (foreign, other, "/api/v1/org/logos/../x.png", "http://insecure.example.com/l.png"):
            r = self.client.put(f"{API}/org/company/branding", data={"logo_url": bad, "primary_color": "", "accent_color": ""},
                                content_type="application/json", **self.H)  # fmt: skip
            self.assertEqual(r.status_code, 400, bad)
        self.as_(self.manager)
        self.assertEqual(
            self.post("/org/company/logo/upload", {"filename": "l.png", "size_bytes": 10}).status_code, 403
        )
