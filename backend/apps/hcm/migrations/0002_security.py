"""HCM: RLS policies and composite FKs.

Every table is company-only except `wellbeing_surveys`, which uses
`manager_of_unit` so colleagues of a member never see raw responses — only the
member, their line of managers (via `org.UnitManager`), org admins and platform
staff do. Composite FKs guarantee a member profile, qualification award,
wellbeing survey, quarter rollup, CPD entry or activity session can never link
to another company's people or qualifications.
"""

from django.db import migrations

from core import rls

S = "hcm"
COMPANY_ONLY_TABLES = (
    "member_profiles",
    "qualifications",
    "member_qualifications",
    "member_quarters",
    "cpd_entries",
    "member_activities",
)


def fk(table, cols, ref_schema, ref_table, name, on_delete="RESTRICT"):
    return rls.composite_fk(S, table, ("org_id", cols), ref_schema, ref_table, ("org_id", "id"), name, on_delete)


COMPOSITE_FKS = [
    # MemberProfile → OrgMember (CASCADE: profile goes when the person goes).
    fk("member_profiles", "member_id", "org", "org_members", "fk_prof_member_same_org", "CASCADE"),
    # MemberQualification → OrgMember and → Qualification.
    fk("member_qualifications", "member_id", "org", "org_members", "fk_mq_member_same_org", "CASCADE"),
    fk("member_qualifications", "qualification_id", S, "qualifications", "fk_mq_qual_same_org", "CASCADE"),
    # MemberQuarter → OrgMember.
    fk("member_quarters", "member_id", "org", "org_members", "fk_quarter_member_same_org", "CASCADE"),
    # WellbeingSurvey → OrgMember.
    fk("wellbeing_surveys", "member_id", "org", "org_members", "fk_wb_member_same_org", "CASCADE"),
    # CpdEntry → OrgMember and → learning.Certificate (optional: PROTECT via RESTRICT).
    fk("cpd_entries", "member_id", "org", "org_members", "fk_cpd_member_same_org", "CASCADE"),
    fk("cpd_entries", "certificate_id", "learning", "certificates", "fk_cpd_cert_same_org"),
    # MemberActivity → OrgMember; Course/Lecture omitted (platform-owned catalog rows allowed).
    fk("member_activities", "member_id", "org", "org_members", "fk_act_member_same_org", "CASCADE"),
]


class Migration(migrations.Migration):
    dependencies = [("hcm", "0001_initial")]

    operations = [
        migrations.RunSQL(fwd, rev)
        for fwd, rev in (
            *(rls.company_only(S, t) for t in COMPANY_ONLY_TABLES),
            rls.manager_of_unit(S, "wellbeing_surveys"),
            *COMPOSITE_FKS,
        )
    ]
