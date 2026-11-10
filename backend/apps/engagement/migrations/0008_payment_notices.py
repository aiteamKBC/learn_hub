"""Wordings for the extra Stripe events (failed delayed payment, paused / resumed
subscription, trial ending). Insert only: an existing row with the same code is left
exactly as staff edited it."""

from django.db import migrations

TEMPLATES = [
    (
        "order_payment_failed",
        "Payment didn't go through",
        "Your payment for {items} failed, so the order wasn't completed. You can buy it again at any time.",
        True,
    ),
    (
        "subscription_paused",
        "{plan} paused",
        "Your subscription is paused. Courses from it are locked until it resumes.",
        True,
    ),
    ("subscription_resumed", "{plan} resumed", "Your subscription is active again.", True),
    (
        "subscription_trial_ending",
        "Your {plan} trial ends soon",
        "Your free trial ends on {date}. Your subscription starts then unless you cancel.",
        True,
    ),
]


def insert(apps, schema_editor):
    Template = apps.get_model("engagement", "NotificationTemplate")
    db = schema_editor.connection.alias
    for code, title, body, email in TEMPLATES:
        Template.objects.using(db).get_or_create(
            code=code, defaults={"title": title, "body": body, "email_enabled": email}
        )


class Migration(migrations.Migration):
    dependencies = [("engagement", "0007_console_templates")]

    operations = [migrations.RunPython(insert, migrations.RunPython.noop)]
