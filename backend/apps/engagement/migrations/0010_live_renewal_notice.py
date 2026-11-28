"""Add default wording for the live-course renewal reminder (insert only)."""

from django.db import migrations


def insert(apps, schema_editor):
    Template = apps.get_model("engagement", "NotificationTemplate")
    Template.objects.using(schema_editor.connection.alias).get_or_create(
        code="corporate_live_renewal_due",
        defaults={
            "title": "Renew {course} before {date}",
            "body": "The months you paid for {seats} live seats end on {date}. Pay the next instalment ({amount}) so your employees keep their sessions.",
            "email_enabled": True,
        },
    )


class Migration(migrations.Migration):
    dependencies = [("engagement", "0009_course_instalment_notice")]
    operations = [migrations.RunPython(insert, migrations.RunPython.noop)]
