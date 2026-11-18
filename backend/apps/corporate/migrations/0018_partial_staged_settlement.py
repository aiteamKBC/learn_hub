from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("corporate", "0016_recorded_stage_instalments")]

    operations = [
        migrations.AlterField(
            model_name="seatpurchase",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending payment"),
                    ("partial_paid", "Partly paid"),
                    ("paid", "Paid"),
                    ("refunded", "Fully refunded"),
                    ("partial", "Partially refunded"),
                    ("expired", "Payment expired"),
                    ("voided", "Voided"),
                ],
                default="pending",
                max_length=12,
            ),
        ),
        migrations.AddField(
            model_name="stageinstalment",
            name="invoice_attempt",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
