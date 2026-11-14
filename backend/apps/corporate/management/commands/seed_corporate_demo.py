"""Additive, fictional B2B demo data for the company-package journey.

Requires the normal demo/catalogue seed to have created a published course.  It never
calls Stripe or sends mail, and it is safe to run again.
"""

from datetime import timedelta
from types import SimpleNamespace

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.catalog.models import Course
from apps.commerce.models import PriceTier
from apps.corporate.models import (
    CancellationRequest, CohortCompany, CorporateOffering, LiveAttendee, LiveCohort,
    SeatPurchase, Session, SessionAttendance,
)
from apps.corporate.services import allocate_seat
from apps.engagement import services as engagement
from apps.engagement.models import Ticket
from apps.identity.models import User
from apps.org import services as org_services
from apps.org.models import OrgMember, Organization
from core.tenancy import tenant_context


MARK = "b2b-demo"


class Command(BaseCommand):
    help = "Add a fictional company, seats, live cohort and B2B support conversation."

    def handle(self, *args, **options):
        staff = User.objects.filter(is_staff=True, is_active=True).order_by("created_at").first()
        course = Course.objects.filter(status="published", deleted_at__isnull=True).order_by("created_at").first()
        tier = PriceTier.objects.filter(is_active=True, gbp_minor__gt=0).order_by("gbp_minor").first()
        if not all((staff, course, tier)):
            raise CommandError("Run seed_demo first; a staff user, published course and active price tier are required.")

        employer, made = User.objects.get_or_create(
            email="b2b.demo.owner@learnhub.example",
            defaults={"full_name": "Maya Turner", "is_active": True},
        )
        if made:
            employer.set_unusable_password()
            employer.save(update_fields=["password"])
        with tenant_context(user_id=staff.id, staff=True):
            org = Organization.objects.filter(slug="northstar-demo").first()
            if org is None:
                org = org_services.create_organization(name="Northstar Facilities Ltd", slug="northstar-demo", owner=employer)
            OrgMember.objects.get_or_create(org=org, user=employer, defaults={"role": "owner", "joined_at": timezone.now()})
            employees = []
            for n, email in enumerate(("sarah.owen@learnhub.example", "omar.hassan@learnhub.example", "liam.park@learnhub.example"), 1):
                user, created = User.objects.get_or_create(email=email, defaults={"full_name": ("Sarah Owen", "Omar Hassan", "Liam Park")[n - 1], "is_active": True})
                if created:
                    user.set_unusable_password()
                    user.save(update_fields=["password"])
                OrgMember.objects.get_or_create(org=org, user=user, defaults={"role": "learner", "joined_at": timezone.now()})
                employees.append(user)

            recorded, _ = CorporateOffering.objects.get_or_create(
                course=course, delivery_type="recorded", is_active=True,
                defaults={"price_tier": tier, "description": f"{MARK}: recorded compliance training seats"},
            )
            purchase, _ = SeatPurchase.objects.get_or_create(
                org=org, offering=recorded, buyer=employer, notes=MARK,
                defaults={"quantity": 8, "unit_price_minor": tier.gbp_minor, "currency": "GBP", "total_minor": tier.gbp_minor * 8, "gbp_total_minor": tier.gbp_minor * 8, "status": "paid", "paid_at": timezone.now(), "payment_intent": "pi_b2b_demo_recorded"},
            )
            request = SimpleNamespace(user=employer, auth=employer, org_id=org.id, META={"REMOTE_ADDR": "127.0.0.1"})
            for employee in employees[:2]:
                if not purchase.allocations.filter(user=employee, status__in=["allocated", "active"]).exists():
                    allocate_seat(request, purchase.id, employee.id)

            live, _ = CorporateOffering.objects.get_or_create(
                course=course, delivery_type="live", is_active=True,
                defaults={"price_tier": tier, "description": f"{MARK}: coordinated live training"},
            )
            cohort, _ = LiveCohort.objects.get_or_create(
                course=course, intake="Spring demo", defaults={"title": "Northstar live safety cohort", "delivery_mode": "online", "min_learners": 3, "max_learners": 20, "current_seats": 3, "status": "in_progress", "notes": MARK},
            )
            live_purchase, _ = SeatPurchase.objects.get_or_create(
                org=org, offering=live, buyer=employer, notes=f"{MARK}-live",
                defaults={"quantity": 3, "unit_price_minor": tier.gbp_minor, "currency": "GBP", "total_minor": tier.gbp_minor * 3, "gbp_total_minor": tier.gbp_minor * 3, "status": "paid", "paid_at": timezone.now(), "payment_intent": "pi_b2b_demo_live"},
            )
            placement, _ = CohortCompany.objects.get_or_create(org=org, cohort=cohort, defaults={"seat_purchase": live_purchase, "approved_seats": 3, "status": "active"})
            session, _ = Session.objects.get_or_create(cohort=cohort, sequence=1, defaults={"title": "Safe handling workshop", "scheduled_at": timezone.now() - timedelta(days=2), "duration_min": 90, "delivery_mode": "online", "status": "completed"})
            attendee, _ = LiveAttendee.objects.get_or_create(org=org, cohort_company=placement, cohort=cohort, user=employees[0], status="active", defaults={"added_by": employer})
            SessionAttendance.objects.get_or_create(session=session, user=employees[0], org=org, defaults={"source": "manual_admin", "match_status": "verified", "is_verified": True, "join_at": session.scheduled_at, "leave_at": session.scheduled_at + timedelta(minutes=86), "duration_seconds": 5160})
            CancellationRequest.objects.get_or_create(org=org, requester=employer, reason=f"{MARK}: please move one unused seat to our next intake", defaults={"type": "postponement", "status": "under_review", "seat_purchase": purchase})
            ticket = Ticket.objects.filter(org=org, subject="B2B training request — Northstar Facilities").first()
            if ticket is None:
                ticket = engagement.open_ticket(user=employer, subject="B2B training request — Northstar Facilities", category="business", body="We need a live intake for our shift supervisors and want to move one unused recorded seat.", org_id=org.id)
            if not ticket.messages.filter(author=staff).exists():
                engagement.reply(ticket=ticket, author=staff, body="Thanks Maya. Your request is with the B2B team. We have proposed the Spring demo intake and will confirm the remaining seat transfer.")

        self.stdout.write(self.style.SUCCESS(f"Corporate demo ready for {org.name}: 8 recorded seats, live cohort, support thread and review case."))
