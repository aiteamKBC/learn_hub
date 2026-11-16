from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("payouts", "0006_alter_earning_channel_alter_earning_kind_and_more")]

    operations = [
        migrations.AddField(
            model_name="commissionrule",
            name="instructor_id",
            field=models.UUIDField(blank=True, null=True),
        ),
    ]
