import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("commerce", "0013_plan_live_seat_cap_effective_at"),
        ("corporate", "0019_provider_neutral_stage_payments"),
    ]

    operations = [
        migrations.AlterField(
            model_name="cohortcompany",
            name="status",
            field=models.CharField(
                choices=[
                    ("interested", "Interest registered"),
                    ("offered", "Cohort offered to company"),
                    ("pending_pay", "Awaiting payment"),
                    ("included", "Included in Team subscription"),
                    ("paid", "Payment confirmed"),
                    ("active", "Learners enrolled"),
                    ("completed", "Cohort completed"),
                    ("cancelled", "Company cancelled"),
                    ("withdrawn", "Admin withdrew company"),
                ],
                default="interested",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="cohortcompany",
            name="included_period_end",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="cohortcompany",
            name="included_seats",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="cohortcompany",
            name="included_subscription",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="included_live_bookings",
                to="commerce.subscription",
            ),
        ),
        migrations.AddIndex(
            model_name="cohortcompany",
            index=models.Index(
                fields=["included_subscription", "included_period_end", "status"],
                name="ix_cc_inc_period_status",
            ),
        ),
    ]
