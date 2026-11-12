"""RLS for purchase attachments: a company sees only its own files. Adds a policy only."""

from django.db import migrations

from core import rls


class Migration(migrations.Migration):
    dependencies = [
        ("corporate", "0015_agreement_length_attachments"),
    ]

    operations = [
        migrations.RunSQL(*rls.company_only("corporate", "purchase_attachments")),
    ]
