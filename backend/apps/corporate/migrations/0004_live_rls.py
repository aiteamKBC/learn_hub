"""RLS policies for B2B-03 live training tables."""

from django.db import migrations

from core import rls

SCHEMA = "corporate"


class Migration(migrations.Migration):
    dependencies = [
        ("corporate", "0003_live_cohort_models"),
    ]

    operations = [
        migrations.RunSQL(*rls.company_only(SCHEMA, "training_requests")),
        migrations.RunSQL(*rls.staff_only(SCHEMA, "live_cohorts")),
        migrations.RunSQL(*rls.company_only(SCHEMA, "cohort_companies")),
        migrations.RunSQL(*rls.staff_only(SCHEMA, "sessions")),
        migrations.RunSQL(*rls.staff_only(SCHEMA, "tutors")),
        migrations.RunSQL(*rls.staff_only(SCHEMA, "tutor_assignments")),
    ]
