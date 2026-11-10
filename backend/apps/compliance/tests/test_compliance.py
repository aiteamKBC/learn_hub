"""Compliance: targeting, the full status lifecycle (with time travel), renewals,
exemptions, extensions, manual evidence, reminders, isolation and query budgets.
Runs as the real app role (lms_app) under request-like RLS context."""

from datetime import timedelta

from django.core import mail
from django.db import IntegrityError, connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.catalog import services as cat
from apps.compliance import engine, selectors, services
from apps.compliance.models import CompletionRecord, MemberStatus, Reminder
from apps.identity.models import User
from apps.learning import services as learning
from apps.learning.models import Enrollment
from apps.org import services as org_services
from apps.org.models import JobRole, OrgMember, OrgUnit
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

S = MemberStatus.Status
DAY = timedelta(days=1)


class ComplianceBase(SchemaTransactionTestCase):
    def setUp(self):
        self.hr = User.objects.create_user("hr@acme-demo.com", "x", full_name="Hana HR")
        self.sara = User.objects.create_user("sara@acme-demo.com", "x", full_name="Sara Ahmed")
        self.omar = User.objects.create_user("omar@acme-demo.com", "x", full_name="Omar Ali")
        self.bob = User.objects.create_user("bob@beta-demo.com", "x")
        self.acme = org_services.create_organization(name="Acme", slug="acme", owner=self.hr)
        self.beta = org_services.create_organization(name="Beta", slug="beta", owner=self.bob)
        self.ACME = {"org_id": self.acme.id, "user_id": self.hr.id}
        with tenant_context(**self.ACME):
            now = timezone.now()
            self.root = OrgUnit.objects.get(org=self.acme, parent__isnull=True)
            self.north = org_services.create_unit(parent=self.root, kind="region", name="North")
            self.leeds = org_services.create_unit(parent=self.north, kind="site", name="Leeds")
            self.south = org_services.create_unit(parent=self.root, kind="region", name="South")
            self.carer = JobRole.objects.create(org=self.acme, name="Carer")
            self.m_sara = OrgMember.objects.create(org=self.acme, user=self.sara, joined_at=now)
            self.m_omar = OrgMember.objects.create(org=self.acme, user=self.omar, joined_at=now)
            self.m_hr = OrgMember.objects.get(org=self.acme, user=self.hr)
            self.course = self.build_course("fire")

    def build_course(self, slug):
        course = cat.create_course(
            title=f"Course {slug}",
            slug=slug,
            ownership="organization",
            created_by=self.hr,
            owner_org_id=self.acme.id,
        )
        v = course.versions.get()
        sec = cat.add_section(version=v, title="Basics")
        cat.add_lecture(section=sec, kind="article", title="Read", body="<p>Exits</p>")
        cat.submit(version=v, by=self.hr)
        course.refresh_from_db()
        return course

    def admin_scope(self):
        from core.permissions import OrgRole, Scope

        return Scope(self.acme.id, OrgRole.OWNER, self.m_hr.id, None)

    def require(self, targets, **kw):
        with tenant_context(**self.ACME):
            return services.create_requirement(
                org_id=self.acme.id,
                course=kw.pop("course", self.course),
                name=kw.pop("name", "Fire Safety"),
                created_by=self.hr,
                targets=targets,
                **kw,
            )

    def status(self, member, req):
        with tenant_context(**self.ACME):
            return MemberStatus.objects.get(member=member, requirement=req)

    def assigned(self, req):
        with tenant_context(**self.ACME):
            return set(MemberStatus.objects.filter(requirement=req).values_list("member_id", flat=True))

    def finish_course(self, user, course=None):
        """The learner completes their current company enrolment (event path)."""
        course = course or self.course
        with tenant_context(org_id=self.acme.id, user_id=user.id):
            e = Enrollment.objects.exclude(status="superseded").get(org=self.acme, user=user, course=course)
            key = course.live_version.lectures.get().lecture_key
            learning.complete_lecture(enrollment=e, lecture_key=key)
        return e

    def refresh(self, now, member=None):
        with tenant_context(org_id=self.acme.id):
            return engine.refresh_org(self.acme.id, member_ids=[member.id] if member else None, now=now)


class TargetingTest(ComplianceBase):
    def test_units_subunits_roles_and_everyone(self):
        with tenant_context(**self.ACME):
            org_services.add_member_to_unit(member=self.m_sara, unit=self.leeds, primary=True)
            org_services.add_member_to_unit(member=self.m_omar, unit=self.south, primary=True)
            org_services.set_job_roles(member=self.m_omar, job_roles=[self.carer])

        north = self.require([{"unit_id": self.north.id}], name="North incl. sites")
        north_only = self.require([{"unit_id": self.north.id, "include_subunits": False}], name="North only")
        carers = self.require([{"job_role_id": self.carer.id}], name="Carers")
        south_carers = self.require(
            [{"unit_id": self.south.id, "job_role_id": self.carer.id}], name="South carers"
        )
        everyone = self.require([{}], name="Everyone")

        self.assertEqual(self.assigned(north), {self.m_sara.id})
        self.assertEqual(self.assigned(north_only), set())
        self.assertEqual(self.assigned(carers), {self.m_omar.id})
        self.assertEqual(self.assigned(south_carers), {self.m_omar.id})
        self.assertEqual(self.assigned(everyone), {self.m_sara.id, self.m_omar.id, self.m_hr.id})
        # assignment opens a company enrolment so the course shows in their learning
        with tenant_context(**self.ACME):
            self.assertTrue(
                Enrollment.objects.filter(org=self.acme, user=self.sara, course=self.course).exists()
            )

        # Sara moves to the South: event-driven re-assignment, no nightly wait
        with tenant_context(**self.ACME):
            org_services.remove_member_from_unit(member=self.m_sara, unit=self.leeds)
            org_services.add_member_to_unit(member=self.m_sara, unit=self.south, primary=True)
        self.assertEqual(self.assigned(north), set())
        # Moving Leeds under the South re-checks everyone
        with tenant_context(**self.ACME):
            org_services.add_member_to_unit(member=self.m_omar, unit=self.leeds)
            org_services.move_unit(unit=self.leeds, new_parent=self.south)
        self.assertEqual(self.assigned(north), set())

    def test_targets_must_belong_to_the_company(self):
        with tenant_context(org_id=self.beta.id, user_id=self.bob.id):
            beta_root = OrgUnit.objects.get(org=self.beta)
        with self.assertRaises(ServiceError):
            self.require([{"unit_id": beta_root.id}])
        with self.assertRaises(ServiceError):
            self.require([])


class LifecycleTest(ComplianceBase):
    def test_not_started_to_compliant_to_renewal(self):
        req = self.require([{}], renewal_months=12, due_days=30, expiring_soon_days=30)
        now = timezone.now()
        st = self.status(self.m_sara, req)
        self.assertEqual(st.status, S.NOT_STARTED)
        self.assertAlmostEqual(st.due_at, st.assigned_at + 30 * DAY, delta=timedelta(seconds=1))

        with tenant_context(**self.ACME):
            Enrollment.objects.filter(user=self.sara, course=self.course).update(progress_pct=40)
        self.refresh(now, self.m_sara)
        self.assertEqual(self.status(self.m_sara, req).status, S.IN_PROGRESS)

        self.refresh(now + 31 * DAY)
        self.assertEqual(self.status(self.m_sara, req).status, S.OVERDUE)

        first = self.finish_course(self.sara)  # completion event -> record -> status, no nightly wait
        st = self.status(self.m_sara, req)
        self.assertEqual(st.status, S.COMPLIANT)
        self.assertIsNone(st.due_override_at)
        self.assertEqual(  # renew every 12 months
            (st.expires_at.year, st.expires_at.month), (st.completed_at.year + 1, st.completed_at.month)
        )
        self.assertEqual(st.due_at, st.expires_at)

        # 20 days before expiry: expiring soon, and a renewal enrolment opens
        self.refresh(st.expires_at - 20 * DAY)
        self.assertEqual(self.status(self.m_sara, req).status, S.EXPIRING_SOON)
        with tenant_context(**self.ACME):
            enrols = dict(
                Enrollment.objects.filter(user=self.sara, course=self.course).values_list("id", "status")
            )
        self.assertEqual(enrols[first.id], "superseded")
        self.assertEqual(sorted(enrols.values()), ["active", "superseded"])

        self.refresh(st.expires_at + DAY)
        self.assertEqual(self.status(self.m_sara, req).status, S.EXPIRED)

        # Retake the renewal: compliant again, both certificates kept as evidence
        self.finish_course(self.sara)
        self.assertEqual(self.status(self.m_sara, req).status, S.COMPLIANT)
        with tenant_context(**self.ACME):
            self.assertEqual(CompletionRecord.objects.filter(member=self.m_sara, requirement=req).count(), 2)

    def test_one_off_requirement_and_earlier_completions_count(self):
        # Omar finished the course in the company BEFORE the rule existed
        with tenant_context(**self.ACME):
            learning.enrol(user=self.omar, course=self.course, source="organization", org_id=self.acme.id)
        self.finish_course(self.omar)
        req = self.require([{}], renewal_months=None)
        st = self.status(self.m_omar, req)
        self.assertEqual(st.status, S.COMPLIANT)
        self.assertIsNone(st.expires_at)
        self.assertIsNone(st.due_at)
        self.refresh(timezone.now() + 3650 * DAY)
        self.assertEqual(self.status(self.m_omar, req).status, S.COMPLIANT)

    def test_personal_certificate_never_counts_automatically(self):
        # A public platform course Sara bought herself, and Acme also requires
        staff = User.objects.create_user("staff@learnhub-demo.com", "x", is_staff=True)
        with tenant_context(user_id=staff.id, staff=True):
            public = cat.create_course(
                title="Public fire", slug="pub", ownership="platform", created_by=staff
            )
            sec = cat.add_section(version=public.versions.get(), title="Basics")
            cat.add_lecture(section=sec, kind="article", title="Read", body="<p>Exits</p>")
            cat.submit(version=public.versions.get(), by=staff)
            public.refresh_from_db()
        req = self.require([{}], renewal_months=12, course=public)
        with tenant_context(user_id=self.sara.id):
            personal = learning.enrol(user=self.sara, course=public, source="purchase")
            key = public.live_version.lectures.get().lecture_key
            learning.complete_lecture(enrollment=personal, lecture_key=key)
        self.refresh(timezone.now())
        self.assertEqual(self.status(self.m_sara, req).status, S.NOT_STARTED)
        # and the database itself refuses a record that cites the personal enrolment
        with self.assertRaises(IntegrityError), tenant_context(**self.ACME):
            CompletionRecord.objects.create(
                org=self.acme,
                requirement=req,
                member=self.m_sara,
                source="course",
                completed_at=timezone.now(),
                enrollment_id=personal.id,
            )


class HrActionsTest(ComplianceBase):
    def test_extend_exempt_manual_and_void(self):
        req = self.require([{}], renewal_months=24)
        st = self.status(self.m_sara, req)
        with tenant_context(**self.ACME):
            new_due = timezone.now() + 60 * DAY
            services.extend_deadline(status=st, due_at=new_due)
            self.assertEqual(st.due_at, new_due)
            with self.assertRaises(ServiceError):
                services.extend_deadline(status=st, due_at=timezone.now() - DAY)

            ex = services.grant_exemption(status=st, reason="On maternity leave", granted_by=self.hr)
            self.assertEqual(MemberStatus.objects.get(pk=st.pk).status, S.EXEMPT)
            services.revoke_exemption(exemption=ex)
            self.assertEqual(MemberStatus.objects.get(pk=st.pk).status, S.NOT_STARTED)

            done = timezone.now() - 10 * DAY
            rec = services.record_manual_completion(
                status=st, completed_at=done, recorded_by=self.hr, note="External certificate seen"
            )
            st.refresh_from_db()
            self.assertEqual(st.status, S.COMPLIANT)
            self.assertIsNone(st.due_override_at)  # new cycle clears the extension
            self.assertEqual(rec.expires_at.year, done.year + 2)

            services.void_record(record=rec, reason="Certificate was forged")
            st.refresh_from_db()
            self.assertEqual(st.status, S.NOT_STARTED)
            self.assertTrue(CompletionRecord.objects.filter(pk=rec.pk, voided_at__isnull=False).exists())

    def test_person_view_lists_units_roles_and_links_records_to_requirements(self):
        req = self.require([{}])
        with tenant_context(**self.ACME):
            org_services.add_member_to_unit(member=self.m_sara, unit=self.leeds, primary=True)
            org_services.set_job_roles(member=self.m_sara, job_roles=[self.carer])
            st = MemberStatus.objects.get(member=self.m_sara, requirement=req)
            ex = services.grant_exemption(status=st, reason="Long-term leave", granted_by=self.hr)
            services.revoke_exemption(exemption=ex)
            p = selectors.person(self.admin_scope(), self.m_sara.id)
        self.assertEqual([u.unit_id for u in p["units"]], [self.leeds.id])
        self.assertEqual([r.job_role_id for r in p["job_roles"]], [self.carer.id])
        self.assertEqual(p["exemptions"][0].requirement_id, req.id)
        self.assertIsNotNone(p["exemptions"][0].revoked_at)  # history keeps revoked exemptions


class RemindersTest(ComplianceBase):
    def test_thresholds_are_idempotent_and_overdue_repeats(self):
        req = self.require([{"unit_id": self.root.id, "include_subunits": False}], due_days=30)  # HR only
        st = self.status(self.m_hr, req)
        due = st.due_at
        cases = [
            (due - 20 * DAY, 0),  # not yet within 14 days
            (due - 10 * DAY, 1),  # 14-day reminder
            (due - 9 * DAY, 0),  # already sent
            (due - 2 * DAY, 1),  # 3-day reminder
            (due + DAY, 1),  # overdue #0
            (due + 3 * DAY, 0),
            (due + 8 * DAY, 1),  # overdue #1 (every 7 days)
        ]
        mail.outbox.clear()
        for when, expected in cases:
            result = self.refresh(when)
            self.assertEqual(len(result["reminders"]), expected, when - due)
            if result["reminders"]:
                from apps.compliance.tasks import deliver_reminders_task

                deliver_reminders_task(str(self.acme.id), [str(r) for r in result["reminders"]])
        self.assertEqual(len(mail.outbox), 4)
        self.assertEqual(mail.outbox[0].to, ["hr@acme-demo.com"])
        self.assertIn("Fire Safety", mail.outbox[0].subject)
        with tenant_context(**self.ACME):
            self.assertEqual(
                sorted(Reminder.objects.values_list("kind", "step")),
                [("due_soon", 3), ("due_soon", 14), ("overdue", 0), ("overdue", 1)],
            )
            self.assertFalse(Reminder.objects.filter(sent_at__isnull=True).exists())

    def test_manual_nudge_once_a_day(self):
        req = self.require([{}])
        st = self.status(self.m_sara, req)
        mail.outbox.clear()
        with tenant_context(**self.ACME):
            services.send_reminder(status=st, sent_by=self.hr)
        self.assertEqual(len(mail.outbox), 1)
        with self.assertRaises(ServiceError), tenant_context(**self.ACME):
            services.send_reminder(status=st, sent_by=self.hr)


class IsolationAndScaleTest(ComplianceBase):
    def test_other_company_sees_nothing(self):
        req = self.require([{}])
        with tenant_context(org_id=self.beta.id, user_id=self.bob.id):
            self.assertEqual(MemberStatus.objects.count(), 0)
            self.assertEqual(CompletionRecord.objects.count(), 0)
            with connection.cursor() as cur:
                cur.execute("SELECT count(*) FROM compliance.requirements")
                self.assertEqual(cur.fetchone()[0], 0)
        # engine run for Beta cannot touch Acme's rows even if asked to
        with tenant_context(org_id=self.beta.id):
            self.assertEqual(engine.recompute(self.acme.id, now=timezone.now() + 90 * DAY), 0)
        self.assertEqual(self.status(self.m_sara, req).status, S.NOT_STARTED)

    def test_matrix_and_summary_use_fixed_queries(self):
        with tenant_context(**self.ACME):
            for i in range(25):
                u = User.objects.create_user(f"p{i}@acme-demo.com", "x")
                m = OrgMember.objects.create(org=self.acme, user=u, joined_at=timezone.now())
                org_services.add_member_to_unit(member=m, unit=self.leeds, primary=True)
        self.require([{}], name="A")
        self.require([{"unit_id": self.north.id}], name="B", course=self.build_course_ctx("b"))
        with tenant_context(**self.ACME):
            with CaptureQueriesContext(connection) as q:
                page = selectors.matrix(self.admin_scope(), unit=self.north, limit=10)
            self.assertLessEqual(len(q), 3)
            self.assertEqual(len(page["rows"]), 10)
            self.assertIsNotNone(page["next"])
            self.assertEqual(len(page["rows"][0]["cells"]), 2)
            with CaptureQueriesContext(connection) as q:
                rows = selectors.summary(self.admin_scope())
            self.assertEqual(len(q), 1)
            a = next(r for r in rows if r["requirement__name"] == "A")
            self.assertEqual(a["total"], 28)
            self.assertEqual(a["compliance_pct"], 0.0)

    def build_course_ctx(self, slug):
        with tenant_context(**self.ACME):
            return self.build_course(slug)
