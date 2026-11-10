"""Settings > default currency decides a new visitor's first currency; a choice in the URL
or a signed-in user's saved preference still wins."""

from apps.commerce.models import Currency
from apps.platform import services as platform
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

COURSE = "/api/v1/catalog/courses/py"


class DefaultCurrencyTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, _ = f.users()
        f.money(self.staff)
        f.course(staff=self.staff, owner=self.teacher, slug="py", title="Python basics")

    def currency(self, url=COURSE):
        return self.client.get(url).json()["price"]["currency"]

    def test_default_currency_setting(self):
        self.assertEqual(self.currency(), "GBP")  # out of the box
        with tenant_context(user_id=self.staff.id, staff=True):
            platform.set_setting(key="general.default_currency", value="USD", by=self.staff)
        self.assertEqual(self.currency(), "USD")  # a new visitor
        self.assertEqual(self.currency(COURSE + "?currency=GBP"), "GBP")  # their own pick wins
        self.sara.preferred_currency = "EUR"
        self.sara.save(update_fields=["preferred_currency"])
        self.client.force_login(self.sara)
        self.assertEqual(self.currency(), "EUR")  # a saved preference wins
        self.client.logout()
        with tenant_context(user_id=self.staff.id, staff=True):
            Currency.objects.filter(code="USD").update(is_active=False)
        self.assertEqual(self.currency(), "GBP")  # a switched-off currency falls back to pounds
