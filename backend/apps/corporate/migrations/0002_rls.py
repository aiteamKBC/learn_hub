"""RLS policies for corporate schema tables."""

from django.db import migrations

from core import rls

SCHEMA = "corporate"


class Migration(migrations.Migration):
    dependencies = [
        ("corporate", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(*rls.reference(SCHEMA, "corporate_offerings")),
        migrations.RunSQL(*rls.company_only(SCHEMA, "corporate_quotes")),
        migrations.RunSQL(*rls.company_only(SCHEMA, "quote_items")),
        migrations.RunSQL(*rls.company_only(SCHEMA, "seat_purchases")),
        migrations.RunSQL(*rls.company_only(SCHEMA, "seat_allocations")),
        migrations.RunSQL(*rls.company_only(SCHEMA, "allocation_events")),
    ]
