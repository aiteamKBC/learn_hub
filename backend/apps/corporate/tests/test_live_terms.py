"""Live payment plans per course (platform admin): deposit for the first months, then
instalments; the parts must cover the whole course."""

from apps.corporate.models import LiveCourseTerms
from apps.corporate.tests import test_company_http as base
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

URL = "/api/v1/console/corporate/live-terms"


class LiveTermsTest(SchemaTransactionTestCase):
    setUp = base.CompanyHttpTest.setUp

    def _put(self, body, user=None):
        self.client.force_login(user or self.staff)
        return self.client.put(f"{URL}/{self.course.id}", body, content_type="application/json")

    def _plan(self, **over):
        body = {
            "programme_months": 6,
            "deposit_months": 2,
            "deposit_minor": 20000,
            "instalments": [{"months": 2, "amount_minor": 20000}, {"months": 2, "amount_minor": 20000}],
            "private_price_minor": 300000,
        }
        return {**body, **over}

    def test_admin_sets_plan_and_sees_it(self):
        self.assertEqual(self._put(self._plan()).status_code, 200)
        rows = self.client.get(URL).json()
        mine = next(r for r in rows if r["course_id"] == str(self.course.id))
        self.assertEqual(
            (mine["seat_price_minor"], mine["deposit_months"], mine["private_price_minor"]),
            (60000, 2, 300000),
        )
        # saving again updates the same row
        self._put(self._plan(deposit_minor=25000))
        with tenant_context(staff=True):
            self.assertEqual(LiveCourseTerms.objects.filter(course=self.course).count(), 1)
            self.assertEqual(LiveCourseTerms.objects.get(course=self.course).deposit_minor, 25000)

    def test_parts_must_cover_the_course(self):
        r = self._put(self._plan(instalments=[{"months": 2, "amount_minor": 1}]))
        self.assertEqual(r.json()["error"]["code"], "bad_terms", r.content)

    def test_only_live_courses_and_only_staff(self):
        with tenant_context(staff=True):
            self.live.is_active = False
            self.live.save(update_fields=["is_active"])
        self.assertEqual(self._put(self._plan()).json()["error"]["code"], "not_live")
        self.assertIn(self._put(self._plan(), user=self.admin).status_code, (401, 403))
