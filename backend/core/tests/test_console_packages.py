"""Console > Packages (B2C cash bundles): staff CRUD, course set, soft delete, audit.
Mirrors the admin frontend in pages/console/b2c/AdminPackagesPage.tsx."""

from apps.commerce.models import CashPackage, CashPackageCourse
from apps.commerce.tests.test_commerce import CommerceBase

API = "/api/v1/console"


class ConsolePackagesTest(CommerceBase):
    def test_staff_create_update_and_deactivate_package(self):
        self.client.force_login(self.staff)

        # create a bundle of two courses at Tier 5 (£34.99)
        r = self.client.post(
            f"{API}/packages",
            {
                "name": "Starter bundle",
                "description": "Two to get going.",
                "price_tier_id": str(self.tier5.id),
                "course_ids": [str(self.python.id), str(self.sql.id)],
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        pkg_id = r.json()["id"]

        # it shows in the list with the right price and course count
        rows = self.client.get(f"{API}/packages").json()
        row = next(p for p in rows if p["id"] == pkg_id)
        self.assertEqual(row["price_gbp_minor"], 3499)
        self.assertEqual(row["course_count"], 2)
        self.assertTrue(row["is_active"])

        # the snapshot price is stored per included course
        snaps = set(
            CashPackageCourse.objects.filter(package_id=pkg_id).values_list("snapshot_gbp_minor", flat=True)
        )
        self.assertTrue(snaps and 0 not in snaps)

        # update: rename and drop one course
        r = self.client.patch(
            f"{API}/packages/{pkg_id}",
            {"name": "Just Python", "course_ids": [str(self.python.id)]},
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(CashPackage.objects.get(id=pkg_id).name, "Just Python")
        self.assertEqual(CashPackageCourse.objects.filter(package_id=pkg_id).count(), 1)

        # soft delete: deactivate, buyers keep access (row stays)
        r = self.client.delete(f"{API}/packages/{pkg_id}")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(CashPackage.objects.get(id=pkg_id).is_active)

        # every change is audited
        actions = {a["action"] for a in self.client.get(f"{API}/audit?action=cash_package.").json()["items"]}
        self.assertTrue({"cash_package.create", "cash_package.update", "cash_package.deactivate"} <= actions)

    def test_bundle_cannot_cost_more_than_buying_separately(self):
        self.client.force_login(self.staff)
        from apps.commerce.models import PriceTier

        # python (Tier 5 = 3499) + sql (Tier 1 = 1499) -> separate total 4998.
        too_high = PriceTier.objects.filter(gbp_minor__gt=4998, is_active=True).order_by("gbp_minor").first()
        r = self.client.post(
            f"{API}/packages",
            {
                "name": "Rip-off",
                "price_tier_id": str(too_high.id),
                "course_ids": [str(self.python.id), str(self.sql.id)],
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "price_too_high")

    def test_unpublished_course_is_rejected(self):
        self.client.force_login(self.staff)
        from apps.catalog.models import Course

        draft = Course.objects.filter(owner_org_id__isnull=True).exclude(status="published").first()
        if draft is None:
            self.skipTest("no unpublished course available")
        r = self.client.post(
            f"{API}/packages",
            {
                "name": "Has a draft",
                "price_tier_id": str(self.tier5.id),
                "course_ids": [str(draft.id)],
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 400)

    def test_non_staff_cannot_manage_packages(self):
        self.client.force_login(self.sara)
        r = self.client.get(f"{API}/packages")
        self.assertIn(r.status_code, (401, 403))
