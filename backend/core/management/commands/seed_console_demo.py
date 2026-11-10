"""Fill the admin console with 90 days of believable, fully fictional activity.

    python manage.py seed_console_demo            # after seed_demo; safe to run again

Adds rows only and never changes or removes existing ones. Every row it makes carries a
fixed marker (an email, a reference, a Stripe-style id starting "seed_console_"), so a
second run finds them and adds nothing. It makes every console chart and KPI meaningful:
orders in several currencies (some refunded), learners and enrolments, subscriptions with
renewals and plan events, tickets, reviews (some reported), payout requests, certificates
(some expiring, one revoked) and broadcasts.

The seeded learners have no password (nobody signs in as them). Stripe, Bunny and email are
never called. Instructor earnings for the seeded orders go through the real payouts code
(record_sale / record_refund, both idempotent), so commissions, balances and payouts match
the sales; a re-run also adds earnings for orders seeded by an older version of this command.
"""

import random
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.catalog.models import Course, CourseVersion
from apps.commerce import pricing
from apps.commerce.models import (
    Currency,
    Invoice,
    Order,
    OrderItem,
    Payment,
    Plan,
    PlanPrice,
    Refund,
    Subscription,
    SubscriptionEvent,
)
from apps.engagement.models import Broadcast, ContentReport, Review, Ticket, TicketMessage
from apps.identity.models import InstructorProfile, User
from apps.learning.models import Certificate, Enrollment
from apps.payouts.models import PayoutRequest
from core.errors import ServiceError
from core.tenancy import tenant_context

DOMAIN = "learnhub.example.com"
MARK = "seed_console_"
FIRST = ["Amira", "Ben", "Chloe", "Daniyal", "Ella", "Farah", "George", "Hana", "Isaac", "Jade", "Karim",
         "Lina", "Mason", "Nour", "Oliver", "Priya", "Quinn", "Rania", "Sam", "Tala", "Usman", "Vera",
         "Will", "Yara", "Zain", "Aisha", "Callum", "Dina", "Ethan", "Grace", "Hamza", "Imogen", "Joel",
         "Laila", "Malik", "Nadia"]  # fmt: skip
LAST = ["Hassan", "Clarke", "Patel", "Nguyen", "Okafor", "Ward", "Haddad", "Silva", "Brooks", "Khan",
        "Fischer", "Rossi", "Murphy", "Ali", "Evans", "Sato"]  # fmt: skip
CARDS = [("visa", 0.55), ("mastercard", 0.3), ("amex", 0.1), ("", 0.05)]  # "" = PayPal
CURRENCIES = [("GBP", 0.6), ("USD", 0.25), ("EUR", 0.15)]
TICKETS = [
    ("payment", "Charged twice for the same course", "high", "open"),
    ("account", "Can't sign in after changing my email", "normal", "progress"),
    ("course", "Video in lesson 4 stops halfway", "normal", "open"),
    ("technical", "Certificate PDF shows the wrong name", "urgent", "open"),
    ("payment", "Refund for a course I bought by mistake", "normal", "resolved"),
    ("business", "Adding 20 more seats to our plan", "low", "waiting"),
    ("instructor", "When is my next payout?", "normal", "progress"),
    ("course", "Quiz marks a correct answer as wrong", "high", "resolved"),
]
REVIEWS = [
    (5, "Clear, practical and well paced. The exercises made it stick."),
    (4, "Good course. A few lessons could be shorter, but the examples are great."),
    (5, "Exactly what I needed for work. I finished it in a week."),
    (3, "Useful content, though the audio is quiet in places."),
    (2, "Not what the description promised. Too basic for me."),
    (1, "Buy my course instead, link in my profile!!!"),  # reported: spam
    (4, "The instructor answers questions quickly. Recommended."),
    (5, "Best course on the topic I have taken so far."),
]


def pick(rnd, weighted):
    return rnd.choices([v for v, _ in weighted], [w for _, w in weighted])[0]


class Command(BaseCommand):
    help = (
        "Add 90 days of fictional console activity (orders, subscriptions, tickets, reports...). Adds only."
    )

    def add_arguments(self, parser):
        parser.add_argument("--seed", type=int, default=2026, help="Random seed (same seed, same data)")
        parser.add_argument("--orders", type=int, default=160, help="How many orders to add (first run)")

    def handle(self, *args, seed, orders, **opts):
        self.seed = seed
        self.rnd = random.Random(seed)  # noqa: S311 - reproducible fake data, not security
        self.now = timezone.now()
        self.admin = User.objects.filter(is_staff=True, is_active=True).order_by("created_at").first()
        if self.admin is None:
            raise CommandError("No staff account yet. Run seed_demo first.")
        with tenant_context(user_id=self.admin.id, staff=True):
            self.courses = list(
                Course.objects.filter(
                    status="published", deleted_at__isnull=True, owner_org__isnull=True
                ).order_by("created_at")
            )
            if not self.courses:
                raise CommandError("No published marketplace course yet. Run seed_demo first.")
            self.added = {}
            for title, fn in (("Learners", self.learners), ("Orders and refunds", lambda: self.orders(orders)),
                              ("Instructor earnings", self.earnings),
                              ("Subscriptions", self.subscriptions), ("Tickets", self.tickets),
                              ("Reviews and reports", self.reviews), ("Payout requests", self.payout_requests),
                              ("Certificates", self.certificates), ("Broadcasts", self.broadcasts)):  # fmt: skip
                with transaction.atomic():
                    n = fn() or 0
                self.stdout.write(f"  {title}: {n} added")
        self.stdout.write(self.style.SUCCESS("Console demo data is in place."))

    def ago(self, lo_days: float, hi_days: float):
        return self.now - timedelta(days=self.rnd.uniform(lo_days, hi_days))

    # ------------------------------------------------------------------ learners
    def learners(self) -> int:
        added = 0
        self.people = []
        for i in range(36):
            email = f"console.learner{i + 1:02d}@{DOMAIN}"
            u = User.objects.filter(email=email).first()
            if u is None:
                u = User.objects.create_user(email, None, full_name=f"{FIRST[i]} {LAST[i % len(LAST)]}")
                User.objects.filter(pk=u.pk).update(created_at=self.ago(1, 120))  # spread sign-ups
                added += 1
            self.people.append(u)
        return added

    # ------------------------------------------------------------------ orders
    def price(self, code: str) -> tuple[str, int, Decimal]:
        gbp = self.rnd.choice([1999, 2499, 2999, 3999, 4999, 6999, 8999])
        try:
            rate = pricing.latest_rate(code)
        except ServiceError:  # no rate stored for this currency: sell in pounds
            return "GBP", gbp, Decimal(1)
        exp = Currency.objects.filter(code=code).values_list("exponent", flat=True).first() or 2
        major = (Decimal(gbp) / 100 * rate).quantize(Decimal(1)) - Decimal("0.01")
        return code, int(major * 10**exp), rate

    def orders(self, count: int) -> int:
        existing = set(
            Order.objects.filter(stripe_session_id__startswith=f"{MARK}o_").values_list(
                "stripe_session_id", flat=True
            )
        )
        owned = set(
            Enrollment.objects.filter(user__in=self.people, org__isnull=True).values_list(
                "user_id", "course_id"
            )
        )
        added = 0
        shared = self.rnd
        for n in range(count):
            key = f"{MARK}o_{n:04d}"
            # each order draws from its own stream, so skipping one never shifts the next
            self.rnd = random.Random(f"{self.seed}:{key}")  # noqa: S311 - fake data
            buyer = self.rnd.choice(self.people)
            course = self.rnd.choice(self.courses)
            when = self.ago(0.05, 90)
            code = pick(self.rnd, CURRENCIES)
            brand = pick(self.rnd, CARDS)
            refunded = self.rnd.random() < 0.05
            if key in existing or (buyer.id, course.id) in owned:
                continue  # already seeded, or this learner already has the course
            owned.add((buyer.id, course.id))
            code, total, rate = self.price(code)
            exp = Currency.objects.filter(code=code).values_list("exponent", flat=True).first() or 2
            gbp = pricing.gbp_equivalent(total, exp, rate)
            last4 = f"{self.rnd.randint(0, 9999):04d}" if brand else ""
            order = Order.objects.create(
                user=buyer, currency_id=code, subtotal_minor=total, total_minor=total, fx_rate=rate,
                gbp_total_minor=gbp, status="refunded" if refunded else "paid", paid_at=when, created_at=when,
                stripe_session_id=key, stripe_payment_intent_id=f"{MARK}pi_{n:04d}",
                payment_method_type="card" if brand else "paypal", card_brand=brand, card_last4=last4,
            )  # fmt: skip
            Payment.objects.create(
                user=buyer, order=order, provider_ref=f"{MARK}pi_{n:04d}", amount_minor=total, currency_id=code,
                status="succeeded", payment_method_type=order.payment_method_type, card_brand=brand, card_last4=last4,
                created_at=when,
            )  # fmt: skip
            done = not refunded and self.rnd.random() < 0.3
            progress = Decimal(100) if done else Decimal(self.rnd.randint(0, 95))
            enrol = Enrollment.objects.create(
                user=buyer, course=course, source="purchase", source_ref=order.id, enrolled_at=when,
                status="revoked" if refunded else ("completed" if done else "active"), progress_pct=progress,
                completed_at=when + timedelta(days=self.rnd.uniform(1, 20)) if done else None,
                last_accessed_at=None if refunded else self.ago(0, max(0.1, (self.now - when).days)),
                created_at=when,
            )  # fmt: skip
            if enrol.completed_at and enrol.completed_at > self.now:
                Enrollment.objects.filter(pk=enrol.pk).update(completed_at=self.now - timedelta(hours=1))
            item = OrderItem.objects.create(
                user=buyer, order=order, course=course, list_minor=total, gross_minor=total, gbp_gross_minor=gbp,
                enrollment=enrol, created_at=when,
                refunded_at=when + timedelta(days=self.rnd.uniform(0.5, 10)) if refunded else None,
            )  # fmt: skip
            if refunded:
                if item.refunded_at > self.now:
                    OrderItem.objects.filter(pk=item.pk).update(refunded_at=self.now - timedelta(hours=2))
                Refund.objects.create(
                    user=buyer, item=item, amount_minor=total, reason="Bought by mistake", status="succeeded",
                    provider_ref=f"{MARK}re_{n:04d}", requested_by=self.admin,
                )  # fmt: skip
            added += 1
        self.rnd = shared
        # a few failed payments in the last week (dashboard: needs attention)
        for n in range(3):
            key = f"{MARK}f_{n:02d}"
            if Order.objects.filter(stripe_session_id=key).exists():
                continue
            buyer, when = self.rnd.choice(self.people), self.ago(0.2, 6)
            Order.objects.create(user=buyer, currency_id="GBP", subtotal_minor=2999, total_minor=2999,
                                 fx_rate=Decimal(1), gbp_total_minor=2999, status="failed", created_at=when,
                                 stripe_session_id=key)  # fmt: skip
            added += 1
        return added

    # ------------------------------------------------------------------ earnings
    def earnings(self) -> int:
        """The same lines the order.paid outbox job writes (commission rules, the instructor's
        rate, the hold), dated at the sale; refunds get their negative line on the refund day."""
        from apps.payouts import services as payouts
        from apps.payouts.models import Earning

        added = 0
        for order_id in (
            Order.objects.filter(stripe_session_id__startswith=f"{MARK}o_", paid_at__isnull=False)
            .order_by("paid_at")
            .values_list("id", flat=True)
        ):
            added += payouts.record_sale(order_id)
        for item_id, refunded_at in OrderItem.objects.filter(
            order__stripe_session_id__startswith=f"{MARK}o_", refunded_at__isnull=False
        ).values_list("id", "refunded_at"):
            added += payouts.record_refund(item_id)
            Earning.objects.filter(order_item_id=item_id, kind="refund", earned_at__gt=refunded_at).update(
                earned_at=refunded_at
            )
        return added

    # ------------------------------------------------------------------ subscriptions
    def subscriptions(self) -> int:
        plans = list(Plan.objects.filter(audience="personal", is_active=True).order_by("code"))
        if not plans:
            return 0
        added = 0
        for i, u in enumerate(self.people[:14]):
            key = f"{MARK}sub_{i:02d}"
            if Subscription.objects.filter(stripe_subscription_id=key).exists():
                continue
            plan = plans[i % len(plans)]
            price = PlanPrice.objects.filter(plan=plan, currency_id="GBP").first()
            amount = price.amount_minor if price else 1999
            month = 365 / 12 if plan.interval == "month" else 365
            start = self.ago(5, 88)
            cancelled = i in (3, 9)
            sub = Subscription.objects.create(
                user=u, plan=plan, status="canceled" if cancelled else "active", currency_id="GBP", seats=1,
                stripe_subscription_id=key, created_at=start,
                current_period_end=start + timedelta(days=month * (1 + int((self.now - start).days // month))),
            )  # fmt: skip
            SubscriptionEvent.objects.create(user=u, subscription=sub, kind="created", to_value=plan.code,
                                             amount_minor=amount, at=start)  # fmt: skip
            paid_at, k = start, 0
            while paid_at < self.now:
                Invoice.objects.create(
                    user=u, subscription=sub, stripe_invoice_id=f"{key}_inv_{k}", number=f"LH-S{i:02d}{k:02d}",
                    currency_id="GBP", amount_minor=amount, status="paid", issued_at=paid_at,
                )  # fmt: skip
                if k:
                    SubscriptionEvent.objects.create(user=u, subscription=sub, kind="renewed", to_value=plan.code,
                                                     amount_minor=amount, at=paid_at)  # fmt: skip
                k += 1
                paid_at += timedelta(days=month)
            if cancelled:
                SubscriptionEvent.objects.create(user=u, subscription=sub, kind="cancelled", from_value=plan.code,
                                                 at=self.ago(0.5, max(1, (self.now - start).days - 1)))  # fmt: skip
            if i == 5 and len(plans) > 1:
                SubscriptionEvent.objects.create(user=u, subscription=sub, kind="upgraded", from_value=plans[0].code,
                                                 to_value=plans[1].code, at=self.ago(1, 10))  # fmt: skip
            if i == 7:
                SubscriptionEvent.objects.create(user=u, subscription=sub, kind="payment_failed",
                                                 to_value=plan.code, amount_minor=amount, at=self.ago(0.3, 5))  # fmt: skip
            added += 1
        return added

    # ------------------------------------------------------------------ tickets
    def tickets(self) -> int:
        added = 0
        for i, (category, subject, priority, status) in enumerate(TICKETS):
            ref = f"LH-C{i + 1:05d}"
            if Ticket.objects.filter(reference=ref).exists():
                continue
            u = self.people[(i * 5) % len(self.people)]
            opened = self.ago(0.5, 25)
            t = Ticket.objects.create(
                user=u, reference=ref, subject=subject, category=category, priority=priority, status=status,
                last_message_at=opened, created_at=opened,
                resolved_at=opened + timedelta(hours=self.rnd.uniform(2, 30)) if status == "resolved" else None,
            )  # fmt: skip
            TicketMessage.objects.create(ticket=t, user=u, author=u, created_at=opened,
                                         body=f"Hello, {subject.lower()}. Can you help, please?")  # fmt: skip
            if status != "open":
                reply = opened + timedelta(hours=self.rnd.uniform(1, 12))
                TicketMessage.objects.create(ticket=t, user=u, author=self.admin, created_at=reply,
                                             body="Thanks for getting in touch. We are looking into this now.")  # fmt: skip
                TicketMessage.objects.create(ticket=t, user=u, author=self.admin, created_at=reply, is_internal=True,
                                             body="Checked the logs; nothing unusual so far.")  # fmt: skip
                Ticket.objects.filter(pk=t.pk).update(last_message_at=reply)
            added += 1
        return added

    # ------------------------------------------------------------------ reviews + reports
    def reviews(self) -> int:
        added = 0
        bought = list(
            Enrollment.objects.filter(
                user__in=self.people, source="purchase", status__in=("active", "completed")
            )
            .order_by("enrolled_at")
            .values_list("user_id", "course_id", "enrolled_at")[:40]
        )
        for i, (user_id, course_id, when) in enumerate(bought):
            rating, body = REVIEWS[i % len(REVIEWS)]
            review, made = Review.objects.get_or_create(
                user_id=user_id, course_id=course_id,
                defaults={"rating": rating, "body": body, "created_at": min(self.now, when + timedelta(days=2))},
            )  # fmt: skip
            added += made
            if rating <= 2:  # the spam and the angry one get reported by two other learners
                for reporter in self.people[i % 7 : i % 7 + 2]:
                    if reporter.id == user_id:
                        continue
                    _, made = ContentReport.objects.get_or_create(
                        reporter=reporter, target_type="review", target_id=review.id,
                        defaults={"reason": "Spam or advertising" if rating == 1 else "Rude or unfair"},
                    )  # fmt: skip
                    added += made
        return added

    # ------------------------------------------------------------------ payouts
    def payout_requests(self) -> int:
        teachers = list(InstructorProfile.objects.filter(status="approved").order_by("created_at")[:4])
        plan = [("pending", 92000, ""), ("pending", 41550, ""), ("approved", 26800, ""),
                ("disputed", 18400, "The amount does not match my sales report.")]  # fmt: skip
        added = 0
        for i, (p, (status, amount, reason)) in enumerate(zip(teachers, plan, strict=False)):
            note = f"Demo request {i + 1}"
            if PayoutRequest.objects.filter(user_id=p.user_id, note=note).exists():
                continue
            PayoutRequest.objects.create(
                user_id=p.user_id, amount_gbp_minor=amount, status=status, method="stripe", note=note, reason=reason,
                decided_by=self.admin if status != "pending" else None,
                decided_at=self.ago(0.5, 3) if status != "pending" else None, created_at=self.ago(1, 9),
            )  # fmt: skip
            added += 1
        return added

    # ------------------------------------------------------------------ certificates
    def certificates(self) -> int:
        added = 0
        done = list(
            Enrollment.objects.filter(user__in=self.people, status="completed", certificate__isnull=True)
            .select_related("user", "course")
            .order_by("completed_at")[:25]
        )
        for i, e in enumerate(done):
            version = CourseVersion.objects.filter(course=e.course, status="published").first()
            if version is None:
                continue
            issued = e.completed_at or self.now
            Certificate.objects.create(
                user=e.user, enrollment=e, course=e.course, course_version=version, recipient_name=e.user.full_name,
                course_title=e.course.title, issued_at=issued,
                expires_at=self.now + timedelta(days=5 + i * 6) if i < 3 else None,
                revoked_at=self.now - timedelta(days=1) if i == 3 else None,
                revoke_reason="Issued by mistake: the course was refunded." if i == 3 else "",
            )  # fmt: skip
            added += 1
        return added

    # ------------------------------------------------------------------ broadcasts
    def broadcasts(self) -> int:
        rows = [
            ("broadcast", "New courses in data skills", "Five new data courses are live. Have a look this week.",
             "learners", "/courses", 12),
            ("announcement", "Planned maintenance on Sunday", "LearnHub will be read-only for 30 minutes on Sunday at 06:00.",
             "everyone", "", 3),
        ]  # fmt: skip
        added = 0
        learners = User.objects.filter(is_staff=False, is_active=True).count()
        for kind, title, body, audience, url, days in rows:
            if Broadcast.objects.filter(title=title, sent_by=self.admin).exists():
                continue
            Broadcast.objects.create(kind=kind, title=title, body=body, audience=audience, url=url,
                                     sent_by=self.admin, sent_at=self.now - timedelta(days=days),
                                     recipient_count=learners)  # fmt: skip
            added += 1
        return added
