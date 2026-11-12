"""Seed the unlimited B2C personal subscription: converts the personal monthly/yearly
plans to kind=unlimited_b2c and ensures their prices (with Stripe price ids).

Writes go through the OWNER connection because RLS blocks the app role from creating
unlimited_b2c plans by design (they are seed/config, like migrations). Idempotent.

    python manage.py seed_b2c_subscription

Access model: a plan with no explicit course list grants every course marked
`in_subscription=True`; admins exclude a course by turning that flag off.
"""

from django.core.management.base import BaseCommand

from apps.commerce.models import Plan, PlanPrice, Currency
from apps.platform.console import subscriptions as cs

DB = "owner"  # RLS bypass; required for unlimited_b2c plans.

# Yearly prices (minor units). Monthly already seeded at £19.99/€22.99/$23.99.
YEARLY = {"GBP": 19188, "EUR": 21988, "USD": 22988}


class Command(BaseCommand):
    help = "Convert personal plans to unlimited_b2c and set yearly prices (owner connection)."

    def handle(self, *args, **opts):
        for code in ("personal-monthly", "personal-yearly"):
            try:
                p = Plan.objects.using(DB).get(code=code)
            except Plan.DoesNotExist:
                self.stdout.write(self.style.WARNING(f"plan {code} not found; skipped"))
                continue
            if p.kind != "unlimited_b2c":
                p.kind = "unlimited_b2c"
                p.is_active = True
                p.save(using=DB, update_fields=["kind", "is_active", "updated_at"])
                self.stdout.write(f"{code}: kind -> unlimited_b2c")
            else:
                self.stdout.write(f"{code}: already unlimited_b2c")

        yearly = Plan.objects.using(DB).get(code="personal-yearly")
        for ccode, minor in YEARLY.items():
            if not Currency.objects.using(DB).filter(code=ccode).exists():
                self.stdout.write(self.style.WARNING(f"skip {ccode}: no currency row"))
                continue
            existing = PlanPrice.objects.using(DB).filter(plan=yearly, currency_id=ccode).first()
            if existing and existing.stripe_price_id:
                self.stdout.write(f"yearly {ccode}: already set ({existing.amount_minor})")
                continue
            # create_price hits Stripe (sandbox); idempotency key guards duplicates.
            price_id = cs._stripe_price(yearly, ccode, minor)
            PlanPrice.objects.using(DB).update_or_create(
                plan=yearly, currency_id=ccode,
                defaults={"amount_minor": minor, "stripe_price_id": price_id},
            )
            self.stdout.write(f"yearly {ccode}: {minor} -> stripe {price_id[:14]}...")

        self.stdout.write(self.style.SUCCESS("b2c subscription seed complete"))
