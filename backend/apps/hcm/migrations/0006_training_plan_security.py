"""Tenant isolation and same-company references for development training plans."""

from django.db import migrations

from core import rls

S = "hcm"


def fk(table, cols, ref_schema, ref_table, name, on_delete="RESTRICT"):
    return rls.composite_fk(S, table, ("org_id", cols), ref_schema, ref_table, ("org_id", "id"), name, on_delete)


class Migration(migrations.Migration):
    dependencies = [("hcm", "0005_trainingplan_trainingplanitem_and_more")]

    operations = [
        migrations.RunSQL(forward, reverse)
        for forward, reverse in (
            rls.company_only(S, "training_plans"),
            rls.company_only(S, "training_plan_items"),
            fk("training_plans", "member_id", "org", "org_members", "fk_training_plan_member", "CASCADE"),
            fk("training_plans", "owner_id", "org", "org_members", "fk_training_plan_owner"),
            fk("training_plan_items", "plan_id", S, "training_plans", "fk_training_item_plan", "CASCADE"),
            fk("training_plan_items", "owner_id", "org", "org_members", "fk_training_item_owner"),
        )
    ]
