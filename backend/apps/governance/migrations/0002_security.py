"""Governance: RLS policies and composite FKs.

  * `company_only` (org_id) — strategies, strategy versions/objectives, policy docs,
    policy versions, policy allocations, tech questions.
  * `manager_of_unit` (member_id) — policy_records: a member's personal adoption
    trail is visible to them and their line of managers + HR admins only.

Composite FKs guard every link between company rows.
"""

from django.db import migrations

from core import rls

S = "governance"

COMPANY_ONLY_TABLES = (
    "strategies",
    "strategy_versions",
    "strategy_objectives",
    "policy_docs",
    "policy_versions",
    "policy_allocations",
    "tech_questions",
)

MANAGER_OF_UNIT_TABLES = ("policy_records",)


def fk(table, col, ref_schema, ref_table, name, on_delete="RESTRICT"):
    return rls.composite_fk(
        S, table, ("org_id", col), ref_schema, ref_table, ("org_id", "id"), name, on_delete
    )


COMPOSITE_FKS = [
    fk("strategy_versions", "strategy_id", S, "strategies", "fk_gov_sv_strategy_same_org", "CASCADE"),
    fk("strategy_objectives", "version_id", S, "strategy_versions", "fk_gov_so_version_same_org", "CASCADE"),
    fk("strategy_objectives", "owner_id", "org", "org_members", "fk_gov_so_owner_same_org"),
    fk("policy_versions", "doc_id", S, "policy_docs", "fk_gov_pv_doc_same_org", "CASCADE"),
    fk("policy_allocations", "doc_id", S, "policy_docs", "fk_gov_alloc_doc_same_org", "CASCADE"),
    fk("policy_docs", "owner_id", "org", "org_members", "fk_gov_poldoc_owner_same_org"),
    fk("policy_records", "doc_id", S, "policy_docs", "fk_gov_polrec_doc_same_org", "CASCADE"),
    fk("policy_records", "member_id", "org", "org_members", "fk_gov_polrec_member_same_org", "CASCADE"),
]


class Migration(migrations.Migration):
    dependencies = [("governance", "0001_initial")]

    operations = [
        migrations.RunSQL(fwd, rev)
        for fwd, rev in (
            *(rls.company_only(S, t) for t in COMPANY_ONLY_TABLES),
            *(rls.manager_of_unit(S, t) for t in MANAGER_OF_UNIT_TABLES),
            *COMPOSITE_FKS,
        )
    ]
