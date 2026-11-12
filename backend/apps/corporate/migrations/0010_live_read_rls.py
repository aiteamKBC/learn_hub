"""RLS for live attendees, and read access to the cohorts and sessions a company booked.

live_cohorts and sessions were staff-only, so every company-facing live endpoint
(bookings, schedule, attendance, live checkout) saw nothing. These policies only ADD
read access (FOR SELECT); writes stay staff-only. Permissive policies are OR'ed with
the existing staff_only policy. Nothing is altered or dropped.

  * a company sees a cohort or session when it has a placement in that cohort;
  * an employee sees a cohort or session when they are a named active attendee.
"""

from django.db import migrations

from core import rls

COHORTS_READ = """
CREATE POLICY participant_read ON "corporate"."live_cohorts" FOR SELECT USING (
    EXISTS (SELECT 1 FROM "corporate"."cohort_companies" cc
            WHERE cc.cohort_id = "live_cohorts".id
              AND cc.org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid))
    OR EXISTS (SELECT 1 FROM "corporate"."live_attendees" a
               WHERE a.cohort_id = "live_cohorts".id AND a.status = 'active'
                 AND a.user_id = (SELECT NULLIF(current_setting('app.user_id', true), '')::uuid))
);
"""

SESSIONS_READ = """
CREATE POLICY participant_read ON "corporate"."sessions" FOR SELECT USING (
    EXISTS (SELECT 1 FROM "corporate"."cohort_companies" cc
            WHERE cc.cohort_id = "sessions".cohort_id
              AND cc.org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid))
    OR EXISTS (SELECT 1 FROM "corporate"."live_attendees" a
               WHERE a.cohort_id = "sessions".cohort_id AND a.status = 'active'
                 AND a.user_id = (SELECT NULLIF(current_setting('app.user_id', true), '')::uuid))
);
"""


class Migration(migrations.Migration):
    dependencies = [("corporate", "0009_live_attendees")]

    operations = [
        migrations.RunSQL(*rls.membership("corporate", "live_attendees")),
        migrations.RunSQL(
            COHORTS_READ, 'DROP POLICY IF EXISTS participant_read ON "corporate"."live_cohorts";'
        ),
        migrations.RunSQL(SESSIONS_READ, 'DROP POLICY IF EXISTS participant_read ON "corporate"."sessions";'),
    ]
