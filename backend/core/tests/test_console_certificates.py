"""M5 P13 console certificates: templates (create, validate, default, switch per course,
preview), the template driving the PDF, issued list / export / verify, revoke and expiry
(with /verify showing them) and the expiry reminder job."""

import csv
import io
from datetime import timedelta
from unittest import mock

from django.utils import timezone

from apps.catalog import certificates as templates
from apps.catalog.models import CertificateTemplate, Course
from apps.engagement.models import Notification
from apps.learning import services as learning
from apps.learning.certificate_pdf import render
from apps.learning.models import Certificate
from apps.platform.models import AuditLog
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1/console"


class ConsoleCertificatesTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()
        f.money(self.staff)
        self.course = f.course(
            staff=self.staff, owner=self.teacher, slug="git", title="Git Basics", free=True
        )
        with tenant_context(user_id=self.sara.id):
            e = learning.enrol(user=self.sara, course=self.course, source="free")
            self.cert = learning.complete_course(e)
        self.client.force_login(self.staff)

    def post(self, path, data=None):
        return self.client.post(API + path, data=data or {}, content_type="application/json")

    def put(self, path, data):
        return self.client.put(API + path, data=data, content_type="application/json")

    def get(self, path):
        return self.client.get(API + path)

    def staff_read(self, fn):
        with tenant_context(staff=True):
            return fn()

    def test_templates_default_and_course_switch_drive_the_pdf(self):
        self.assertEqual(self.post("/certificates/templates", {"name": "Bad", "layout": {"primary": "blue"}}).status_code,
                         422)  # fmt: skip
        a = self.post("/certificates/templates", {"name": "LearnHub Standard", "signatory_name": "Ayman Badewi",
                                                  "signatory_title": "Platform Administrator"}).json()  # fmt: skip
        self.assertEqual((a["status"], a["type"]), ("active", "platform"))
        b = self.post("/certificates/templates", {"name": "Modern purple",
                                                  "layout": {"style": "modern", "primary": "#7C3AED",
                                                             "heading": "Certificate of Achievement"},
                                                  "show_qr_code": False}).json()  # fmt: skip
        self.assertEqual(self.post(f"/certificates/templates/{a['id']}/default").status_code, 200)
        self.assertEqual(
            templates.template_for(Course.objects.get(pk=self.course.id)).name, "LearnHub Standard"
        )
        rows = {t["name"]: t for t in self.get("/certificates/templates").json()}
        self.assertEqual(rows["LearnHub Standard"]["courses"], 1)  # every course without its own

        # switching the course's template changes the PDF learners download
        self.assertEqual(self.put(f"/courses/{self.course.id}/certificate-template", {"template_id": b["id"]}).status_code,
                         200)  # fmt: skip
        self.assertEqual(templates.template_for(Course.objects.get(pk=self.course.id)).name, "Modern purple")
        with mock.patch("apps.learning.certificate_pdf.render", wraps=render) as spy:
            self.client.force_login(self.sara)
            r = self.client.get(f"/api/v1/learning/certificates/{self.cert.id}/pdf")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(spy.call_args.args[1].name, "Modern purple")
        self.client.force_login(self.staff)

        # archiving the course's template falls back to the default
        self.post(f"/certificates/templates/{b['id']}/archive")
        self.assertEqual(
            templates.template_for(Course.objects.get(pk=self.course.id)).name, "LearnHub Standard"
        )
        self.assertEqual(
            self.post(f"/certificates/templates/{a['id']}/archive").status_code, 400
        )  # the default

        dup = self.post(f"/certificates/templates/{a['id']}/duplicate").json()["id"]
        self.assertEqual(CertificateTemplate.objects.get(pk=dup).name, "Copy of LearnHub Standard")
        prev = self.get(f"/certificates/templates/{a['id']}/preview.pdf")
        self.assertTrue(prev.content.startswith(b"%PDF"))
        actions = self.staff_read(lambda: set(AuditLog.objects.filter(action__startswith="certificate_template.")
                                              .values_list("action", flat=True)))  # fmt: skip
        self.assertTrue({"certificate_template.create", "certificate_template.default"} <= actions)

    def test_every_style_renders(self):
        for style in ("classic", "modern", "minimal"):
            t = mock.Mock(layout={"style": style}, signatory_name="A B", signatory_title="CEO", signature_image_url="",
                          show_qr_code=style != "minimal")  # fmt: skip
            self.assertTrue(render(self.cert, t).startswith(b"%PDF"))
        self.assertTrue(render(self.cert, None).startswith(b"%PDF"))  # no template: M2 look

    def test_revoke_and_expiry_show_on_verify(self):
        code = self.cert.verification_code
        self.assertEqual(self.post(f"/certificates/{self.cert.id}/revoke", {"reason": ""}).status_code, 422)
        self.assertEqual(self.post(f"/certificates/{self.cert.id}/revoke", {"reason": "Issued by mistake"}).json(),
                         {"status": "revoked"})  # fmt: skip
        self.assertEqual(
            self.post(f"/certificates/{self.cert.id}/revoke", {"reason": "Again"}).status_code, 400
        )
        self.client.logout()
        v = self.client.get(f"/api/v1/learning/verify/{code}").json()
        self.assertTrue(v["is_revoked"])
        self.client.force_login(self.sara)
        self.assertEqual(self.client.get("/api/v1/learning/my/certificates").json(), [])
        kinds = self.staff_read(
            lambda: list(Notification.objects.filter(user=self.sara).values_list("kind", flat=True))
        )
        self.assertIn("certificate_revoked", kinds)
        self.client.force_login(self.staff)
        self.assertEqual(
            self.put(f"/certificates/{self.cert.id}/expiry", {"expires_at": None}).status_code, 400
        )

    def test_expiry_verify_and_reminders(self):
        past = timezone.now() - timedelta(days=1)
        with tenant_context(staff=True):  # issued a while ago
            Certificate.objects.filter(pk=self.cert.id).update(issued_at=timezone.now() - timedelta(days=400))
            self.cert.refresh_from_db()
        self.assertEqual(self.put(f"/certificates/{self.cert.id}/expiry",
                                  {"expires_at": (self.cert.issued_at - timedelta(days=1)).isoformat()}).status_code, 400)  # fmt: skip
        self.assertEqual(self.put(f"/certificates/{self.cert.id}/expiry", {"expires_at": past.isoformat()}).json(),
                         {"status": "expired"})  # fmt: skip
        v = self.client.get(f"/api/v1/learning/verify/{self.cert.verification_code}").json()
        self.assertTrue(v["is_expired"])
        self.assertFalse(v["is_revoked"])

        soon = timezone.now() + timedelta(days=10)
        self.assertEqual(self.put(f"/certificates/{self.cert.id}/expiry", {"expires_at": soon.isoformat()}).json(),
                         {"status": "expiring"})  # fmt: skip
        with tenant_context(staff=True):
            self.assertEqual(learning.certificate_expiry_reminders(), 1)
            learning.certificate_expiry_reminders()  # a second run never notifies twice
            self.assertEqual(
                Notification.objects.filter(user=self.sara, kind="certificate_expiring").count(), 1
            )
        k = self.get("/certificates/overview").json()
        self.assertEqual((k["expiring_soon"], k["issued_total"]), (1, 1))
        self.assertTrue(
            self.staff_read(lambda: AuditLog.objects.filter(action="certificate.expiry").exists())
        )

    def test_issued_list_filters_export_and_verify(self):
        r = self.get("/certificates/issued?q=sara").json()
        self.assertEqual(r["items"][0]["code"], self.cert.verification_code)
        self.assertEqual(r["items"][0]["status"], "valid")
        self.assertEqual(self.get("/certificates/issued?status=revoked").json()["items"], [])
        self.assertEqual(self.get("/certificates/issued?status=nope").status_code, 400)
        out = self.get("/certificates/issued.csv")
        rows = list(csv.reader(io.StringIO(b"".join(out.streaming_content).decode())))
        self.assertEqual(rows[0][0], "Certificate ID")
        self.assertEqual(rows[1][0], self.cert.verification_code)
        ok = self.get(f"/certificates/verify?code={self.cert.verification_code.lower()}").json()
        self.assertEqual((ok["found"], ok["status"]), (True, "valid"))
        self.assertFalse(self.get("/certificates/verify?code=NOPE").json()["found"])
        pdf = self.get(f"/certificates/{self.cert.id}/pdf")
        self.assertTrue(pdf.content.startswith(b"%PDF"))

    def test_issue_uses_the_default_template(self):
        t = templates.create_template(by=self.staff, name="House style")
        with tenant_context(staff=True):
            templates.set_default(template=t)
        self.assertIsNone(
            self.staff_read(lambda: Certificate.objects.get(pk=self.cert.id).template_id)
        )  # earlier one
        omar_course = f.course(staff=self.staff, owner=self.teacher, slug="sql", title="SQL", free=True)
        with tenant_context(user_id=self.omar.id):
            e = learning.enrol(user=self.omar, course=omar_course, source="free")
            cert = learning.complete_course(e)
        self.assertEqual(cert.template_id, t.id)

    def test_non_staff_refused(self):
        self.client.force_login(self.teacher)
        self.assertEqual(
            self.post(f"/certificates/{self.cert.id}/revoke", {"reason": "nope nope"}).status_code, 403
        )
        self.assertEqual(self.get("/certificates/issued.csv").status_code, 403)
        self.assertIsNone(self.staff_read(lambda: Certificate.objects.get(pk=self.cert.id).revoked_at))
