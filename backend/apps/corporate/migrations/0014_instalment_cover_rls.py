"""RLS for instalment covers: a company sees only its own rows. Adds a policy only."""

from django.db import migrations

from core import rls


class Migration(migrations.Migration):
    dependencies = [
        ("corporate", "0013_instalment_covers"),
    ]

    operations = [
        migrations.RunSQL(*rls.company_only("corporate", "instalment_covers")),
    ]
