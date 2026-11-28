"""The platform admin decides per course: recorded seats, live training, or both."""

from apps.corporate.tests import test_company_http as base
from core.tests.base import SchemaTransactionTestCase


class DeliverySwitchTest(SchemaTransactionTestCase):
    setUp = base.CompanyHttpTest.setUp
    _post = base.CompanyHttpTest._post
    _get = base.CompanyHttpTest._get

    def _switch(self, **body):
        self.client.force_login(self.staff)
        return self.client.post(
            f"/api/v1/console/corporate/delivery/{self.course.id}", body, content_type="application/json"
        )

    def _kinds(self):
        self.client.logout()
        out = {}
        for d in ("recorded", "live", "both"):
            items = self.client.get(f"/api/v1/catalog/courses?limit=60&delivery={d}").json()["items"]
            out[d] = any(c["id"] == str(self.course.id) for c in items)
        return out

    def test_recorded_off_makes_course_live_only(self):
        # tabs are exclusive: a course with both shows only under "Recorded and live"
        self.assertEqual(self._kinds(), {"recorded": False, "live": False, "both": True})
        self.assertEqual(self._switch(recorded=False).status_code, 200)
        self.assertEqual(self._kinds(), {"recorded": False, "live": True, "both": False})
        # companies can no longer buy recorded seats in it
        packages = self._get("/packages").json()
        self.assertFalse(
            any(p["course_id"] == str(self.course.id) and p["delivery_type"] == "recorded" for p in packages)
        )
        r = self._post(
            f"/packages/{self.course.id}/checkout", {"quantity": 1, "employees": [{"email": "a@example.com"}]}
        )
        self.assertEqual(r.status_code, 404, r.content)
        # and back on
        self._switch(recorded=True)
        self.assertTrue(self._kinds()["both"])

    def test_live_off_and_only_staff_may_switch(self):
        self._switch(live=False)
        self.assertEqual(self._kinds(), {"recorded": True, "live": False, "both": False})
        self.client.force_login(self.admin)
        r = self.client.post(
            f"/api/v1/console/corporate/delivery/{self.course.id}",
            {"live": True},
            content_type="application/json",
        )
        self.assertIn(r.status_code, (401, 403))
