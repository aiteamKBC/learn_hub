"""PMS: RLS policies and composite FKs.

Two RLS shapes:
  * `company_only` (org_id) — KPIs, proposals, their history and measurements, and
    review cycles: visible only inside the owning company.
  * `manager_of_unit` (member_id) — performance_reviews, review_objectives and
    review_analyses carry a personal assessment: the member and their line of
    managers + HR admins see rows; peers do not.

Composite FKs `(org_id, x_id) → (org_id, id)` guard every link between company rows
so one company's review can never point at another company's member or cycle.
"""

from django.db import migrations

from core import rls

S = "pms"

COMPANY_ONLY_TABLES = (
    "kpis",
    "kpi_proposals",
    "kpi_proposal_history",
    "kpi_measurements",
    "review_cycles",
)

MANAGER_OF_UNIT_TABLES = (
    "performance_reviews",
    "review_objectives",
    "review_analyses",
)


def fk(table, col, ref_schema, ref_table, name, on_delete="RESTRICT"):
    return rls.composite_fk(
        S, table, ("org_id", col), ref_schema, ref_table, ("org_id", "id"), name, on_delete
    )


COMPOSITE_FKS = [
    # KPI tables
    fk("kpi_proposal_history", "proposal_id", S, "kpi_proposals", "fk_pms_hist_proposal_same_org", "CASCADE"),
    fk("kpi_measurements", "kpi_id", S, "kpis", "fk_pms_meas_kpi_same_org", "CASCADE"),
    fk("kpi_proposals", "active_kpi_id", S, "kpis", "fk_pms_prop_active_kpi_same_org"),
    fk("kpis", "owner_id", "org", "org_members", "fk_pms_kpi_owner_same_org"),
    fk("kpi_proposals", "owner_id", "org", "org_members", "fk_pms_prop_owner_same_org"),
    # Review tables
    fk("performance_reviews", "cycle_id", S, "review_cycles", "fk_pms_review_cycle_same_org", "CASCADE"),
    fk("performance_reviews", "member_id", "org", "org_members", "fk_pms_review_member_same_org", "CASCADE"),
    fk("performance_reviews", "reviewer_id", "org", "org_members", "fk_pms_review_reviewer_same_org"),
    fk("review_objectives", "review_id", S, "performance_reviews", "fk_pms_revobj_review_same_org", "CASCADE"),
    fk("review_objectives", "member_id", "org", "org_members", "fk_pms_revobj_member_same_org", "CASCADE"),
    fk("review_analyses", "review_id", S, "performance_reviews", "fk_pms_analysis_review_same_org", "CASCADE"),
    fk("review_analyses", "member_id", "org", "org_members", "fk_pms_analysis_member_same_org", "CASCADE"),
]


class Migration(migrations.Migration):
    dependencies = [("pms", "0001_initial")]

    operations = [
        migrations.RunSQL(fwd, rev)
        for fwd, rev in (
            *(rls.company_only(S, t) for t in COMPANY_ONLY_TABLES),
            *(rls.manager_of_unit(S, t) for t in MANAGER_OF_UNIT_TABLES),
            *COMPOSITE_FKS,
        )
    ]
