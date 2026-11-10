"""Test base classes.

Django's built-in flush between TransactionTestCase tests discovers tables by their
unqualified names, so it misses our schema-qualified tables ("org"."org_units") and
leaves data behind. This base truncates every domain schema instead.
"""

from django.core.cache import cache
from django.db import connections
from django.test import TransactionTestCase

TRUNCATE_SCHEMAS = [
    "identity",
    "org",
    "catalog",
    "learning",
    "compliance",
    "commerce",
    "payouts",
    "engagement",
    "platform",
]
# Reference data loaded by migrations survives between tests
KEEP = {
    "django_migrations",
    "django_content_type",
    "auth_permission",
    "currencies",
    "price_tiers",
    "revenue_shares",
    "notification_templates",
    "badges",
}


def truncate_domain_tables():
    with connections["owner"].cursor() as cur:
        cur.execute(
            """
            SELECT format('%%I.%%I', schemaname, tablename) FROM pg_tables
            WHERE schemaname = ANY(%s) AND NOT (tablename = ANY(%s))
            """,
            [TRUNCATE_SCHEMAS, list(KEEP)],
        )
        tables = [r[0] for r in cur.fetchall()]
        if tables:
            cur.execute(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE")


_cleaned_this_run = False


class SchemaTransactionTestCase(TransactionTestCase):
    """For tests that need committed data (e.g. a second connection as lms_app)."""

    databases = {"default", "owner"}

    @classmethod
    def setUpClass(cls):
        # --keepdb reuses the test database: a run that was killed mid-test never reached
        # its teardown, so the first test class of a new run starts from empty tables too
        global _cleaned_this_run
        if not _cleaned_this_run:
            truncate_domain_tables()
            _cleaned_this_run = True
        super().setUpClass()

    def _fixture_teardown(self):
        truncate_domain_tables()
        cache.clear()  # cached settings (e.g. maintenance mode) must not leak into the next test
