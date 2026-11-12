# Generated manually for Teams live-session metadata.
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0008_lecture_excluded_from_subscription")]

    operations = [
        migrations.AddField(model_name="lecture", name="live_provider", field=models.CharField(choices=[("manual", "Manual link"), ("teams", "Microsoft Teams")], default="manual", max_length=16)),
        migrations.AddField(model_name="lecture", name="teams_meeting_id", field=models.CharField(blank=True, max_length=512)),
        migrations.AddField(model_name="lecture", name="teams_organizer", field=models.CharField(blank=True, max_length=255)),
    ]
