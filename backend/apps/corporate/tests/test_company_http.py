"""Company-facing corporate endpoints over HTTP, as the app role (RLS on).

The other corporate tests call services directly; these go through the middleware, so
they see exactly what a company admin's browser would see.
"""

import uuid
from datetime import timedelta
from decimal import Decimal
from unittest.mock import MagicMock

from django.utils import timezone

from apps.catalog.models import Category, Course, CourseVersion
from apps.commerce.models import PriceTier
from apps.corporate.live import add_company_to_cohort, confirm_cohort, create_cohort
from apps.corporate.models import CorporateOffering, SeatPurchase
from apps.corporate.scheduling import add_session
from apps.corporate.services import allocate_seat
from apps.identity.models import User
from apps.learning.models import Enrollment
from apps.org.models import Organization, OrgMember
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1/corporate"


class CompanyHttpTest(SchemaTransactionTestCase):
    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        now = timezone.now()
        with tenant_context(staff=True):
            self.staff = User.objects.create_user(f"http-staff-{tag}@test.com", "x", is_staff=True)
            self.org = Organization.objects.create(name=f"Http {tag}", slug=f"http-{tag}", status="active")
            self.admin = User.objects.create_user(f"http-admin-{tag}@test.com", "x")
            self.emp = User.objects.create_user(f"http-emp-{tag}@test.com", "x")
            OrgMember.objects.create(org=self.org, user=self.admin, role="admin", joined_at=now)
            OrgMember.objects.create(org=self.org, user=self.emp, role="learner", joined_at=now)
            cat = Category.objects.create(slug=f"http-cat-{tag}", name=f"Cat {tag}", sort_order=0)
            self.course = Course.objects.create(
                ownership="platform",
                status="published",
                created_by=self.staff,
                category=cat,
                slug=f"http-c-{tag}",
                title=f"Http Course {tag}",
            )
            v = CourseVersion.objects.create(course=self.course, number=1, status="published")
            self.course.live_version = v
            self.course.save(update_fields=["live_version"])
            tier = PriceTier.objects.create(name=f"HttpTier-{tag}", gbp_minor=10000, sort_order=0)
            self.live = CorporateOffering.objects.create(
                course=self.course, delivery_type="live", price_tier=tier, is_active=True
            )
            self.recorded = CorporateOffering.objects.create(
                course=self.course, delivery_type="recorded", price_tier=tier, is_active=True
            )

    def _staff_req(self):
        req = MagicMock()
        req.user = req.auth = self.staff
        req.org_id = None
        req.META = {"REMOTE_ADDR": "127.0.0.1"}
        return req

    def _get(self, path, user=None):
        self.client.force_login(user or self.admin)
        return self.client.get(f"{API}{path}", HTTP_X_ORG_ID=str(self.org.id))

    def _confirmed_booking(self):
        req = self._staff_req()
        with tenant_context(staff=True):
            cohort = create_cohort(req, course_id=self.course.id, delivery_mode="online", max_learners=10)
            start = timezone.now() + timedelta(days=7)
            add_session(req, cohort.id, sequence=1, scheduled_at=start, duration_min=60)
            add_session(req, cohort.id, sequence=2, scheduled_at=start + timedelta(days=7), duration_min=60)
            add_company_to_cohort(req, cohort.id, self.org.id, 3)
            confirm_cohort(req, cohort.id)
        return cohort

    def test_live_bookings_visible_to_company_admin(self):
        self._confirmed_booking()
        r = self._get("/live-bookings")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(r.json()), 1, "the company's own booking must be listed")

    def test_schedule_visible_to_company_admin(self):
        self._confirmed_booking()
        bookings = self._get("/live-bookings").json()
        self.assertTrue(bookings, "no booking listed")
        r = self._get(f"/live-bookings/{bookings[0]['id']}/schedule")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(r.json()), 2, "an admin sees the whole agreed schedule")

    def test_employee_progress_with_fractional_progress(self):
        with tenant_context(staff=True):
            sp = SeatPurchase.objects.create(
                org=self.org,
                offering=self.recorded,
                buyer=self.admin,
                quantity=2,
                unit_price_minor=10000,
                currency="GBP",
                total_minor=20000,
                gbp_total_minor=20000,
                status="paid",
                paid_at=timezone.now(),
            )
            req = self._staff_req()
            req.org_id = self.org.id
            alloc = allocate_seat(req, sp.id, self.emp.id)
            Enrollment.objects.filter(pk=alloc.enrollment_id).update(progress_pct=Decimal("33.33"))
        r = self._get("/employee-progress")
        self.assertEqual(r.status_code, 200, r.content[:300])
        self.assertEqual(len(r.json()), 1)

    # ------------------------------------------------------------ recorded seats

    def _paid_recorded(self, qty=1):
        with tenant_context(staff=True):
            return SeatPurchase.objects.create(
                org=self.org, offering=self.recorded, buyer=self.admin, quantity=qty,
                unit_price_minor=10000, currency="GBP", total_minor=10000 * qty,
                gbp_total_minor=10000 * qty, status="paid", paid_at=timezone.now(),
            )  # fmt: skip

    def _post(self, path, body, user=None):
        self.client.force_login(user or self.admin)
        return self.client.post(
            f"{API}{path}", body, content_type="application/json", HTTP_X_ORG_ID=str(self.org.id)
        )

    def test_company_allocates_paid_seat_and_runs_out(self):
        self._paid_recorded(qty=1)
        r = self._post("/allocations", {"offering_id": str(self.recorded.id), "user_id": str(self.emp.id)})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "active")
        again = self._post(
            "/allocations", {"offering_id": str(self.recorded.id), "user_id": str(self.emp.id)}
        )
        self.assertEqual(again.json()["error"]["code"], "already_allocated")
        r2 = self._post("/allocations", {"offering_id": str(self.recorded.id), "user_id": str(self.admin.id)})
        self.assertEqual(r2.json()["error"]["code"], "no_seats_available")
        listed = self._get("/allocations").json()
        self.assertEqual([a["user_email"] for a in listed], [self.emp.email])

    def test_learner_cannot_allocate(self):
        self._paid_recorded()
        r = self._post(
            "/allocations", {"offering_id": str(self.recorded.id), "user_id": str(self.emp.id)}, self.emp
        )
        self.assertEqual(r.status_code, 403)

    def test_live_offering_is_not_allocated_as_recorded(self):
        r = self._post("/allocations", {"offering_id": str(self.live.id), "user_id": str(self.emp.id)})
        self.assertEqual(r.json()["error"]["code"], "live_offering")

    # ------------------------------------------------------------ live attendees and the employee view

    def _paid_booking(self):
        cohort = self._confirmed_booking()
        with tenant_context(staff=True):
            from apps.corporate.models import CohortCompany

            cc = CohortCompany.objects.get(cohort=cohort, org=self.org)
            cc.status = "paid"
            cc.save(update_fields=["status"])
        return cohort, cc

    def test_attendees_need_payment(self):
        cohort = self._confirmed_booking()
        booking = self._get("/live-bookings").json()[0]
        r = self._post(f"/live-bookings/{booking['id']}/attendees", {"user_id": str(self.emp.id)})
        self.assertEqual(r.json()["error"]["code"], "not_paid")
        self.assertEqual(booking["cohort_status"], "confirmed")
        self.assertEqual(booking["total_minor"], 30000)  # 3 places at today's live price
        self.assertIsNotNone(cohort)

    def test_employee_sees_first_session_only_and_no_early_link(self):
        cohort, cc = self._paid_booking()
        with tenant_context(staff=True):
            from apps.corporate.models import Session

            Session.objects.filter(cohort=cohort).update(zoom_join_url="https://zoom.example/j/1")
        r = self._post(f"/live-bookings/{cc.id}/attendees", {"user_id": str(self.emp.id)})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(
            self._get(f"/live-bookings/{cc.id}/attendees").json()[0]["user_email"], self.emp.email
        )

        self.client.force_login(self.emp)
        mine = self.client.get(f"{API}/my/live").json()  # personal space: no X-Org-Id
        self.assertEqual(len(mine), 1)
        self.assertEqual(len(mine[0]["sessions"]), 1, "only the first session before it ends")
        self.assertTrue(mine[0]["more_sessions_hidden"])
        self.assertIsNone(mine[0]["sessions"][0]["join_url"], "link hidden a week before")

    def test_employee_gets_link_15_minutes_before(self):
        cohort, cc = self._paid_booking()
        with tenant_context(staff=True):
            from apps.corporate.models import Session

            Session.objects.filter(cohort=cohort, sequence=1).update(
                scheduled_at=timezone.now() + timedelta(minutes=10), zoom_join_url="https://zoom.example/j/1"
            )
        self._post(f"/live-bookings/{cc.id}/attendees", {"user_id": str(self.emp.id)})
        self.client.force_login(self.emp)
        first = self.client.get(f"{API}/my/live").json()[0]["sessions"][0]
        self.assertEqual(first["join_url"], "https://zoom.example/j/1")

    def test_other_company_sees_nothing(self):
        _, cc = self._paid_booking()
        with tenant_context(staff=True):
            other = Organization.objects.create(
                name="Other", slug=f"other-{uuid.uuid4().hex[:6]}", status="active"
            )
            outsider = User.objects.create_user(f"out-{uuid.uuid4().hex[:6]}@test.com", "x")
            OrgMember.objects.create(org=other, user=outsider, role="admin", joined_at=timezone.now())
        self.client.force_login(outsider)
        h = {"HTTP_X_ORG_ID": str(other.id)}
        self.assertEqual(self.client.get(f"{API}/live-bookings", **h).json(), [])
        self.assertEqual(self.client.get(f"{API}/live-bookings/{cc.id}/schedule", **h).status_code, 404)
        self.assertEqual(self.client.get(f"{API}/live-bookings/{cc.id}/attendees", **h).json(), [])
        self.assertEqual(self.client.get(f"{API}/my/live").json(), [])
        r = self.client.post(
            f"{API}/live-bookings/{cc.id}/attendees", {"user_id": str(outsider.id)},
            content_type="application/json", **h,
        )  # fmt: skip
        self.assertEqual(r.status_code, 404)

    def test_no_seat_used_when_person_already_has_the_course(self):
        sp = self._paid_recorded(qty=2)
        with tenant_context(staff=True):
            from apps.learning.services import enrol

            enrol(user=self.emp, course=self.course, source="organization", org_id=self.org.id)
        r = self._post("/allocations", {"offering_id": str(self.recorded.id), "user_id": str(self.emp.id)})
        self.assertEqual(r.json()["error"]["code"], "already_has_course")
        with tenant_context(staff=True):
            self.assertEqual(sp.allocations.count(), 0)

    # ------------------------------------------------------------ files on a purchase
    def _storage(self):
        from unittest.mock import patch

        return patch.multiple(
            "core.storage",
            configured=lambda: True,
            upload_url=lambda key: f"https://blob.example/{key}?sig=w",
            properties=lambda key: {"size": 1234},
            download_url=lambda key, filename=None: f"https://blob.example/{key}?sig=r",
            delete=lambda key: None,
        )

    def _member(self, role):
        with tenant_context(staff=True):
            u = User.objects.create_user(f"http-{role}-{uuid.uuid4().hex[:6]}@test.com", "x")
            OrgMember.objects.create(org=self.org, user=u, role=role, joined_at=timezone.now())
        return u

    def _delete(self, path, user=None):
        self.client.force_login(user or self.admin)
        return self.client.delete(f"{API}{path}", HTTP_X_ORG_ID=str(self.org.id))

    def test_admin_uploads_lists_downloads_and_deletes_a_file(self):
        sp = self._paid_recorded()
        with self._storage():
            r = self._post(
                f"/purchases/{sp.id}/attachments", {"filename": "contract.pdf", "size_bytes": 1234}
            )
            self.assertEqual(r.status_code, 200, r.content)
            self.assertIn("sig=w", r.json()["upload_url"])
            att = r.json()["attachment_id"]
            self.assertEqual(
                self._get(f"/purchases/{sp.id}/attachments").json(), [], "not listed until confirmed"
            )
            ok = self._post(f"/attachments/{att}/confirm", {})
            self.assertEqual(ok.status_code, 200, ok.content)
            listed = self._get(f"/purchases/{sp.id}/attachments").json()
            self.assertEqual([f["filename"] for f in listed], ["contract.pdf"])
            self.assertTrue(listed[0]["can_delete"])
            self.assertIn("sig=r", self._get(f"/attachments/{att}/download").json()["url"])
            gone = self._delete(f"/attachments/{att}")
            self.assertEqual(gone.status_code, 200, gone.content)
            self.assertEqual(self._get(f"/purchases/{sp.id}/attachments").json(), [])

    def test_file_type_and_size_are_checked(self):
        sp = self._paid_recorded()
        with self._storage():
            bad = self._post(f"/purchases/{sp.id}/attachments", {"filename": "run.exe", "size_bytes": 10})
            huge = self._post(f"/purchases/{sp.id}/attachments", {"filename": "a.pdf", "size_bytes": 10**12})
        self.assertEqual(bad.json()["error"]["code"], "file_type")
        self.assertEqual(huge.json()["error"]["code"], "file_size")

    def test_managers_learners_and_other_companies_cannot_reach_files(self):
        sp = self._paid_recorded()
        with self._storage():
            att = self._post(
                f"/purchases/{sp.id}/attachments", {"filename": "po.pdf", "size_bytes": 5}
            ).json()
            self._post(f"/attachments/{att['attachment_id']}/confirm", {})
            manager = self._member("manager")
            self.assertEqual(self._get(f"/purchases/{sp.id}/attachments", user=manager).status_code, 403)
            self.assertEqual(self._get(f"/purchases/{sp.id}/attachments", user=self.emp).status_code, 403)
            with tenant_context(staff=True):
                other = Organization.objects.create(
                    name="O", slug=f"o-{uuid.uuid4().hex[:6]}", status="active"
                )
                outsider = User.objects.create_user(f"o-{uuid.uuid4().hex[:6]}@test.com", "x")
                OrgMember.objects.create(org=other, user=outsider, role="admin", joined_at=timezone.now())
            self.client.force_login(outsider)
            h = {"HTTP_X_ORG_ID": str(other.id)}
            download = self.client.get(f"{API}/attachments/{att['attachment_id']}/download", **h)
            self.assertEqual(download.status_code, 404)
            self.assertEqual(self.client.get(f"{API}/purchases/{sp.id}/attachments", **h).status_code, 404)

    def test_company_cannot_delete_a_file_staff_added(self):
        sp = self._paid_recorded()
        with self._storage():
            self.client.force_login(self.staff)
            att = self.client.post(
                f"/api/v1/console/corporate/purchases/{sp.id}/attachments",
                {"filename": "signed.pdf", "size_bytes": 9},
                content_type="application/json",
            ).json()["attachment_id"]
            self.client.post(f"/api/v1/console/corporate/attachments/{att}/confirm")
            listed = self._get(f"/purchases/{sp.id}/attachments").json()
            self.assertFalse(listed[0]["can_delete"])
            r = self._delete(f"/attachments/{att}")
        self.assertEqual(r.status_code, 403)

    # ------------------------------------------------------------ inventory, programme, entitlement
    def test_console_inventory_counts_and_seat_holders(self):
        self._paid_recorded(qty=2)
        self._paid_recorded(qty=3)
        self._post("/allocations", {"offering_id": str(self.recorded.id), "user_id": str(self.emp.id)})
        self._post("/allocations", {"offering_id": str(self.recorded.id), "user_id": str(self.admin.id)})
        with tenant_context(staff=True):
            OrgMember.objects.filter(org=self.org, user=self.emp).update(removed_at=timezone.now())
        self.client.force_login(self.staff)
        url = f"/api/v1/console/corporate/inventory?org_id={self.org.id}"
        r = self.client.get(url)
        self.assertEqual(r.status_code, 200, r.content)
        g = next(x for x in r.json()["groups"] if x["offering_id"] == str(self.recorded.id))
        self.assertEqual((g["purchased"], g["allocated"], g["available"], g["purchases"]), (5, 2, 3, 2))
        self.assertEqual(len(r.json()["seats"]), 2)
        left = self.client.get(url + "&status=left").json()["seats"]
        self.assertEqual([s["user_email"] for s in left], [self.emp.email])
        self.assertIsNotNone(left[0]["left_at"])
        self.assertEqual(left[0]["entitlement_status"], "paid_in_full")
        found = self.client.get(url + f"&q={self.admin.email[:12]}").json()["seats"]
        self.assertEqual([s["user_email"] for s in found], [self.admin.email])
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get(url).status_code, 403, "company admins cannot use the console")

    def test_agreed_length_per_company_and_programme_dates(self):
        sp = self._paid_recorded()
        self.client.force_login(self.staff)
        r = self.client.patch(
            f"/api/v1/console/corporate/purchases/{sp.id}/programme",
            {"programme_months": 18},
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self._post("/allocations", {"offering_id": str(self.recorded.id), "user_id": str(self.emp.id)})
        with tenant_context(staff=True):
            from apps.corporate.models import SeatAllocation

            started = timezone.now() - timedelta(days=30)
            SeatAllocation.objects.filter(seat_purchase=sp).update(programme_started_at=started)
        row = self._get("/allocations").json()[0]
        self.assertEqual(row["programme_months"], 18)
        self.assertEqual(row["programme_status"], "in_progress")
        self.assertEqual(row["entitlement_status"], "paid_in_full")
        self.client.force_login(self.emp)
        mine = self.client.get(f"{API}/my/programmes").json()
        self.assertEqual(len(mine), 1)
        self.assertTrue(mine[0]["access_open"])
        self.assertEqual(mine[0]["programme_months"], 18)

    def test_ended_programme_keeps_lessons_open(self):
        sp = self._paid_recorded()
        self._post("/allocations", {"offering_id": str(self.recorded.id), "user_id": str(self.emp.id)})
        with tenant_context(staff=True):
            from apps.corporate.models import SeatAllocation

            SeatPurchase.objects.filter(pk=sp.pk).update(programme_months=1)
            SeatAllocation.objects.filter(seat_purchase=sp).update(
                programme_started_at=timezone.now() - timedelta(days=90)
            )
        self.client.force_login(self.emp)
        mine = self.client.get(f"{API}/my/programmes").json()[0]
        self.assertEqual(mine["programme_status"], "ended")
        self.assertTrue(mine["access_open"], "the programme end never closes lessons")
        r = self.client.get(f"/api/v1/learning/enrollments/{mine['enrollment_id']}")
        self.assertEqual(r.status_code, 200, r.content[:200])

    def test_ended_live_programme_cannot_be_joined(self):
        cohort, cc = self._paid_booking()
        self._post(f"/live-bookings/{cc.id}/attendees", {"user_id": str(self.emp.id)})
        with tenant_context(staff=True):
            from apps.corporate.models import CohortCompany, Session

            live_sp = SeatPurchase.objects.create(
                org=self.org,
                offering=self.live,
                buyer=self.admin,
                quantity=3,
                unit_price_minor=10000,
                currency="GBP",
                total_minor=30000,
                gbp_total_minor=30000,
                status="paid",
                paid_at=timezone.now(),
                programme_months=1,
            )
            CohortCompany.objects.filter(pk=cc.pk).update(seat_purchase=live_sp)
            now = timezone.now()
            Session.objects.filter(cohort=cohort, sequence=1).update(scheduled_at=now - timedelta(days=60))
            Session.objects.filter(cohort=cohort, sequence=2).update(
                scheduled_at=now + timedelta(minutes=5), zoom_join_url="https://zoom.example/j/2"
            )
        self.client.force_login(self.emp)
        mine = self.client.get(f"{API}/my/live").json()[0]
        self.assertEqual(mine["programme_status"], "ended")
        self.assertTrue(mine["sessions"], "the timetable stays visible")
        self.assertTrue(all(s["join_url"] is None for s in mine["sessions"]), "no new sessions after the end")

    # ------------------------------------------------- recorded and live prices

    def _free_tier(self):
        with tenant_context(staff=True):
            return PriceTier.objects.create(name=f"Free-{uuid.uuid4().hex[:6]}", gbp_minor=0, sort_order=0)

    def test_recorded_and_live_have_their_own_prices(self):
        with tenant_context(staff=True):
            live_tier = PriceTier.objects.create(
                name=f"LiveP-{uuid.uuid4().hex[:6]}", gbp_minor=45000, sort_order=0
            )
            CorporateOffering.objects.filter(pk=self.live.pk).update(price_tier=live_tier)
        mine = [p for p in self._get("/packages").json() if p["course_id"] == str(self.course.id)]
        prices = {p["delivery_type"]: p["price_gbp_minor"] for p in mine}
        self.assertEqual(prices, {"recorded": 10000, "live": 45000}, "each option shows its own price")

    def test_switched_off_or_unpriced_option_is_not_offered(self):
        with tenant_context(staff=True):
            CorporateOffering.objects.filter(pk=self.live.pk).update(is_active=False)
            CorporateOffering.objects.filter(pk=self.recorded.pk).update(price_tier=self._free_tier())
        mine = [p for p in self._get("/packages").json() if p["course_id"] == str(self.course.id)]
        self.assertEqual(mine, [], "neither option is on sale")
        r = self._post(f"/packages/{self.recorded.id}/checkout", {"quantity": 2})
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json()["error"]["code"], "no_price")
        r = self._post("/training-requests", {"course_id": str(self.course.id), "seats": 3})
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json()["error"]["code"], "live_not_offered")
        with tenant_context(staff=True):
            self.assertFalse(SeatPurchase.objects.filter(org=self.org).exists(), "no purchase was started")

    def test_live_request_allowed_when_live_is_offered(self):
        r = self._post("/training-requests", {"course_id": str(self.course.id), "seats": 3})
        self.assertEqual(r.status_code, 200, r.content)

    def test_console_needs_a_price_and_one_active_option_per_type(self):
        self.client.force_login(self.staff)
        url = "/api/v1/console/corporate/offerings"
        body = {
            "course_id": str(self.course.id),
            "delivery_type": "live",
            "price_tier_id": str(self._free_tier().id),
        }
        r = self.client.post(url, body, content_type="application/json")
        self.assertEqual(r.json()["error"]["code"], "price_required", r.content)
        with tenant_context(staff=True):
            tier = PriceTier.objects.create(
                name=f"LiveQ-{uuid.uuid4().hex[:6]}", gbp_minor=30000, sort_order=0
            )
        r = self.client.post(url, {**body, "price_tier_id": str(tier.id)}, content_type="application/json")
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(
            r.json()["error"]["code"], "offering_exists", "a second active live option is refused"
        )
        r = self.client.patch(
            f"{url}/{self.live.id}", {"price_tier_id": str(tier.id)}, content_type="application/json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        with tenant_context(staff=True):
            self.recorded.refresh_from_db()
            self.live.refresh_from_db()
        self.assertEqual(
            (self.recorded.price_tier.gbp_minor, self.live.price_tier.gbp_minor),
            (10000, 30000),
            "changing live never touches recorded",
        )

    # ------------------------------------------- assign training: recorded uses seats

    def _assign(self, dry_run):
        with tenant_context(staff=True):
            member = OrgMember.objects.get(org=self.org, user=self.emp)
        self.client.force_login(self.admin)
        return self.client.post(
            "/api/v1/org/assign",
            {"course_id": str(self.course.id), "member_ids": [str(member.id)], "dry_run": dry_run},
            content_type="application/json",
            HTTP_X_ORG_ID=str(self.org.id),
        )

    def test_assign_recorded_course_sold_per_seat_needs_seats(self):
        r = self._assign(dry_run=True)
        self.assertEqual(r.status_code, 200, r.content)
        seats = r.json()["seats"]
        self.assertEqual(
            (seats["free"], seats["needed"], seats["short"], seats["price_minor"]), (0, 1, 1, 10000)
        )
        r = self._assign(dry_run=False)
        self.assertEqual(r.status_code, 409, r.content)
        self.assertEqual(r.json()["error"]["code"], "not_enough_seats")
        with tenant_context(staff=True):
            self.assertFalse(
                Enrollment.objects.filter(user=self.emp, course=self.course).exists(), "nothing assigned"
            )

    def test_assign_recorded_uses_a_paid_seat(self):
        self._paid_recorded(qty=1)
        self.assertEqual(self._assign(dry_run=True).json()["seats"]["short"], 0)
        r = self._assign(dry_run=False)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["enrolled"], 1)
        with tenant_context(staff=True):
            from apps.corporate.models import SeatAllocation

            alloc = SeatAllocation.objects.get(org=self.org, user=self.emp)
            self.assertEqual(alloc.status, "active")
            self.assertIsNotNone(alloc.enrollment_id, "the seat gives the course")
        again = self._assign(dry_run=True).json()
        self.assertEqual(
            (again["enrolled"], again["already_had_it"]), (0, 1), "no second seat for the same person"
        )

    def test_assign_course_without_company_price_stays_free(self):
        with tenant_context(staff=True):
            CorporateOffering.objects.filter(pk=self.recorded.pk).update(is_active=False)
        r = self._assign(dry_run=True)
        self.assertIsNone(r.json()["seats"], "not sold per seat")
        r = self._assign(dry_run=False)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["enrolled"], 1)
        with tenant_context(staff=True):
            from apps.corporate.models import SeatAllocation

            self.assertFalse(
                SeatAllocation.objects.filter(org=self.org, user=self.emp).exists(), "no seat used"
            )
