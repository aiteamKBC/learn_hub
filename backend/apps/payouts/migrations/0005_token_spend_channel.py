"""B2C-08: Add token_spend channel + kind to earnings, token_spend FK."""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("payouts", "0004_console_c_request_failed"),
        ("commerce", "0009_plan_kind"),
    ]

    operations = [
        migrations.AddField(
            model_name="earning",
            name="token_spend",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="commerce.tokenspend",
            ),
        ),
        migrations.AddConstraint(
            model_name="earning",
            constraint=models.UniqueConstraint(
                condition=models.Q(("token_spend__isnull", False)),
                fields=["user", "token_spend"],
                name="uq_earning_token_spend",
            ),
        ),
    ]
