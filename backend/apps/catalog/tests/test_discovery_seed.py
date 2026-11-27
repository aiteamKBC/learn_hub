"""B2C-01 discovery fixes: the additive seed top-up, the public stats endpoint, the
package "was" price, and the standardised catalog 404 — all on the real app role.

The seed fixtures are expensive (each course goes through the real authoring flow), so the
end-to-end checks share one setUp and the 404 shape lives in its own light class."""

import json

from django.core.management import call_command

from apps.catalog import services
from apps.catalog.models import Course
from apps.commerce.models import CashPackage, CashPackageCourse, CoursePrice, PriceTier
from apps.engagement import services as social
from apps.engagement.models import Review
from apps.identity.models import User
from apps.learning import services as learning
from apps.learning.models import Enrollment
from core.tenancy import tenant_context

from .test_catalog import CatalogTestBase


class DiscoverySeedTest(CatalogTestBase):
    def _published_course(self, i: int) -> Course:
        course, version = self.full_course(
            ownership=Course.Ownership.INSTRUCTOR, user=self.teacher, slug=f"disc-course-{i}"
        )
        with tenant_context(user_id=self.teacher.id):
            services.submit(version=version, by=self.teacher)
        with tenant_context(user_id=self.staff.id, staff=True):
            services.approve(version=version, reviewer=self.staff)
            # Start every course paid so the seed has something to make free / to bundle.
            tier, _ = PriceTier.objects.get_or_create(name="Tier 3", defaults={"gbp_minor": 2499})
            CoursePrice.objects.filter(course=course).update(is_free=False, tier=tier)
        return Course.objects.get(pk=course.pk)

    def setUp(self):
        super().setUp()
        self.courses = [self._published_course(i) for i in range(5)]
        # Each course gets one real, but HIDDEN, review from an enrolled learner.
        for i, course in enumerate(self.courses):
            learner = User.objects.create_user(f"learner{i}@learnhub-demo.com", "x")
            with tenant_context(user_id=learner.id):
                learning.enrol(user=learner, course=course, source=Enrollment.Source.PURCHASE)
                review = social.write_review(
                    user=learner, course_id=course.id, rating=4 + (i % 2), body="Solid course."
                )
            with tenant_context(user_id=self.staff.id, staff=True):
                social.moderate_review(review=review, hide=True)

    def test_seed_fixes_ratings_prices_levels_bundles_and_is_idempotent(self):
        # Before: every review hidden, so every course rating is zero.
        with tenant_context(user_id=self.staff.id, staff=True):
            self.assertEqual(Review.objects.filter(status="hidden").count(), 5)
            for c in self.courses:
                self.assertEqual(float(Course.objects.get(pk=c.pk).rating_avg), 0.0)

        call_command("seed_discovery_demo")

        with tenant_context(user_id=self.staff.id, staff=True):
            # Reviews now published; the rating trigger has lit up every course.
            self.assertEqual(Review.objects.filter(status="hidden").count(), 0)
            self.assertEqual(Review.objects.filter(status="published").count(), 5)
            for c in self.courses:
                fresh = Course.objects.get(pk=c.pk)
                self.assertGreater(float(fresh.rating_avg), 0.0)
                self.assertEqual(fresh.rating_count, 1)

            # Exactly two free courses; the rest keep a real paid tier.
            self.assertEqual(CoursePrice.objects.filter(is_free=True).count(), 2)
            self.assertTrue(CoursePrice.objects.filter(is_free=False, tier__isnull=False).exists())
            # The advanced facet is no longer a dead end, and some covers are set.
            self.assertTrue(Course.objects.filter(level=Course.Level.ADVANCED).exists())
            self.assertTrue(Course.objects.exclude(thumbnail_url="").exists())

            # Three active bundles, each a genuine saving (price below the courses' total).
            bundles = list(CashPackage.objects.filter(is_active=True, slug__startswith="discovery-"))
            self.assertEqual(len(bundles), 3)
            for pkg in bundles:
                links = CashPackageCourse.objects.filter(package=pkg)
                total = sum(link.snapshot_gbp_minor for link in links)
                self.assertGreaterEqual(links.count(), 2)
                self.assertLess(pkg.price_tier.gbp_minor, total)

        # Idempotent: a second run neither duplicates nor errors.
        call_command("seed_discovery_demo")
        with tenant_context(user_id=self.staff.id, staff=True):
            self.assertEqual(CashPackage.objects.filter(slug__startswith="discovery-").count(), 3)
            self.assertEqual(CoursePrice.objects.filter(is_free=True).count(), 2)
            self.assertEqual(Review.objects.filter(status="hidden").count(), 0)

    def test_stats_and_package_endpoints_are_real(self):
        call_command("seed_discovery_demo")

        stats = self.client.get("/api/v1/catalog/stats")
        self.assertEqual(stats.status_code, 200)
        data = stats.json()
        self.assertEqual(data["courses"], 5)
        self.assertEqual(data["rating_count"], 5)
        self.assertGreater(data["rating_avg"], 0.0)
        self.assertGreaterEqual(data["instructors"], 1)

        packages = self.client.get("/api/v1/commerce/tokens/packages")
        self.assertEqual(packages.status_code, 200)
        body = packages.json()
        self.assertGreaterEqual(len(body), 3)
        for pkg in body:
            self.assertIn("full_minor", pkg)
            self.assertGreater(pkg["full_minor"], pkg["amount_minor"])  # a real saving


class CatalogErrorShapeTest(CatalogTestBase):
    """No heavy fixtures: just the standardised 404 envelope for an unknown course."""

    def test_unknown_course_uses_standard_error_shape(self):
        resp = self.client.get("/api/v1/catalog/courses/this-slug-does-not-exist")
        self.assertEqual(resp.status_code, 404)
        body = json.loads(resp.content)
        self.assertIn("error", body)
        self.assertEqual(body["error"]["code"], "not_found")
