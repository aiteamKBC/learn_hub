"""RLS policies for B2B-07 cancellation/policy tables."""

from django.db import migrations

from core import rls

SCHEMA = "corporate"


class Migration(migrations.Migration):
    dependencies = [
        ("corporate", "0007_cancellations_policies"),
    ]

    operations = [
        migrations.RunSQL(*rls.company_only(SCHEMA, "cancellation_requests")),
        migrations.RunSQL(*rls.company_only(SCHEMA, "departure_policies")),
    ]
