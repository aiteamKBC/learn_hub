"""Structural guards for Row-Level Security (run on every CI build).

* every table with an org_id column has ENABLE + FORCE RLS and at least one policy
* nothing lives in the public schema
"""

from django.db import connections
from django.test import TestCase

DOMAIN_SCHEMAS = [
    "identity",
    "org",
    "catalog",
    "learning",
    "compliance",
    "commerce",
    "payouts",
    "engagement",
    "analytics",
    "platform",
    "hcm",
    "frameworks",
    "pms",
    "governance",
]


class RowLevelSecurityStructureTest(TestCase):
    databases = {"default", "owner"}

    def _rows(self, sql, params=None):
        with connections["owner"].cursor() as cur:
            cur.execute(sql, params or [])
            return [r[0] for r in cur.fetchall()]

    def test_every_tenant_table_forces_rls_with_a_policy(self):
        """Any table carrying org_id or owner_org_id must force RLS with a policy."""
        missing = self._rows(
            """
            SELECT n.nspname || '.' || c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname IN ('org_id', 'owner_org_id')
                 AND NOT a.attisdropped
            WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY(%s)
              AND NOT c.relispartition  -- partitions: see test_partitions_are_not_directly_accessible
              AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
                   OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
            ORDER BY 1
            """,
            [DOMAIN_SCHEMAS],
        )
        self.assertEqual(missing, [], f"Tables with org_id/owner_org_id but no forced RLS policy: {missing}")

    def test_public_schema_has_no_tables(self):
        tables = self._rows("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")
        self.assertEqual(tables, [], f"Tables found in public: {tables}")

    def test_partitions_are_not_directly_accessible(self):
        """RLS does not apply to a partition queried directly, so the app roles must
        have no privileges on partitions at all (see platform.secure_partitions)."""
        exposed = self._rows(
            """
            SELECT c.oid::regclass::text || ' -> ' || r.rolname
            FROM pg_inherits i
            JOIN pg_class p ON p.oid = i.inhparent AND p.relkind = 'p'
            JOIN pg_class c ON c.oid = i.inhrelid
            CROSS JOIN pg_roles r
            WHERE r.rolname IN ('lms_app', 'lms_readonly')
              AND has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE')
            ORDER BY 1
            """
        )
        self.assertEqual(exposed, [], f"Partitions directly accessible: {exposed}")
