"""Tenant isolation and same-company foreign keys for responsibility assignments."""

from django.db import migrations

from core import rls


class Migration(migrations.Migration):
    dependencies = [("org", "0003_responsibility_assignments")]

    operations = [
        migrations.RunSQL(*rls.company_only("org", "role_assignments")),
        migrations.RunSQL(*rls.composite_fk(
            "org", "role_assignments", ("org_id", "member_id"), "org", "org_members",
            ("org_id", "id"), "fk_org_roles_member_same_org", "CASCADE",
        )),
        migrations.RunSQL(*rls.composite_fk(
            "org", "role_assignments", ("org_id", "unit_id"), "org", "org_units",
            ("org_id", "id"), "fk_org_roles_unit_same_org",
        )),
    ]
