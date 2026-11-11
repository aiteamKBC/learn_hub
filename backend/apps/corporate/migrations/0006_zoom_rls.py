"""RLS policies for B2B-05 Zoom + attendance tables."""

from django.db import migrations

from core import rls

SCHEMA = "corporate"


class Migration(migrations.Migration):
    dependencies = [
        ("corporate", "0005_zoom_attendance"),
    ]

    operations = [
        migrations.RunSQL(*rls.staff_only(SCHEMA, "zoom_events")),
        migrations.RunSQL(
            sql="""
ALTER TABLE "corporate"."session_attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "corporate"."session_attendance" FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_att ON "corporate"."session_attendance" FOR SELECT USING (
    user_id = (SELECT NULLIF(current_setting('app.user_id', true), '')::uuid)
    OR org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)
    OR (SELECT COALESCE(current_setting('app.platform_staff', true), '') = 'on')
);
CREATE POLICY mut_att ON "corporate"."session_attendance" FOR ALL USING (
    (SELECT COALESCE(current_setting('app.platform_staff', true), '') = 'on')
);
""",
            reverse_sql="""
DROP POLICY IF EXISTS sel_att ON "corporate"."session_attendance";
DROP POLICY IF EXISTS mut_att ON "corporate"."session_attendance";
ALTER TABLE "corporate"."session_attendance" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "corporate"."session_attendance" DISABLE ROW LEVEL SECURITY;
""",
        ),
    ]
