"""B2C-02: Token wallet — TokenGrant, TokenSpend, TokenLedgerEntry + RLS."""

import django.db.models.deletion
import django.db.models.functions
from django.conf import settings
from django.db import migrations, models

from core import rls
from core.models import UUIDv7


class Migration(migrations.Migration):
    dependencies = [
        ("commerce", "0006_token_pricing_constraints"),
        ("platform", "0004_accessauditlog_contententitlement"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # ---------------------------------------------------------------- TokenGrant
        migrations.CreateModel(
            name="TokenGrant",
            fields=[
                ("id", models.UUIDField(db_default=UUIDv7(), editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(db_default=django.db.models.functions.Now(), editable=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("source", models.CharField(
                    choices=[("pack", "Token pack purchase"), ("topup", "Custom cash top-up"),
                             ("admin", "Admin adjustment"), ("bonus", "Bonus campaign"),
                             ("refund", "Spend reversal / refund")],
                    max_length=10)),
                ("amount", models.PositiveIntegerField()),
                ("remaining", models.PositiveIntegerField()),
                ("unit_cost_gbp", models.DecimalField(blank=True, decimal_places=4, max_digits=12, null=True)),
                ("granted_at", models.DateTimeField()),
                ("expires_at", models.DateTimeField(blank=True, null=True)),
                ("expired_at", models.DateTimeField(blank=True, null=True)),
                ("source_ref", models.CharField(blank=True, max_length=64)),
                ("stripe_session_id", models.CharField(blank=True, max_length=128, null=True, unique=True)),
                ("note", models.CharField(blank=True, max_length=300)),
                ("user", models.ForeignKey(
                    db_index=False, on_delete=django.db.models.deletion.CASCADE,
                    related_name="+", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "db_table": 'commerce"."token_grants',
                "ordering": ["-id"],
            },
        ),
        migrations.AddIndex(
            model_name="tokengrant",
            index=models.Index(
                condition=models.Q(("remaining__gt", 0), ("expired_at__isnull", True)),
                fields=["user", "expires_at", "granted_at", "id"],
                name="ix_tgrant_fefo",
            ),
        ),
        migrations.AddIndex(
            model_name="tokengrant",
            index=models.Index(fields=["user"], name="ix_tgrant_user"),
        ),
        migrations.AddIndex(
            model_name="tokengrant",
            index=models.Index(
                condition=models.Q(("expires_at__isnull", False), ("expired_at__isnull", True)),
                fields=["expires_at"],
                name="ix_tgrant_expires",
            ),
        ),
        # ---------------------------------------------------------------- TokenSpend
        migrations.CreateModel(
            name="TokenSpend",
            fields=[
                ("id", models.UUIDField(db_default=UUIDv7(), editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(db_default=django.db.models.functions.Now(), editable=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("scope", models.CharField(
                    choices=[("course", "Course"), ("lecture", "Lecture"), ("material", "Material")],
                    max_length=12)),
                ("target_id", models.UUIDField()),
                ("tokens_total", models.PositiveIntegerField()),
                ("weighted_unit_cost_gbp", models.DecimalField(
                    blank=True, decimal_places=4, max_digits=12, null=True)),
                ("course_id", models.UUIDField(blank=True, null=True)),
                ("instructor_id", models.UUIDField(blank=True, null=True)),
                ("user", models.ForeignKey(
                    db_index=False, on_delete=django.db.models.deletion.CASCADE,
                    related_name="+", to=settings.AUTH_USER_MODEL)),
                ("entitlement", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="+", to="platform.contententitlement")),
            ],
            options={
                "db_table": 'commerce"."token_spends',
                "ordering": ["-id"],
            },
        ),
        migrations.AddIndex(
            model_name="tokenspend",
            index=models.Index(fields=["user", "-created_at"], name="ix_tspend_user"),
        ),
        migrations.AddIndex(
            model_name="tokenspend",
            index=models.Index(
                condition=models.Q(("course_id__isnull", False)),
                fields=["course_id"],
                name="ix_tspend_course",
            ),
        ),
        # ---------------------------------------------------------------- TokenLedgerEntry
        migrations.CreateModel(
            name="TokenLedgerEntry",
            fields=[
                ("id", models.UUIDField(db_default=UUIDv7(), editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(db_default=django.db.models.functions.Now(), editable=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("kind", models.CharField(
                    choices=[("grant", "Tokens granted"), ("spend", "Tokens spent on content"),
                             ("expiry", "Tokens expired (FEFO)"),
                             ("admin_clawback", "Admin removed tokens"),
                             ("refund_reversal", "Spend reversed (refund)")],
                    max_length=20)),
                ("amount", models.IntegerField()),
                ("balance_after", models.PositiveIntegerField()),
                ("note", models.CharField(blank=True, max_length=300)),
                ("user", models.ForeignKey(
                    db_index=False, on_delete=django.db.models.deletion.CASCADE,
                    related_name="+", to=settings.AUTH_USER_MODEL)),
                ("grant", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                    related_name="+", to="commerce.tokengrant")),
                ("spend", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                    related_name="+", to="commerce.tokenspend")),
            ],
            options={
                "db_table": 'commerce"."token_ledger',
                "ordering": ["-id"],
            },
        ),
        migrations.AddIndex(
            model_name="tokenledgerentry",
            index=models.Index(fields=["user", "-created_at"], name="ix_tledger_user"),
        ),
        # ---------------------------------------------------------------- RLS
        migrations.RunSQL(*rls.personal("commerce", "token_grants")),
        migrations.RunSQL(*rls.personal("commerce", "token_spends")),
        migrations.RunSQL(*rls.personal("commerce", "token_ledger")),
    ]
