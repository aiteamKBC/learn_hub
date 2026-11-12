"""RLS for seat instalments: a company sees only its own schedule. Adds a policy only."""

from django.db import migrations

from core import rls


class Migration(migrations.Migration):
    dependencies = [
        ("corporate", "0011_programme_duration_instalments"),
    ]

    operations = [
        migrations.RunSQL(*rls.company_only("corporate", "seat_instalments")),
    ]
