"""Keep the company's request details with live training enquiries."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("corporate", "0016_attachment_rls")]

    operations = [
        migrations.AddField(
            model_name="trainingrequest",
            name="company_message",
            field=models.TextField(blank=True, max_length=2000),
        ),
        migrations.AddField(
            model_name="trainingrequest",
            name="admin_reply",
            field=models.TextField(blank=True, max_length=2000),
        ),
    ]
