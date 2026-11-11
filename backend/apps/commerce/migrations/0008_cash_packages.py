"""B2C-06: Cash packages — CashPackage, CashPackageCourse + RLS."""

import django.db.models.deletion
import django.db.models.functions
from django.conf import settings
from django.db import migrations, models

from core import rls
from core.models import UUIDv7


class Migration(migrations.Migration):
    dependencies = [
        ("commerce", "0007_token_wallet_models"),
        ("catalog", "0007_course_cash_price_tier_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CashPackage",
            fields=[
                ("id", models.UUIDField(db_default=UUIDv7(), editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(db_default=django.db.models.functions.Now(), editable=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=200)),
                ("slug", models.SlugField(max_length=120, unique=True)),
                ("description", models.TextField(blank=True, max_length=4000)),
                ("is_active", models.BooleanField(default=True)),
                ("starts_at", models.DateTimeField(blank=True, null=True)),
                ("ends_at", models.DateTimeField(blank=True, null=True)),
                ("price_tier", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name="cash_packages",
                    to="commerce.pricetier",
                )),
                ("created_by", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="+",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                "db_table": 'commerce"."cash_packages',
            },
        ),
        migrations.AddIndex(
            model_name="cashpackage",
            index=models.Index(fields=["is_active", "slug"], name="ix_cpkg_active"),
        ),
        migrations.CreateModel(
            name="CashPackageCourse",
            fields=[
                ("id", models.UUIDField(db_default=UUIDv7(), editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(db_default=django.db.models.functions.Now(), editable=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("snapshot_gbp_minor", models.PositiveIntegerField(default=0)),
                ("package", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="courses",
                    to="commerce.cashpackage",
                )),
                ("course", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="+",
                    to="catalog.course",
                )),
            ],
            options={
                "db_table": 'commerce"."cash_package_courses',
            },
        ),
        migrations.AddConstraint(
            model_name="cashpackagecourse",
            constraint=models.UniqueConstraint(
                fields=["package", "course"], name="uq_cpkg_course"
            ),
        ),
        # RLS: packages are reference data (staff_only), but readable by all
        migrations.RunSQL(*rls.reference("commerce", "cash_packages")),
        migrations.RunSQL(*rls.reference("commerce", "cash_package_courses")),
    ]
