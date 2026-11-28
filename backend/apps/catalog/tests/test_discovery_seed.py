"""B2C-01 discovery fixes: the additive seed top-up, the public stats endpoint, the
package "was" price, and the standardised catalog 404 — all on the real app role.

The seed fixtures are expensive (each course goes through the real authoring flow), so
the end-to-end checks share one setUp and the 404 shape lives in its own light class.

The seed is scoped to a fixed list of demo slugs (`DEMO_SLUGS` from the command module).
Tests override that list with their own test-course slugs so the real demo slug list and
the test data stay independent."""

import json
from unittest import mock

from django.core.management import call_command

from apps.catalog import services
from apps.catalog.models import Course
from apps.commerce.models import CashPackage, CashPackageCourse, CoursePrice, PriceTier
from apps.engagement import services as social
from apps.engagement.models import Review
from apps.identity.models import User
from apps.learning import services as learning
from apps.learning.models import Enrollment
from core.management.commands import seed_discovery_demo
from core.tenancy import tenant_context

from .test_catalog import CatalogTestBase

# Five stable test slugs; the first two are "free" and the last three "advanced".
TEST_SLUGS = tuple(f"disc-course-{i}" for i in range(5))


class _patch_demo_slugs:
    """Point the seed at the test courses and keep its stable-identity invariants.

    Also forces `settings.DEBUG=True` for the duration: Django's test runner sets
    DEBUG=False by default, which would otherwise trip the production guard."""

    def __enter__(self):
        self._slugs = mock.patch.multiple(
            seed_discovery_demo,
            DEMO_SLUGS=TEST_SLUGS,
            FREE_SLUGS=TEST_SLUGS[:2],
            ADVANCED_SLUGS=TEST_SLUGS[-3:],
        )
        self._debug = mock.patch.object(seed_discovery_demo.settings, "DEBUG", True)
        self._slugs.start()
        self._debug.start()
        return self

    def __exit__(self, *exc):
        self._debug.stop()
        self._slugs.stop()


class DiscoverySeedTest(CatalogTestBase):
    def _published_course(self, i: int) -> Course:
        course, version = self.full_course(
            ownership=Course.Ownership.INSTRUCTOR, user=self.teacher, slug=TEST_SLUGS[i]
        )
        with tenant_context(user_id=self.teacher.id):
            services.submit(version=version, by=self.teacher)
        with tenant_context(user_id=self.staff.id, staff=True):
            services.approve(version=version, reviewer=self.staff)
            tier, _ = PriceTier.objects.get_or_create(name="Tier 3", defaults={"gbp_minor": 2499})
            CoursePrice.objects.filter(course=course).update(is_free=False, tier=tier)
        return Course.objects.get(pk=course.pk)

    def setUp(self):
        super().setUp()
        self.courses = [self._published_course(i) for i in range(5)]
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
        with tenant_context(user_id=self.staff.id, staff=True):
            self.assertEqual(Review.objects.filter(status="hidden").count(), 5)
            for c in self.courses:
                self.assertEqual(float(Course.objects.get(pk=c.pk).rating_avg), 0.0)

        with _patch_demo_slugs():
            call_command("seed_discovery_demo")

        with tenant_context(user_id=self.staff.id, staff=True):
            self.assertEqual(Review.objects.filter(status="hidden").count(), 0)
            self.assertEqual(Review.objects.filter(status="published").count(), 5)
            for c in self.courses:
                fresh = Course.objects.get(pk=c.pk)
                self.assertGreater(float(fresh.rating_avg), 0.0)
                self.assertEqual(fresh.rating_count, 1)

            # Stable free-course identity: the first two slugs, independent of enrolments.
            free_slugs = set(CoursePrice.objects.filter(is_free=True).values_list("course__slug", flat=True))
            self.assertEqual(free_slugs, set(TEST_SLUGS[:2]))
            # Course.is_free and CoursePrice.is_free stay in sync everywhere.
            for c in self.courses:
                fresh = Course.objects.get(pk=c.pk)
                price = CoursePrice.objects.get(course=fresh)
                self.assertEqual(fresh.is_free, price.is_free)

            self.assertTrue(Course.objects.filter(level=Course.Level.ADVANCED).exists())
            # Thumbnails are never set to an external URL by the seed.
            self.assertFalse(Course.objects.exclude(thumbnail_url="").exists())

            bundles = list(CashPackage.objects.filter(is_active=True, slug__startswith="discovery-"))
            self.assertEqual(len(bundles), 3)
            bundle_memberships_before = {
                pkg.slug: frozenset(
                    CashPackageCourse.objects.filter(package=pkg).values_list("course__slug", flat=True)
                )
                for pkg in bundles
            }
            for pkg in bundles:
                links = CashPackageCourse.objects.filter(package=pkg)
                total = sum(link.snapshot_gbp_minor for link in links)
                self.assertGreaterEqual(links.count(), 2)
                self.assertLess(pkg.price_tier.gbp_minor, total)

        # Learner activity: a fresh purchase changes student_count. Stable identity means
        # the rerun must NOT shift which courses are free or which are in which bundle.
        with tenant_context(user_id=self.staff.id, staff=True):
            Course.objects.filter(pk=self.courses[0].pk).update(student_count=999)

        with _patch_demo_slugs():
            call_command("seed_discovery_demo")

        with tenant_context(user_id=self.staff.id, staff=True):
            self.assertEqual(CashPackage.objects.filter(slug__startswith="discovery-").count(), 3)
            self.assertEqual(CoursePrice.objects.filter(is_free=True).count(), 2)
            free_slugs_again = set(
                CoursePrice.objects.filter(is_free=True).values_list("course__slug", flat=True)
            )
            self.assertEqual(free_slugs_again, set(TEST_SLUGS[:2]))
            self.assertEqual(Review.objects.filter(status="hidden").count(), 0)
            bundle_memberships_after = {
                pkg.slug: frozenset(
                    CashPackageCourse.objects.filter(package=pkg).values_list("course__slug", flat=True)
                )
                for pkg in CashPackage.objects.filter(is_active=True, slug__startswith="discovery-")
            }
            self.assertEqual(bundle_memberships_before, bundle_memberships_after)

    def test_seed_does_not_touch_non_demo_courses(self):
        # A published public course NOT in the demo slug list must be untouched.
        extra, version = self.full_course(
            ownership=Course.Ownership.INSTRUCTOR, user=self.teacher, slug="untouched-course"
        )
        with tenant_context(user_id=self.teacher.id):
            services.submit(version=version, by=self.teacher)
        with tenant_context(user_id=self.staff.id, staff=True):
            services.approve(version=version, reviewer=self.staff)
            CoursePrice.objects.filter(course=extra).update(is_free=False, tier=None)
            Course.objects.filter(pk=extra.pk).update(
                is_free=False, level=Course.Level.BEGINNER, thumbnail_url="https://example.com/x.jpg"
            )

        with _patch_demo_slugs():
            call_command("seed_discovery_demo")

        with tenant_context(user_id=self.staff.id, staff=True):
            fresh = Course.objects.get(pk=extra.pk)
            self.assertEqual(fresh.level, Course.Level.BEGINNER)
            self.assertFalse(fresh.is_free)
            self.assertEqual(fresh.thumbnail_url, "https://example.com/x.jpg")

    def test_stats_and_package_endpoints_are_real(self):
        with _patch_demo_slugs():
            call_command("seed_discovery_demo")

        stats = self.client.get("/api/v1/catalog/stats")
        self.assertEqual(stats.status_code, 200)
        data = stats.json()
        self.assertEqual(data["courses"], 5)
        self.assertIn("enrollments", data)  # labelled accurately: enrolment total, not unique learners
        self.assertEqual(data["rating_count"], 5)
        self.assertGreater(data["rating_avg"], 0.0)
        self.assertGreaterEqual(data["instructors"], 1)

        packages = self.client.get("/api/v1/commerce/tokens/packages")
        self.assertEqual(packages.status_code, 200)
        body = packages.json()
        self.assertGreaterEqual(len(body), 3)
        for pkg in body:
            self.assertIn("full_minor", pkg)
            self.assertGreater(pkg["full_minor"], pkg["amount_minor"])


class CatalogErrorShapeTest(CatalogTestBase):
    """No heavy fixtures: just the standardised 404 envelope for an unknown course."""

    def test_unknown_course_uses_standard_error_shape(self):
        resp = self.client.get("/api/v1/catalog/courses/this-slug-does-not-exist")
        self.assertEqual(resp.status_code, 404)
        body = json.loads(resp.content)
        self.assertIn("error", body)
        self.assertEqual(body["error"]["code"], "not_found")


class DiscoverySeedProductionGuardTest(CatalogTestBase):
    """The seed must refuse to run against a non-debug settings profile unless the
    operator explicitly passes --allow-production."""

    def test_refuses_when_debug_false_without_flag(self):
        from django.core.management.base import CommandError

        with mock.patch.object(seed_discovery_demo.settings, "DEBUG", False):
            with self.assertRaises(CommandError):
                call_command("seed_discovery_demo")
