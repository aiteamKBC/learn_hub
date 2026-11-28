"""Add default wording for private live intake answers (insert only)."""

from django.db import migrations

ROWS = {
    "corporate_private_intake_approved": (
        "Your private intake for {course} is approved",
        "It starts on {date}. Add your employees and pay the deposit to confirm it.",
    ),
    "corporate_private_intake_rejected": (
        "Your private intake request for {course}",
        "LearnHub could not offer a private intake this time. {reply}",
    ),
}


def insert(apps, schema_editor):
    Template = apps.get_model("engagement", "NotificationTemplate")
    for code, (title, body) in ROWS.items():
        Template.objects.using(schema_editor.connection.alias).get_or_create(
            code=code, defaults={"title": title, "body": body, "email_enabled": True}
        )


class Migration(migrations.Migration):
    dependencies = [("engagement", "0010_live_renewal_notice")]
    operations = [migrations.RunPython(insert, migrations.RunPython.noop)]
