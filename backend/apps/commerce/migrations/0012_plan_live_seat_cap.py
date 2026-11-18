from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("commerce", "0011_b2c_course_instalments")]

    operations = [
        migrations.AddField(
            model_name="plan",
            name="live_seat_cap",
            field=models.PositiveIntegerField(blank=True, default=None, null=True),
        ),
    ]
