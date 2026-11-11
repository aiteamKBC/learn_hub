"""B2C-07: SubscriptionAccessEvent for revenue pool attribution."""

import django.db.models.deletion
import django.db.models.functions
from django.conf import settings
from django.db import migrations, models

from core import rls
from core.models import UUIDv7


class Migration(migrations.Migration):
    dependencies = [
        ("platform", "0005_b2c_access_engine_rls_and_backfill"),
        ("catalog", "0008_lecture_excluded_from_subscription"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SubscriptionAccessEvent",
            fields=[
                ("id", models.UUIDField(db_default=UUIDv7(), editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(db_default=django.db.models.functions.Now(), editable=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("subscription", models.UUIDField()),
                ("duration_seconds", models.PositiveIntegerField(default=0)),
                ("accessed_at", models.DateTimeField()),
                ("user", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="+",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("course", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="+",
                    to="catalog.course",
                )),
                ("lecture", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="+",
                    to="catalog.lecture",
                )),
            ],
            options={
                "db_table": 'platform"."subscription_access_events',
            },
        ),
        migrations.AddIndex(
            model_name="subscriptionaccessevent",
            index=models.Index(fields=["user", "course", "-accessed_at"], name="ix_sae_user_course"),
        ),
        migrations.AddIndex(
            model_name="subscriptionaccessevent",
            index=models.Index(fields=["subscription", "-accessed_at"], name="ix_sae_sub"),
        ),
        migrations.RunSQL(*rls.personal("platform", "subscription_access_events")),
    ]
