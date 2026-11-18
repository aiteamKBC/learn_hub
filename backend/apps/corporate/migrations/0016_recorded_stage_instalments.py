"""Add opt-in staged content access to new recorded-course agreements."""

import django.db.models.deletion
import django.db.models.functions.datetime
from django.db import migrations, models

import core.models
from core import rls


class Migration(migrations.Migration):
    dependencies = [("corporate", "0017_training_request_company_message")]

    operations = [
        migrations.AddField(
            model_name="corporateoffering",
            name="instalments_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="seatpurchase",
            name="stage_access_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name="StageInstalment",
            fields=[
                ("id", models.UUIDField(db_default=core.models.UUIDv7(), editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(db_default=django.db.models.functions.datetime.Now(), editable=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("sequence", models.PositiveIntegerField()),
                ("amount_minor", models.IntegerField()),
                ("currency", models.CharField(max_length=3)),
                ("due_at", models.DateTimeField()),
                ("status", models.CharField(choices=[("pending", "Not sent yet"), ("sent", "Invoice sent"), ("paid", "Paid"), ("failed", "Payment failed"), ("void", "Cancelled")], default="pending", max_length=8)),
                ("stripe_invoice_id", models.CharField(blank=True, max_length=255)),
                ("paid_at", models.DateTimeField(blank=True, null=True)),
                ("org", models.ForeignKey(db_index=False, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="org.organization")),
                ("seat_purchase", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="stage_instalments", to="corporate.seatpurchase")),
            ],
            options={
                "db_table": 'corporate"."stage_instalments',
                "indexes": [models.Index(fields=["org", "seat_purchase", "status"], name="ix_stage_inst_purchase")],
                "constraints": [models.UniqueConstraint(fields=("seat_purchase", "sequence"), name="uq_stage_instalment_sequence")],
            },
        ),
        migrations.CreateModel(
            name="SeatPurchaseStage",
            fields=[
                ("id", models.UUIDField(db_default=core.models.UUIDv7(), editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(db_default=django.db.models.functions.datetime.Now(), editable=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("title", models.CharField(max_length=120)),
                ("sequence", models.PositiveIntegerField()),
                ("org", models.ForeignKey(db_index=False, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="org.organization")),
                ("instalment", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="stages", to="corporate.stageinstalment")),
                ("seat_purchase", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="stages", to="corporate.seatpurchase")),
            ],
            options={
                "db_table": 'corporate"."seat_purchase_stages',
                "indexes": [models.Index(fields=["org", "seat_purchase"], name="ix_purchase_stages")],
                "constraints": [models.UniqueConstraint(fields=("seat_purchase", "sequence"), name="uq_purchase_stage_sequence")],
            },
        ),
        migrations.CreateModel(
            name="StageLecture",
            fields=[
                ("id", models.UUIDField(db_default=core.models.UUIDv7(), editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(db_default=django.db.models.functions.datetime.Now(), editable=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("lecture_key", models.UUIDField()),
                ("org", models.ForeignKey(db_index=False, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="org.organization")),
                ("stage", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="lectures", to="corporate.seatpurchasestage")),
            ],
            options={
                "db_table": 'corporate"."stage_lectures',
                "indexes": [models.Index(fields=["org", "lecture_key"], name="ix_stage_lecture_key")],
                "constraints": [models.UniqueConstraint(fields=("stage", "lecture_key"), name="uq_stage_lecture")],
            },
        ),
        migrations.RunSQL(*rls.company_only("corporate", "stage_instalments")),
        migrations.RunSQL(*rls.company_only("corporate", "seat_purchase_stages")),
        migrations.RunSQL(*rls.company_only("corporate", "stage_lectures")),
    ]

