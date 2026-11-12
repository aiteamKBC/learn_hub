"""Seed demo token monetisation config: token packs, the live token rate, and the
GBP custom top-up policy. Idempotent (safe to re-run), but uses demo prices and must
not be run in production without reviewing those values. Stripe checkout and webhook
handling are implemented separately and require the corresponding environment secrets.

    python manage.py seed_tokens
"""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.commerce.models import PriceTier, TokenPack, TokenRate, TopUpPolicy

# name -> (token_amount, price-tier gbp_minor, sort_order). Bigger packs give better value.
PACKS = [
    ("Starter", 500, 999, 1),  # Â£9.99  -> 50 tokens/Â£
    ("Plus", 1200, 1999, 2),  # Â£19.99 -> 60 tokens/Â£
    ("Pro", 2500, 3499, 3),  # Â£34.99 -> 71 tokens/Â£
    ("Ultimate", 6000, 5999, 4),  # Â£59.99 -> 100 tokens/Â£
]

# Base conversion for custom top-ups and course unlocks: Â£1 = 50 tokens (0.50 tokens/penny).
TOKENS_PER_GBP_MINOR = "0.50"

# Custom top-up bounds in GBP pence: Â£5 min, Â£500 max.
TOPUP = ("GBP", 500, 50000)


class Command(BaseCommand):
    help = "Seed demo token packs, rate and GBP top-up policy (review prices before production)."

    @transaction.atomic
    def handle(self, *args, **opts):
        # --- token packs ---
        for name, tokens, gbp_minor, order in PACKS:
            tier = (
                PriceTier.objects.filter(gbp_minor=gbp_minor, is_active=True).order_by("sort_order").first()
            )
            if not tier:
                self.stdout.write(self.style.WARNING(f"skip {name}: no price tier at {gbp_minor}"))
                continue
            pack, created = TokenPack.objects.get_or_create(
                name=name,
                defaults={"token_amount": tokens, "price_tier": tier, "is_active": True, "sort_order": order},
            )
            if not created:
                pack.token_amount = tokens
                pack.price_tier = tier
                pack.is_active = True
                pack.sort_order = order
                pack.save()
            self.stdout.write(
                f"{'created' if created else 'updated'} pack {name}: {tokens} tokens @ Â£{gbp_minor / 100:.2f}"
            )

        # --- live token rate (effective now; seed uses a past timestamp on purpose) ---
        if not TokenRate.current():
            TokenRate.objects.create(
                tokens_per_gbp_minor=TOKENS_PER_GBP_MINOR,
                effective_from=timezone.now() - timedelta(days=1),
                effective_to=None,
                notes="Seeded demo rate (Â£1 = 50 tokens).",
            )
            self.stdout.write("created live token rate: Â£1 = 50 tokens")
        else:
            self.stdout.write("token rate already set; left as-is")

        # --- GBP custom top-up policy ---
        cur, mn, mx = TOPUP
        policy, created = TopUpPolicy.objects.get_or_create(
            currency=cur,
            is_active=True,
            defaults={"min_minor": mn, "max_minor": mx},
        )
        if not created:
            policy.min_minor, policy.max_minor = mn, mx
            policy.save()
        self.stdout.write(
            f"{'created' if created else 'updated'} top-up policy {cur}: Â£{mn / 100:.0f}â€“Â£{mx / 100:.0f}"
        )

        self.stdout.write(self.style.SUCCESS("token seed complete"))
