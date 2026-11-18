from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("commerce", "0012_plan_live_seat_cap")]

    operations = [
        migrations.AddField(
            model_name="plan",
            name="live_seat_cap_effective_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
