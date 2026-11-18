"""Add default wording for an instalment that needs manual payment."""

from django.db import migrations


def insert(apps, schema_editor):
    Template = apps.get_model("engagement", "NotificationTemplate")
    Template.objects.using(schema_editor.connection.alias).get_or_create(
        code="course_instalment_manual_payment",
        defaults={
            "title": "Manual payment needed for {course}",
            "body": "We could not collect the scheduled payment. Pay it manually to unlock its mapped stage.",
            "email_enabled": True,
        },
    )


class Migration(migrations.Migration):
    dependencies = [("engagement", "0008_payment_notices")]
    operations = [migrations.RunPython(insert, migrations.RunPython.noop)]
