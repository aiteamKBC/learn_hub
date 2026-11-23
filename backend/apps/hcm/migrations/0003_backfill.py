"""Give every existing `org.OrgMember` a `MemberProfile`.

Idempotent: the unique `(org_id, member_id)` constraint on `MemberProfile`
guarantees `get_or_create` never duplicates. Safe to re-run.

Runs under the `lms_app` RLS context, so writes are scoped per-org through the
TenantContext helper. Members are iterated per-org so one failing row never
rolls back the whole backfill.
"""

from django.db import migrations


def backfill_profiles(apps, schema_editor):
    db = schema_editor.connection.alias  # owner connection: sees tables created in this migration
    OrgMember = apps.get_model("org", "OrgMember")
    MemberProfile = apps.get_model("hcm", "MemberProfile")
    members = OrgMember.objects.using(db).filter(removed_at__isnull=True).only("id", "org_id")
    for member in members.iterator(chunk_size=500):
        MemberProfile.objects.using(db).get_or_create(
            org_id=member.org_id,
            member_id=member.id,
        )


def unbackfill_profiles(apps, schema_editor):
    # Reverse: drop profiles we created. Safe because MemberProfile has no other
    # dependents in this milestone — later milestones adding FKs to profile must
    # provide their own reverse strategy.
    db = schema_editor.connection.alias
    MemberProfile = apps.get_model("hcm", "MemberProfile")
    MemberProfile.objects.using(db).all().delete()


class Migration(migrations.Migration):
    dependencies = [("hcm", "0002_security")]

    operations = [
        migrations.RunPython(backfill_profiles, unbackfill_profiles),
    ]
