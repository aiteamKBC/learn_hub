"""Record staged B2B payment requests and provider-neutral settlement references."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("corporate", "0018_partial_staged_settlement")]

    operations = [
        migrations.AlterField(
            model_name="stageinstalment",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Not sent yet"),
                    ("requested", "Payment requested"),
                    ("sent", "Invoice sent"),
                    ("paid", "Paid"),
                    ("failed", "Payment failed"),
                    ("void", "Cancelled"),
                ],
                default="pending",
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="stageinstalment",
            name="payment_requested_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="stageinstalment",
            name="payment_reference",
            field=models.CharField(blank=True, max_length=255, null=True, unique=True),
        ),
    ]
