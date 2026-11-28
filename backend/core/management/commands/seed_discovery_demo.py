"""Additive, idempotent top-up for the B2C discovery surface (home + marketplace).

    python manage.py seed_discovery_demo

It NEVER resets or deletes anything and is safe to re-run. On each run it:

  * publishes the existing (currently hidden) reviews on the known demo courses, so the
    real rating trigger lights up ratings, the rating filter and "Highest rated";
  * gives the demo catalogue variety: two free courses, a spread of real price tiers and
    a few "advanced" levels. Thumbnails are left blank so `CourseThumb` renders the
    approved local category cover (no external image hosts);
  * creates three active, purchasable cash bundles from real demo paid courses, each
    priced below the sum of its courses so the saving is genuine.

The mutation surface is restricted to the fixed demo-course slug list (`demo_content`):
any other published public course on the database is NEVER touched. Free-course identity
and bundle membership are deterministic from the slug list — they never shift based on
learner activity like `student_count`.

Safety: refuses to run against a non-debug settings profile unless `--allow-production`
is passed; existing purchases, entitlements and unrelated team changes are preserved
(the command only adds rows or sets fields on demo-course records).
"""

from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.catalog.models import Course
from apps.commerce.models import CashPackage, CoursePrice, PriceTier
from apps.engagement import services as social
from apps.engagement.models import Review
from apps.identity.models import User
from apps.platform.console.packages import _guard_price, _set_courses, _validate_courses
from core.management.commands.demo_content import LIBRARY, MARKETPLACE
from core.tenancy import tenant_context

# The B2C demo course identities — the ONLY public courses this command touches. Any other
# published public course (including real content that may exist on the database) is
# deliberately left alone. Order matters: the first two are the stable free courses, and
# the last three are the stable "advanced" ones. Changing this order is a demo-identity
# change, not a cosmetic one.
DEMO_SLUGS: tuple[str, ...] = tuple(sorted({s["slug"] for s in (*MARKETPLACE, *LIBRARY)}))
FREE_SLUGS: tuple[str, ...] = DEMO_SLUGS[:2]
ADVANCED_SLUGS: tuple[str, ...] = DEMO_SLUGS[-3:]

# A spread of real list prices (pence) for the paid demo catalogue. Only tiers that
# already exist on the database are used; the command never creates course price tiers.
PRICE_LADDER = (1499, 1999, 2499, 2999, 3499, 3999, 4499, 4999)

# Three bundles, as (slug, name, description, how many courses, discount). Fixed slugs
# keep the command idempotent (re-running updates the same package, never a duplicate).
BUNDLES = (
    ("discovery-starter-pack", "Starter pack",
     "Two foundational courses to get going, bought together for less.", 2, 0.80),
    ("discovery-career-boost", "Career boost",
     "A step up: two practical courses that build real, provable skills.", 2, 0.78),
    ("discovery-pro-track", "Pro track",
     "Three courses that take you from capable to confident, as one bundle.", 3, 0.75),
)  # fmt: skip


class Command(BaseCommand):
    help = "Additive, idempotent B2C discovery top-up for the demo catalogue."

    def add_arguments(self, parser):
        parser.add_argument(
            "--allow-production",
            action="store_true",
            help="Permit running against a non-debug settings profile (off by default).",
        )

    def handle(self, *args, **opts):
        if not settings.DEBUG and not opts.get("allow_production"):
            raise CommandError(
                "Refusing to run against a non-debug settings profile. Pass "
                "--allow-production only if the target database is approved for writes."
            )

        admin = (
            User.objects.filter(is_staff=True, is_active=True).order_by("created_at").first()
            or User.objects.filter(is_superuser=True).order_by("created_at").first()
        )
        if admin is None:
            raise CommandError("No staff user found. Run seed_demo first, then this top-up.")

        with tenant_context(user_id=admin.id, staff=True):
            # Restrict every mutation to the known demo slugs and in stable slug order.
            courses = list(
                Course.objects.filter(
                    slug__in=DEMO_SLUGS,
                    status="published",
                    live_version__isnull=False,
                    deleted_at__isnull=True,
                    owner_org_id__isnull=True,
                ).order_by("slug")
            )
            if not courses:
                raise CommandError(
                    "No published demo courses found (expected slugs from demo_content). Run seed_demo first."
                )

            published = self._publish_reviews(courses)
            free, priced, advanced = self._vary_catalogue(courses)
            bundles = self._build_bundles(admin, courses)

        self.stdout.write(self.style.SUCCESS("Discovery demo top-up complete:"))
        self.stdout.write(f"  reviews published : {published}")
        self.stdout.write(f"  free courses      : {free}")
        self.stdout.write(f"  priced courses    : {priced}")
        self.stdout.write(f"  advanced levels   : {advanced}")
        self.stdout.write(f"  active bundles    : {bundles}")

    # ------------------------------------------------------------------ reviews
    def _publish_reviews(self, courses) -> int:
        """Publish the hidden reviews on the demo courses (nothing else). The DB counter
        trigger then recomputes rating_avg / rating_count. Idempotent: reviews that are
        already published are skipped, and this command never hides a review."""
        hidden = list(Review.objects.filter(course__in=courses, status="hidden").select_related("course"))
        for review in hidden:
            social.moderate_review(review=review, hide=False)
        return len(hidden)

    # ------------------------------------------------------------------ catalogue variety
    def _vary_catalogue(self, courses) -> tuple[int, int, int]:
        """Stable identities, independent of learner activity: free courses come from
        FREE_SLUGS, advanced levels from ADVANCED_SLUGS, both derived from the demo slug
        list. `Course.is_free` and `CoursePrice.is_free` are kept in sync so the catalog
        filter, the pricing module and the admin console agree. Course thumbnails are
        intentionally left blank — CourseThumb renders the approved local category cover
        from `components/ui/course-thumb.tsx`, so no external image host is touched."""
        ladder = {t.gbp_minor: t for t in PriceTier.objects.filter(gbp_minor__in=PRICE_LADDER)}
        tiers = [ladder[p] for p in PRICE_LADDER if p in ladder]
        if not tiers:
            raise CommandError("Expected price tiers are missing; cannot vary prices.")

        free_slugs = set(FREE_SLUGS)
        advanced_slugs = set(ADVANCED_SLUGS) - free_slugs

        free = priced = advanced = 0
        for i, course in enumerate(courses):
            price, _ = CoursePrice.objects.get_or_create(course=course, defaults={"is_free": False})
            is_free_now = course.slug in free_slugs

            if is_free_now:
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
            # Keep the Course.is_free flag in sync with CoursePrice so services, selectors
            # and the console stay consistent. The pricing module uses CoursePrice, but
            # Course.is_free is cloned on version publish and surfaces in a few places.
            if course.is_free != is_free_now:
                fields["is_free"] = is_free_now
            if course.slug in advanced_slugs:
                if course.level != Course.Level.ADVANCED:
                    fields["level"] = Course.Level.ADVANCED
                advanced += 1
            # Clear any previously-set external thumbnail so the local generated cover is
            # used. The command no longer writes external image URLs.
            if course.thumbnail_url:
                fields["thumbnail_url"] = ""
            if fields:
                Course.objects.filter(pk=course.pk).update(**fields)
        return free, priced, advanced

    # ------------------------------------------------------------------ bundles
    def _build_bundles(self, admin, courses) -> int:
        """Three active cash bundles. Membership is derived from a stable, slug-ordered
        selection of demo paid courses — never from learner activity."""
        paid = [c for c in courses if c.slug not in set(FREE_SLUGS)]
        if len(paid) < 3:
            self.stdout.write(self.style.WARNING("Not enough demo paid courses for bundles; skipped."))
            return 0

        made = 0
        for idx, (slug, name, description, size, discount) in enumerate(BUNDLES):
            # Stable, deterministic picks: rotate the start by bundle index, then cycle
            # through paid courses in slug order. Independent of enrolments and ratings.
            start = (idx * 2) % len(paid)
            picks = [paid[(start + k) % len(paid)] for k in range(min(size, len(paid)))]
            ids = [c.id for c in picks]

            valid_ids, snapshots = _validate_courses(ids)
            total = sum(snapshots.values())
            if total <= 0:
                continue
            bundle_price = max(100, int(round(total * discount / 100)) * 100 - 1)

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
        price_minor = min(price_minor, course_total - 1) if course_total > 1 else price_minor
        name = f"Bundle: {slug}"
        tier, _ = PriceTier.objects.get_or_create(name=name, defaults={"gbp_minor": price_minor})
        if tier.gbp_minor != price_minor:
            tier.gbp_minor = price_minor
            tier.save(update_fields=["gbp_minor", "updated_at"])
        return tier
