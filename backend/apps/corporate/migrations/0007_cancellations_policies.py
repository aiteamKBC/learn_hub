import core.models
import django.db.models.deletion
import django.db.models.functions.datetime
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('corporate', '0006_zoom_rls'),
        ('org', '0002_security'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='CancellationRequest',
            fields=[
                ('id', models.UUIDField(db_default=core.models.UUIDv7(), editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(db_default=django.db.models.functions.datetime.Now(), editable=False)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('type', models.CharField(choices=[('cohort_cancel', 'Cohort cancellation'), ('recorded_refund', 'Recorded package refund'), ('postponement', 'Cohort postponement')], max_length=20)),
                ('status', models.CharField(choices=[('submitted', 'Submitted'), ('under_review', 'Under review'), ('approved', 'Approved'), ('rejected', 'Rejected'), ('processed', 'Refund processed')], default='submitted', max_length=16)),
                ('reason', models.TextField()),
                ('admin_notes', models.TextField(blank=True)),
                ('reviewed_at', models.DateTimeField(blank=True, null=True)),
                ('refund_amount_minor', models.IntegerField(blank=True, null=True)),
                ('refund_currency', models.CharField(blank=True, max_length=3)),
                ('stripe_refund_id', models.CharField(blank=True, max_length=255)),
                ('refunded_at', models.DateTimeField(blank=True, null=True)),
                ('org', models.ForeignKey(db_index=False, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='org.organization')),
                ('requester', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('seat_purchase', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='corporate.seatpurchase')),
                ('cohort_company', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='corporate.cohortcompany')),
                ('reviewed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'corporate"."cancellation_requests',
                'indexes': [models.Index(fields=['org', 'status'], name='ix_cancel_org_status')],
            },
        ),
        migrations.CreateModel(
            name='DeparturePolicy',
            fields=[
                ('id', models.UUIDField(db_default=core.models.UUIDv7(), editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(db_default=django.db.models.functions.datetime.Now(), editable=False)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('action', models.CharField(choices=[('revoke_all', 'Revoke all active enrollments'), ('preserve_completed', 'Keep completed, revoke active'), ('admin_decides', 'Admin decides per case')], default='admin_decides', max_length=20)),
                ('notes', models.TextField(blank=True)),
                ('org', models.ForeignKey(db_index=False, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='org.organization')),
                ('set_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'corporate"."departure_policies',
                'constraints': [models.UniqueConstraint(fields=['org'], name='uq_departure_policy_org')],
            },
        ),
        migrations.RunSQL(
            sql="""
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA corporate TO lms_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA corporate TO lms_app;
  END IF;
END $$;
""",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
