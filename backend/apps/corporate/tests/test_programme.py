"""Company seats: programme duration vs paid access (full payment, instalments, departure)."""

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

from django.utils import timezone

from apps.catalog.models import Category, Course, CourseVersion
from apps.commerce.models import PriceTier
from apps.corporate.instalments import cover_seats, create_instalment_purchase, instalment_paid
from apps.corporate.models import (
    CorporateOffering,
    InstalmentCover,
    SeatAllocation,
    SeatInstalment,
    SeatPurchase,
)
from apps.corporate.programme import on_lesson_opened, programme_end
from apps.corporate.services import allocate_seat
from apps.identity.models import User
from apps.learning.models import Enrollment
from apps.learning.services import _check_access
from apps.org.models import Organization, OrgMember
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

JAN_1 = datetime(2027, 1, 1, 9, 0, tzinfo=UTC)
APR_1 = datetime(2027, 4, 1, 9, 0, tzinfo=UTC)
JUL_1 = datetime(2027, 7, 1, 9, 0, tzinfo=UTC)


def at(when):
    """Freeze 'now' for payments (instalments) and access checks (learning)."""
    return patch("django.utils.timezone.now", return_value=when)


class ProgrammeTest(SchemaTransactionTestCase):
    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        now = timezone.now()
        with tenant_context(staff=True):
            self.staff = User.objects.create_user(f"prog-staff-{tag}@test.com", "test123", is_staff=True)
            self.org = Organization.objects.create(
                name=f"ProgCorp {tag}", slug=f"progcorp-{tag}", status="active"
            )
            self.ann = User.objects.create_user(f"prog-ann-{tag}@test.com", "test123")
            self.bob = User.objects.create_user(f"prog-bob-{tag}@test.com", "test123")
            for u in (self.ann, self.bob):
                OrgMember.objects.create(
                    org=self.org, user=u, role="learner", joined_at=now - timedelta(days=900)
                )
            cat = Category.objects.create(slug=f"prog-cat-{tag}", name=f"ProgCat {tag}", sort_order=0)
            course = Course.objects.create(
                ownership="platform",
                status="published",
                created_by=self.staff,
                category=cat,
                slug=f"prog-c-{tag}",
                title=f"Programme Course {tag}",
            )
            v = CourseVersion.objects.create(course=course, number=1, status="published")
            course.live_version = v
            course.save(update_fields=["live_version"])
            tier = PriceTier.objects.create(name=f"ProgTier-{tag}", gbp_minor=12000, sort_order=0)
            self.offering = CorporateOffering.objects.create(
                course=course, delivery_type="recorded", price_tier=tier, is_active=True, access_months=12
            )

    def _request(self):
        req = MagicMock()
        req.user = req.auth = self.staff
        req.org_id = self.org.id
        req.META = {"REMOTE_ADDR": "127.0.0.1"}
        return req

    def _full_purchase(self):
        return SeatPurchase.objects.create(
            org=self.org,
            offering=self.offering,
            buyer=self.staff,
            quantity=2,
            unit_price_minor=12000,
            currency="GBP",
            total_minor=24000,
            gbp_total_minor=24000,
            status="paid",
            paid_at=timezone.now(),
        )

    def _instalment_purchase(self):
        """Three payments covering 3, 3 then 6 months, each from its own payment date."""
        return create_instalment_purchase(
            self._request(),
            org_id=self.org.id,
            offering_id=self.offering.id,
            buyer_id=self.ann.id,
            quantity=2,
            unit_price_minor=12000,
            currency="gbp",
            schedule=[
                {"amount_minor": 8000, "due_at": JAN_1, "covers_months": 3},
                {"amount_minor": 8000, "due_at": APR_1, "covers_months": 3},
                {"amount_minor": 8000, "due_at": JUL_1, "covers_months": 6},
            ],
        )

    def _pay(self, sp, sequence, when):
        inst = SeatInstalment.objects.get(seat_purchase=sp, sequence=sequence)
        with at(when):
            instalment_paid(
                {"id": "in_test", "metadata": {"kind": "corporate_instalment", "id": str(inst.id)}}
            )

    def _cover(self, sp, sequence, *allocs):
        inst = SeatInstalment.objects.get(seat_purchase=sp, sequence=sequence)
        return cover_seats(self._request(), inst.id, [a.id for a in allocs])

    def _enrolment(self, alloc):
        with tenant_context(staff=True):  # RLS: read as staff
            return Enrollment.objects.get(pk=alloc.enrollment_id)

    def _leave(self, user, when):
        with tenant_context(staff=True):
            OrgMember.objects.filter(org=self.org, user=user).update(removed_at=when)

    # ---------------------------------------------------------------- programme duration
    def test_programme_starts_at_first_lesson_and_only_once(self):
        with tenant_context(staff=True):
            sp = self._full_purchase()
            alloc = allocate_seat(self._request(), sp.id, self.ann.id)
            self.assertIsNone(programme_end(alloc, sp), "nothing counts before the first session")
            on_lesson_opened(self._enrolment(alloc))
            alloc.refresh_from_db()
            first = alloc.programme_started_at
            on_lesson_opened(self._enrolment(alloc))  # later lessons change nothing
            alloc.refresh_from_db()
            end = programme_end(alloc, sp)
        self.assertIsNotNone(first)
        self.assertEqual(alloc.programme_started_at, first)
        self.assertEqual((end.year - first.year) * 12 + end.month - first.month, 12)

    def test_lessons_stay_open_after_the_programme_ends(self):
        """Paid in full: the programme ends after 12 months, the recordings do not."""
        with tenant_context(staff=True):
            sp = self._full_purchase()
            alloc = allocate_seat(self._request(), sp.id, self.ann.id)
            SeatAllocation.objects.filter(pk=alloc.pk).update(programme_started_at=JAN_1)
            alloc.refresh_from_db()
            end = programme_end(alloc, sp)
        enrolment = self._enrolment(alloc)
        self.assertEqual(end, datetime(2028, 1, 1, 9, 0, tzinfo=UTC))
        self.assertIsNone(enrolment.access_expires_at)
        with at(end + timedelta(days=400)):
            _check_access(enrolment)  # still allowed long after completion

    def test_departure_keeps_full_payment_access(self):
        with tenant_context(staff=True):
            alloc = allocate_seat(self._request(), self._full_purchase().id, self.ann.id)
        self._leave(self.ann, timezone.now())
        self.assertIsNone(self._enrolment(alloc).access_expires_at)
        with tenant_context(staff=True):
            alloc.refresh_from_db()
        self.assertEqual(alloc.status, "active", "the seat is not reclaimed")

    # ---------------------------------------------------------------- instalments
    def test_first_instalment_makes_seats_usable(self):
        with tenant_context(staff=True):
            sp = self._instalment_purchase()
            with self.assertRaises(ServiceError):
                allocate_seat(self._request(), sp.id, self.ann.id)  # nothing paid yet
            self._pay(sp, 1, JAN_1)
            sp.refresh_from_db()
            alloc = allocate_seat(self._request(), sp.id, self.ann.id)
        self.assertEqual(sp.status, "paid")
        self.assertEqual(sp.paid_at, JAN_1)
        self.assertEqual(alloc.status, "active")

    def test_only_chosen_seats_get_the_paid_period(self):
        """Paid 1 January for 3 months, Ann chosen: her access ends 1 April. Bob, not chosen, gets none."""
        with tenant_context(staff=True):
            sp = self._instalment_purchase()
            self._pay(sp, 1, JAN_1)
            ann = allocate_seat(self._request(), sp.id, self.ann.id)
            bob = allocate_seat(self._request(), sp.id, self.bob.id)
            SeatAllocation.objects.filter(pk=ann.pk).update(programme_started_at=JAN_1 + timedelta(days=40))
            self._cover(sp, 1, ann)  # chosen after payment: applies at once
        ann_e, bob_e = self._enrolment(ann), self._enrolment(bob)
        self.assertEqual(ann_e.access_expires_at, APR_1, "from the payment date, not the first session")
        with at(APR_1 - timedelta(hours=1)):
            _check_access(ann_e)
        with at(APR_1 + timedelta(hours=1)):
            with self.assertRaises(ServiceError) as cm:
                _check_access(ann_e)
        self.assertEqual(cm.exception.code, "access_expired")
        self.assertEqual(ann_e.status, "active", "progress and history are kept")
        with self.assertRaises(ServiceError):
            _check_access(bob_e)  # not covered by any payment

    def test_next_payment_extends_only_chosen_seats(self):
        with tenant_context(staff=True):
            sp = self._instalment_purchase()
            self._pay(sp, 1, JAN_1)
            ann = allocate_seat(self._request(), sp.id, self.ann.id)
            bob = allocate_seat(self._request(), sp.id, self.bob.id)
            self._cover(sp, 1, ann, bob)
            self._cover(sp, 2, bob)  # chosen before it is paid
            self._pay(sp, 2, APR_1 + timedelta(days=3))  # a few days late
            self._cover(sp, 3, bob)
            bob_after_second = self._enrolment(bob).access_expires_at
            self._pay(sp, 3, JUL_1)
        self.assertEqual(
            self._enrolment(ann).access_expires_at, APR_1, "not chosen for instalment 2: no extension"
        )
        self.assertEqual(
            bob_after_second, datetime(2027, 7, 4, 9, 0, tzinfo=UTC), "from the late payment: never backdated"
        )
        self.assertIsNone(
            self._enrolment(bob).access_expires_at, "every instalment paid for Bob: no end date"
        )

    def test_departed_employee_is_not_extended(self):
        with tenant_context(staff=True):
            sp = self._instalment_purchase()
            self._pay(sp, 1, JAN_1)
            ann = allocate_seat(self._request(), sp.id, self.ann.id)
            bob = allocate_seat(self._request(), sp.id, self.bob.id)
            for seq in (1, 2, 3):
                self._cover(sp, seq, ann, bob)  # both chosen in advance
        self._leave(self.ann, JAN_1 + timedelta(days=30))
        with tenant_context(staff=True):
            self._pay(sp, 2, APR_1)
            self._pay(sp, 3, JUL_1)
            ann.refresh_from_db()
            with self.assertRaises(ServiceError) as cm:
                self._cover(sp, 3, ann)  # cannot choose someone who has left
        self.assertEqual(self._enrolment(ann).access_expires_at, APR_1, "keeps what was paid while a member")
        self.assertIsNone(self._enrolment(bob).access_expires_at, "current member: fully paid")
        self.assertEqual(ann.status, "active", "nothing revoked")
        self.assertEqual(cm.exception.code, "member_left")

    def test_same_payment_cannot_credit_a_seat_twice(self):
        with tenant_context(staff=True):
            sp = self._instalment_purchase()
            self._pay(sp, 1, JAN_1)
            ann = allocate_seat(self._request(), sp.id, self.ann.id)
            first = self._cover(sp, 1, ann)
            again = self._cover(sp, 1, ann, ann)
            rows = InstalmentCover.objects.filter(allocation=ann).count()
        self.assertEqual(first, {"added": 1, "already_covered": 0})
        self.assertEqual(again, {"added": 0, "already_covered": 1})
        self.assertEqual(rows, 1)

    def test_personal_enrolment_is_never_limited(self):
        """Someone who already owns the course keeps their own lifetime access."""
        from apps.learning.services import enrol

        with tenant_context(staff=True):
            own = enrol(user=self.ann, course=self.offering.course, source="admin_grant")
            sp = self._instalment_purchase()
            self._pay(sp, 1, JAN_1)
            try:
                allocate_seat(self._request(), sp.id, self.ann.id)
            except ServiceError:
                pass  # a seat may be refused; either way the personal enrolment is untouched
            own.refresh_from_db()
        self.assertIsNone(own.access_expires_at)

    def test_repeated_webhook_changes_nothing(self):
        with tenant_context(staff=True):
            sp = self._instalment_purchase()
            self._pay(sp, 1, JAN_1)
            self._pay(sp, 1, JAN_1 + timedelta(days=5))
            inst = SeatInstalment.objects.get(seat_purchase=sp, sequence=1)
        self.assertEqual(inst.paid_at, JAN_1)

    def test_failed_or_unpaid_instalment_gives_nothing(self):
        from apps.corporate.instalments import instalment_failed

        with tenant_context(staff=True):
            sp = self._instalment_purchase()
            self._pay(sp, 1, JAN_1)
            ann = allocate_seat(self._request(), sp.id, self.ann.id)
            bob = allocate_seat(self._request(), sp.id, self.bob.id)
            self._cover(sp, 1, ann)
            self._cover(sp, 2, ann, bob)  # bob is only on instalment 2
            SeatInstalment.objects.filter(seat_purchase=sp, sequence=2).update(
                status="sent", stripe_invoice_id="in_2"
            )
            inst2 = SeatInstalment.objects.get(seat_purchase=sp, sequence=2)
            instalment_failed(
                {"id": "in_2", "metadata": {"kind": "corporate_instalment", "id": str(inst2.id)}}
            )
            instalment_paid(
                {"id": "in_other", "metadata": {"kind": "corporate_instalment", "id": str(inst2.id)}}
            )
            inst2.refresh_from_db()
        self.assertEqual(inst2.status, "failed")
        self.assertIsNone(inst2.paid_at, "an event for another invoice is ignored")
        self.assertEqual(self._enrolment(ann).access_expires_at, APR_1, "only the paid instalment counts")
        with self.assertRaises(ServiceError):
            _check_access(self._enrolment(bob))  # covered only by an unpaid instalment

    def test_each_company_agreement_has_its_own_length(self):
        with tenant_context(staff=True):
            a = self._full_purchase()
            b = self._full_purchase()
            SeatPurchase.objects.filter(pk=b.pk).update(programme_months=18)
            a_seat = allocate_seat(self._request(), a.id, self.ann.id)
            b_seat = allocate_seat(self._request(), b.id, self.bob.id)
            SeatAllocation.objects.filter(pk__in=[a_seat.pk, b_seat.pk]).update(programme_started_at=JAN_1)
            a_seat.refresh_from_db()
            b_seat.refresh_from_db()
            b.refresh_from_db()
            a_end, b_end = programme_end(a_seat, a), programme_end(b_seat, b)
        self.assertEqual(a_end, datetime(2028, 1, 1, 9, 0, tzinfo=UTC), "package default: 12 months")
        self.assertEqual(b_end, datetime(2028, 7, 1, 9, 0, tzinfo=UTC), "agreed for this company: 18 months")

    def test_concurrent_webhooks_pay_once(self):
        """Two deliveries of the same event at the same time: the row lock lets one through."""
        import threading

        from django.db import connection

        with tenant_context(staff=True):
            sp = self._instalment_purchase()
            inst = SeatInstalment.objects.get(seat_purchase=sp, sequence=1)
        errors = []

        def deliver():
            try:
                with tenant_context(staff=True):
                    instalment_paid(
                        {"id": "in_x", "metadata": {"kind": "corporate_instalment", "id": str(inst.id)}}
                    )
            except Exception as e:  # noqa: BLE001 - reported below
                errors.append(e)
            finally:
                connection.close()

        threads = [threading.Thread(target=deliver) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        with tenant_context(staff=True):
            inst.refresh_from_db()
            sp.refresh_from_db()
        self.assertEqual(errors, [])
        self.assertEqual(inst.status, "paid")
        self.assertEqual(sp.status, "paid")
        self.assertEqual(sp.paid_at, inst.paid_at, "one payment, recorded once")

    def test_schedule_must_add_up_and_have_periods(self):
        base = {
            "org_id": self.org.id,
            "offering_id": self.offering.id,
            "buyer_id": self.ann.id,
            "quantity": 2,
            "unit_price_minor": 12000,
            "currency": "gbp",
        }
        with tenant_context(staff=True):
            with self.assertRaises(ServiceError) as short:
                create_instalment_purchase(
                    self._request(),
                    **base,
                    schedule=[
                        {"amount_minor": 1000, "due_at": JAN_1, "covers_months": 3},
                        {"amount_minor": 1000, "due_at": APR_1, "covers_months": 6},
                    ],
                )
            with self.assertRaises(ServiceError) as no_period:
                create_instalment_purchase(
                    self._request(),
                    **base,
                    schedule=[
                        {"amount_minor": 12000, "due_at": JAN_1, "covers_months": 0},
                        {"amount_minor": 12000, "due_at": APR_1, "covers_months": 3},
                    ],
                )
            with self.assertRaises(ServiceError) as outsider:
                create_instalment_purchase(
                    self._request(),
                    **{**base, "buyer_id": self.staff.id},
                    schedule=[
                        {"amount_minor": 12000, "due_at": JAN_1, "covers_months": 3},
                        {"amount_minor": 12000, "due_at": APR_1, "covers_months": 3},
                    ],
                )
        self.assertEqual(short.exception.code, "bad_schedule")
        self.assertEqual(no_period.exception.code, "bad_schedule")
        self.assertEqual(outsider.exception.code, "buyer_not_member")
