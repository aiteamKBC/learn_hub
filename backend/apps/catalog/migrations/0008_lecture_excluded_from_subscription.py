"""B2C-07: Add excluded_from_subscription flag to Lecture."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0007_course_cash_price_tier_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="lecture",
            name="excluded_from_subscription",
            field=models.BooleanField(default=False),
        ),
    ]
