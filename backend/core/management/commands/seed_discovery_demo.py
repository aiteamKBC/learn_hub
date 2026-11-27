"""Additive, idempotent top-up for the B2C discovery surface (home + marketplace).

    python manage.py seed_discovery_demo

It NEVER resets or deletes anything and is safe to re-run. On each run it:

  * publishes the existing (currently hidden) course reviews on the live public courses,
    so the real rating trigger lights up ratings, the rating filter and "Highest rated";
  * gives the existing catalogue variety: two free courses, a spread of real price tiers,
    a few "advanced" levels, and cover thumbnails on a subset (the rest keep the generated
    CourseThumb cover);
  * creates three active, purchasable cash bundles from real published courses, each priced
    below the sum of its courses so the saving is genuine.

Everything goes through the real models/services (reviews via engagement.moderate_review,
bundles via the same validation the console uses), under a staff RLS context — the same
code paths the app uses. It only ever adds rows or sets fields on existing demo records;
it removes nothing.

Run it only against a database you are allowed to write to (local Postgres or the Neon dev
branch, with approval). It performs no destructive SQL.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.catalog.models import Course
from apps.commerce.models import CashPackage, CoursePrice, PriceTier
from apps.engagement import services as social
from apps.engagement.models import Review
from apps.identity.models import User
from apps.platform.console.packages import _guard_price, _set_courses, _validate_courses
from core.tenancy import tenant_context

# A spread of real list prices (pence) for the paid catalogue. Only tiers that already
# exist are used; none are created for courses.
PRICE_LADDER = (1499, 1999, 2499, 2999, 3499, 3999, 4499, 4999)

# Short, deterministic cover URL per course (well under the URLField's 200-char limit). The
# frontend falls back to the generated CourseThumb cover if an image fails to load, so a
# broken URL never leaves a blank card.
def _thumb(slug: str) -> str:
    return f"https://picsum.photos/seed/{slug}/800/450"


# Three bundles, as (slug, name, description, how many courses, discount). Fixed slugs keep
# the command idempotent (re-running updates the same package, never a duplicate).
BUNDLES = (
    (
        "discovery-starter-pack",
        "Starter pack",
        "Two foundational courses to get going, bought together for less.",
        2,
        0.80,
    ),
    (
        "discovery-career-boost",
        "Career boost",
        "A step up: two practical courses that build real, provable skills.",
        2,
        0.78,
    ),
    (
        "discovery-pro-track",
        "Pro track",
        "Three courses that take you from capable to confident, as one bundle.",
        3,
        0.75,
    ),
)


class Command(BaseCommand):
    help = "Additive, idempotent B2C discovery top-up: publish reviews, vary prices/levels, free courses, thumbnails, 3 bundles."

    def handle(self, *args, **opts):
        admin = (
            User.objects.filter(is_staff=True, is_active=True).order_by("created_at").first()
            or User.objects.filter(is_superuser=True).order_by("created_at").first()
        )
        if admin is None:
            raise CommandError("No staff user found. Run seed_demo first, then this top-up.")

        with tenant_context(user_id=admin.id, staff=True):
            courses = list(
                Course.objects.filter(
                    status="published",
                    live_version__isnull=False,
                    deleted_at__isnull=True,
                    owner_org_id__isnull=True,
                ).order_by("slug")
            )
            if not courses:
                raise CommandError("No published public courses found. Run seed_demo first.")

            published = self._publish_reviews(courses)
            free, priced, advanced, thumbed = self._vary_catalogue(admin, courses)
            bundles = self._build_bundles(admin, courses)

        self.stdout.write(self.style.SUCCESS("Discovery demo top-up complete:"))
        self.stdout.write(f"  reviews published : {published}")
        self.stdout.write(f"  free courses      : {free}")
        self.stdout.write(f"  priced courses    : {priced}")
        self.stdout.write(f"  advanced levels   : {advanced}")
        self.stdout.write(f"  thumbnails set    : {thumbed}")
        self.stdout.write(f"  active bundles    : {bundles}")

    # ------------------------------------------------------------------ reviews
    def _publish_reviews(self, courses) -> int:
        """Publish the hidden reviews on these courses. The DB counter trigger then
        recomputes rating_avg / rating_count. Idempotent: already-published reviews are
        skipped (nothing is hidden by this command)."""
        hidden = list(Review.objects.filter(course__in=courses, status="hidden").select_related("course"))
        for review in hidden:
            social.moderate_review(review=review, hide=False)
        return len(hidden)

    # ------------------------------------------------------------------ catalogue variety
    def _vary_catalogue(self, admin, courses) -> tuple[int, int, int, int]:
        """Two free courses, a spread of real price tiers, a few advanced levels, and cover
        thumbnails on a subset. Deterministic by slug order, so re-runs are stable."""
        ladder = {t.gbp_minor: t for t in PriceTier.objects.filter(gbp_minor__in=PRICE_LADDER)}
        tiers = [ladder[p] for p in PRICE_LADDER if p in ladder]
        if not tiers:
            raise CommandError("Expected price tiers are missing; cannot vary prices.")

        # The two least-popular courses become free intro courses.
        by_students = sorted(courses, key=lambda c: (c.student_count, c.slug))
        free_ids = {c.id for c in by_students[:2]}

        # Guarantee the "advanced" facet exists: the three priciest paid courses.
        paid_sorted = [c for c in courses if c.id not in free_ids]
        advanced_ids = {c.id for c in sorted(paid_sorted, key=lambda c: c.slug)[-3:]}

        free = priced = advanced = thumbed = 0
        for i, course in enumerate(courses):
            price, _ = CoursePrice.objects.get_or_create(course=course, defaults={"is_free": False})
            if course.id in free_ids:
                if not price.is_free or price.tier_id is not None:
                    price.is_free, price.tier = True, None
                    price.save(update_fields=["is_free", "tier", "updated_at"])
                free += 1
            else:
                tier = tiers[i % len(tiers)]
                if price.is_free or price.tier_id != tier.id:
                    price.is_free, price.tier = False, tier
                    price.save(update_fields=["is_free", "tier", "updated_at"])
                priced += 1

            fields = {}
            if course.id in advanced_ids and course.level != Course.Level.ADVANCED:
                fields["level"] = Course.Level.ADVANCED
                advanced += 1
            elif course.id in advanced_ids:
                advanced += 1
            # Thumbnail on every other course; the rest keep the generated CourseThumb cover.
            if i % 2 == 0:
                want = _thumb(course.slug)
                if course.thumbnail_url != want:
                    fields["thumbnail_url"] = want
                thumbed += 1
            if fields:
                Course.objects.filter(pk=course.pk).update(**fields)
        return free, priced, advanced, thumbed

    # ------------------------------------------------------------------ bundles
    def _build_bundles(self, admin, courses) -> int:
        """Three active cash bundles from real paid courses, each priced below the sum of
        its courses so the saving is real. Idempotent via fixed slugs."""
        # Only paid, published courses can go in a sellable bundle (free ones have nothing to
        # discount). Stable order by slug.
        paid = [c for c in courses if not CoursePrice.objects.filter(course=c, is_free=True).exists()]
        if len(paid) < 3:
            self.stdout.write(self.style.WARNING("Not enough paid courses for bundles; skipped."))
            return 0

        made = 0
        for idx, (slug, name, description, size, discount) in enumerate(BUNDLES):
            # Pick `size` distinct paid courses, cycling from a rotating start so each bundle
            # differs. Modulo indexing never yields an empty set, however few paid courses exist.
            start = (idx * 2) % len(paid)
            picks = [paid[(start + k) % len(paid)] for k in range(min(size, len(paid)))]
            ids = [c.id for c in picks]

            valid_ids, snapshots = _validate_courses(ids)
            total = sum(snapshots.values())
            if total <= 0:
                continue
            bundle_price = max(100, int(round(total * discount / 100)) * 100 - 1)  # e.g. 3999

            tier = self._bundle_tier(slug, bundle_price, total)
            _guard_price(tier, snapshots)

            pkg, created = CashPackage.objects.get_or_create(
                slug=slug,
                defaults={
                    "name": name,
                    "description": description,
                    "price_tier": tier,
                    "is_active": True,
                    "created_by": admin,
                },
            )
            changed = []
            if not created:
                if pkg.price_tier_id != tier.id:
                    pkg.price_tier = tier
                    changed.append("price_tier")
                if not pkg.is_active:
                    pkg.is_active = True
                    changed.append("is_active")
                if pkg.name != name:
                    pkg.name, pkg.description = name, description
                    changed += ["name", "description"]
                if changed:
                    pkg.save(update_fields=[*changed, "updated_at"])
            _set_courses(pkg, valid_ids, snapshots)
            made += 1
        return made

    def _bundle_tier(self, slug: str, price_minor: int, course_total: int) -> PriceTier:
        """A dedicated, idempotent price tier for a bundle, always below the course total."""
        price_minor = min(price_minor, course_total - 1) if course_total > 1 else price_minor
        name = f"Bundle: {slug}"
        tier, _ = PriceTier.objects.get_or_create(name=name, defaults={"gbp_minor": price_minor})
        if tier.gbp_minor != price_minor:
            tier.gbp_minor = price_minor
            tier.save(update_fields=["gbp_minor", "updated_at"])
        return tier
