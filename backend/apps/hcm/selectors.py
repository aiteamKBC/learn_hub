"""Optimised READ queries for HCM. All run under RLS."""

from __future__ import annotations

from uuid import UUID

from apps.org.models import OrgMember

from .models import CpdEntry, MemberProfile, MemberQualification, Qualification, WellbeingSurvey


def profile_for(*, org_id: UUID, member_id: UUID) -> MemberProfile | None:
    return (
        MemberProfile.objects.filter(org_id=org_id, member_id=member_id)
        .select_related("member__user", "line_manager__user")
        .first()
    )


def profile_payload(profile: MemberProfile) -> dict:
    """Shape a `MemberProfile` + related rows into a `ProfileOut` dict."""
    member = profile.member
    user = member.user
    lm = profile.line_manager
    return {
        "member_id": member.id,
        "full_name": user.full_name,
        "email": user.email,
        "role": member.role,
        "track": profile.track,
        "level": profile.level,
        "aspiration": profile.aspiration,
        "location": profile.location,
        "start_date": profile.start_date,
        "termination_date": profile.termination_date,
        "line_manager_id": lm.id if lm else None,
        "line_manager_name": lm.user.full_name if lm else None,
        "stay_intent": profile.stay_intent,
        "satisfaction": profile.satisfaction,
        "adjustments": profile.adjustments,
        "cpd_hours_cached": profile.cpd_hours_cached,
    }


def member_in_org(*, org_id: UUID, member_id: UUID) -> OrgMember | None:
    return OrgMember.objects.filter(org_id=org_id, id=member_id, removed_at__isnull=True).first()


# ---------------------------------------------------------------- qualifications
def qualification_catalogue(*, org_id: UUID, include_archived: bool = False):
    qs = Qualification.objects.filter(org_id=org_id)
    if not include_archived:
        qs = qs.filter(archived_at__isnull=True)
    return qs.order_by("name")


def member_qualifications(*, org_id: UUID, member_id: UUID):
    return (
        MemberQualification.objects.filter(org_id=org_id, member_id=member_id)
        .select_related("qualification")
        .order_by("-awarded_on", "qualification__name")
    )


# ---------------------------------------------------------------- CPD
def cpd_entries(*, org_id: UUID, member_id: UUID, limit: int = 50):
    return CpdEntry.objects.filter(org_id=org_id, member_id=member_id).order_by("-completed_on", "-id")[
        :limit
    ]


# ---------------------------------------------------------------- wellbeing
def recent_wellbeing(*, org_id: UUID, member_id: UUID, limit: int = 20):
    return WellbeingSurvey.objects.filter(org_id=org_id, member_id=member_id).order_by("-submitted_at")[
        :limit
    ]
