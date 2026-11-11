"""B2C-07: Add kind field to Plan for unlimited_b2c subscription type."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("commerce", "0008_cash_packages"),
    ]

    operations = [
        migrations.AddField(
            model_name="plan",
            name="kind",
            field=models.CharField(
                choices=[("standard", "Standard plan"), ("unlimited_b2c", "Unlimited B2C (all in-subscription courses)")],
                default="standard",
                max_length=16,
            ),
        ),
    ]
