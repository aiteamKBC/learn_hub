"""Frameworks: RLS policies and composite FKs.

Three RLS shapes:
  * `scoped_content` (owner_org_id) — the catalogue tables (competencies, content
    tags, maturity framework/version/dimension/criterion): platform rows
    (owner_org NULL) readable by all, org rows readable/writable by that org only.
  * `company_only` (org_id) — role frameworks, their versions/requirements/history,
    and maturity campaigns: visible only inside the owning company.
  * `manager_of_unit` (member_id) — maturity_responses: the responding member and
    their line of managers see raw rows; peers do not.

Composite FKs `(org_id, x_id) → (org_id, id)` guard every link between company_only
rows so one company's role framework can never point at another company's rows.
"""

from django.db import migrations

from core import rls

S = "frameworks"

SCOPED_CONTENT_TABLES = (
    "competencies",
    "course_competencies",
    "lecture_competencies",
    "quiz_question_competencies",
    "maturity_frameworks",
    "maturity_versions",
    "maturity_dimensions",
    "maturity_criteria",
)

COMPANY_ONLY_TABLES = (
    "role_frameworks",
    "role_framework_versions",
    "role_requirements",
    "role_framework_history",
    "maturity_campaigns",
)


def fk(table, col, ref_schema, ref_table, name, on_delete="RESTRICT"):
    return rls.composite_fk(
        S, table, ("org_id", col), ref_schema, ref_table, ("org_id", "id"), name, on_delete
    )


COMPOSITE_FKS = [
    # RoleFrameworkVersion → RoleFramework.
    fk("role_framework_versions", "framework_id", S, "role_frameworks", "fk_rfv_framework_same_org", "CASCADE"),
    # RoleRequirement → RoleFrameworkVersion.
    fk("role_requirements", "version_id", S, "role_framework_versions", "fk_req_version_same_org", "CASCADE"),
    # RoleFrameworkHistory → RoleFramework.
    fk("role_framework_history", "framework_id", S, "role_frameworks", "fk_rfh_framework_same_org", "CASCADE"),
    # MaturityCampaign → OrgMember (created_by is a User, not org-scoped).
    # MaturityResponse → MaturityCampaign and → OrgMember.
    fk("maturity_responses", "campaign_id", S, "maturity_campaigns", "fk_matresp_campaign_same_org", "CASCADE"),
    fk("maturity_responses", "member_id", "org", "org_members", "fk_matresp_member_same_org", "CASCADE"),
]


class Migration(migrations.Migration):
    dependencies = [("frameworks", "0001_initial")]

    operations = [
        migrations.RunSQL(fwd, rev)
        for fwd, rev in (
            *(rls.scoped_content(S, t) for t in SCOPED_CONTENT_TABLES),
            *(rls.company_only(S, t) for t in COMPANY_ONLY_TABLES),
            rls.manager_of_unit(S, "maturity_responses"),
            *COMPOSITE_FKS,
        )
    ]
