"""B2C-03 (M8 / M13) — additive catalog columns compile, default, and persist."""

from apps.catalog import services as cat
from apps.catalog.models import Course, Lecture, LectureResource, VideoLibrary
from apps.commerce.models import PriceTier
from apps.identity.models import User
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class TokenPricingColumnsTests(SchemaTransactionTestCase):
    def setUp(self):
        self.staff = User.objects.create_user("s-tpc@learnhub-demo.com", "x", is_staff=True)
        with tenant_context(user_id=self.staff.id, staff=True):
            self.tier, _ = PriceTier.objects.get_or_create(name="Tier-TPC", defaults={"gbp_minor": 2000})
            VideoLibrary.objects.get_or_create(
                environment="test",
                bunny_library_id=98,
                defaults={"name": "L-tpc", "cdn_hostname": "vz-tpc.test"},
            )
        self.course = cat.create_course(
            title="TPC",
            slug="tpc",
            ownership="platform",
            created_by=self.staff,
            owner_org_id=None,
        )
        v = self.course.versions.get()
        sec = cat.add_section(version=v, title="S")
        self.lec = cat.add_lecture(section=sec, kind="article", title="L0", body="hi")
        cat.submit(version=v, by=self.staff)
        self.course.refresh_from_db()

    def test_course_token_defaults(self):
        self.assertIsNone(self.course.cash_price_tier)
        self.assertIsNone(self.course.full_course_token_price)
        self.assertEqual(self.course.token_pricing_mode, "manual")

    def test_course_set_and_persist(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            self.course.cash_price_tier = self.tier
            self.course.full_course_token_price = 500
            self.course.token_pricing_mode = "auto_weighted"
            self.course.save(
                update_fields=[
                    "cash_price_tier",
                    "full_course_token_price",
                    "token_pricing_mode",
                ]
            )
            reloaded = Course.objects.get(pk=self.course.pk)
        self.assertEqual(reloaded.cash_price_tier_id, self.tier.id)
        self.assertEqual(reloaded.full_course_token_price, 500)
        self.assertEqual(reloaded.token_pricing_mode, "auto_weighted")

    def test_lecture_token_defaults(self):
        self.assertIsNone(self.lec.token_price)
        self.assertFalse(self.lec.is_free_preview)

    def test_lecture_set_and_persist(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            self.lec.token_price = 20
            self.lec.is_free_preview = True
            self.lec.save(update_fields=["token_price", "is_free_preview"])
            reloaded = Lecture.objects.get(pk=self.lec.pk)
        self.assertEqual(reloaded.token_price, 20)
        self.assertTrue(reloaded.is_free_preview)

    def test_material_token_defaults(self):
        with tenant_context(user_id=self.staff.id, staff=True):
            from apps.catalog.models import MediaAsset

            asset = MediaAsset.objects.create(kind="document", uploaded_by=self.staff)
            mat = LectureResource.objects.create(
                lecture=self.lec,
                asset=asset,
                title="pdf",
                position=0,
            )
        self.assertIsNone(mat.token_price)
        self.assertFalse(mat.is_free_preview)
