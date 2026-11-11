"""B2C-01 Unified Content Access Engine: RLS policies + legacy grandfathering backfill.

This migration is ADDITIVE and SAFE to run on production: it does NOT delete or modify
any existing row. It:

  1. Enables user-scoped RLS on ``platform.content_entitlements`` and
     ``platform.access_audit_log`` (via ``core.rls.enable_user_rls_sql``).
  2. Writes one ``ContentEntitlement(source='legacy_purchase')`` row for every existing
     personal course purchase (``learning.Enrollment`` with ``org_id IS NULL``,
     ``status IN ('active','completed')``, non-expired access window). Idempotent — a
     unique constraint on (user, scope, target, source) WHERE revoked_at IS NULL means
     a second run is a no-op. The existing ``Enrollment`` row is left untouched; the
     resolver still accepts it via the legacy branch, so running or skipping the
     backfill never changes observable behaviour.

Not run against Neon by this milestone — the planner applies it on deploy.
"""

from django.db import migrations

from core import rls
from core.rls import STAFF, USER

S = "platform"

# Audit log: the resolver writes a row on every ALLOW/DENY from a learner request, so
# INSERT must be open to the row's own user. UPDATE/DELETE stay staff-only (append-only).
AUDIT_LOG_RLS = (
    'ALTER TABLE "platform"."access_audit_log" ENABLE ROW LEVEL SECURITY;\n'
    'ALTER TABLE "platform"."access_audit_log" FORCE ROW LEVEL SECURITY;\n'
    f'CREATE POLICY aal_read ON "platform"."access_audit_log" FOR SELECT'
    f" USING (user_id = {USER} OR {STAFF});\n"
    f'CREATE POLICY aal_insert ON "platform"."access_audit_log" FOR INSERT'
    f" WITH CHECK (user_id = {USER} OR {STAFF});\n"
    f'CREATE POLICY aal_staff_modify ON "platform"."access_audit_log" FOR UPDATE'
    f" USING ({STAFF}) WITH CHECK ({STAFF});\n"
    f'CREATE POLICY aal_staff_delete ON "platform"."access_audit_log" FOR DELETE USING ({STAFF});',
    'DROP POLICY IF EXISTS aal_read ON "platform"."access_audit_log";\n'
    'DROP POLICY IF EXISTS aal_insert ON "platform"."access_audit_log";\n'
    'DROP POLICY IF EXISTS aal_staff_modify ON "platform"."access_audit_log";\n'
    'DROP POLICY IF EXISTS aal_staff_delete ON "platform"."access_audit_log";\n'
    'ALTER TABLE "platform"."access_audit_log" NO FORCE ROW LEVEL SECURITY;\n'
    'ALTER TABLE "platform"."access_audit_log" DISABLE ROW LEVEL SECURITY;\n',
)


def _forward_backfill(apps, schema_editor):
    ContentEntitlement = apps.get_model("platform", "ContentEntitlement")
    try:
        Enrollment = apps.get_model("learning", "Enrollment")
    except LookupError:  # pragma: no cover
        return
    from django.utils import timezone

    now = timezone.now()
    rows = Enrollment.objects.filter(
        org__isnull=True, status__in=("active", "completed")
    ).values_list("user_id", "course_id", "enrolled_at", "access_expires_at", "id")

    bulk = []
    seen = set()
    for user_id, course_id, enrolled_at, expires_at, enrol_id in rows.iterator(chunk_size=1000):
        key = (user_id, course_id)
        if key in seen:
            continue
        seen.add(key)
        bulk.append(
            ContentEntitlement(
                user_id=user_id,
                scope="course",
                target_id=course_id,
                source="legacy_purchase",
                source_ref=enrol_id,
                source_ref_kind="enrollment",
                granted_at=enrolled_at or now,
                expires_at=expires_at,
                note="B2C-01 grandfathering backfill",
            )
        )
        if len(bulk) >= 500:
            ContentEntitlement.objects.bulk_create(bulk, ignore_conflicts=True)
            bulk.clear()
    if bulk:
        ContentEntitlement.objects.bulk_create(bulk, ignore_conflicts=True)


def _reverse_noop(apps, schema_editor):
    # Deliberately a no-op: the backfill is additive; do not delete audit evidence.
    return


class Migration(migrations.Migration):

    dependencies = [
        ("platform", "0004_accessauditlog_contententitlement"),
        ("learning", "0005_console_a_verify"),
    ]

    operations = [
        migrations.RunSQL(*rls.enable_user_rls_sql(S, "content_entitlements")),
        migrations.RunSQL(*AUDIT_LOG_RLS),
        migrations.RunPython(_forward_backfill, _reverse_noop),
    ]
