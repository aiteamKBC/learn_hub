"""HCM endpoints: member profile, qualifications, CPD and wellbeing.

Mounted at /api/v1/hcm/ via DOMAIN_APPS. Requires session auth + X-Org-Id.
Self-service endpoints live under /me/; HR admin endpoints under /people/ and
/qualifications/.
"""

from __future__ import annotations

from uuid import UUID

from django.shortcuts import get_object_or_404
from ninja import Router

from core.auth import session_auth
from core.errors import ServiceError
from core.permissions import require_org

from . import permissions as perms
from . import selectors, services
from .models import MemberProfile, Qualification
from .schemas import (
    CpdIn,
    CpdOut,
    HcmOk,
    HrProfilePatch,
    MemberQualificationIn,
    MemberQualificationOut,
    MyProfilePatch,
    ProfileOut,
    QualificationIn,
    QualificationOut,
    WellbeingIn,
    WellbeingOut,
)

router = Router(tags=["hcm"], auth=session_auth)


# ---------------------------------------------------------------- helpers
def _profile(request, member_id: UUID) -> MemberProfile:
    org_id = require_org(request)
    profile = selectors.profile_for(org_id=org_id, member_id=member_id)
    if profile is None:
        services.ensure_profile(org_id=org_id, member_id=member_id)
        profile = selectors.profile_for(org_id=org_id, member_id=member_id)
    return profile


def _my_profile(request) -> MemberProfile:
    return _profile(request, perms.active_member_id(request))


def _cpd_payload(row) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "title": row.title,
        "provider": row.provider,
        "completed_on": row.completed_on,
        "hours": row.hours,
        "verified": row.verified_at is not None,
        "verified_at": row.verified_at,
    }


def _mq_payload(row) -> dict:
    return {
        "id": row.id,
        "qualification_id": row.qualification_id,
        "qualification_name": row.qualification.name,
        "code": row.qualification.code,
        "awarded_on": row.awarded_on,
        "expires_on": row.expires_on,
    }


def _wb_payload(row) -> dict:
    return {
        "id": row.id,
        "submitted_at": row.submitted_at,
        "hope": row.hope,
        "efficacy": row.efficacy,
        "resilience": row.resilience,
        "optimism": row.optimism,
        "overall": row.overall,
        "stay_intent": row.stay_intent,
        "satisfaction": row.satisfaction,
        "note": row.note,
    }


# ---------------------------------------------------------------- self: profile
@router.get("/me/profile", response=ProfileOut)
def my_profile(request):
    return selectors.profile_payload(_my_profile(request))


@router.patch("/me/profile", response=ProfileOut)
def update_my_profile(request, data: MyProfilePatch):
    profile = _my_profile(request)
    services.update_my_profile(profile=profile, patch=data.dict(exclude_unset=True))
    return selectors.profile_payload(profile)


# ---------------------------------------------------------------- self: wellbeing
@router.post("/me/wellbeing", response=WellbeingOut)
def submit_wellbeing(request, data: WellbeingIn):
    org_id = require_org(request)
    profile = _my_profile(request)
    survey = services.submit_wellbeing(org_id=org_id, member=profile.member, data=data.dict())
    return _wb_payload(survey)


@router.get("/me/wellbeing", response=list[WellbeingOut])
def my_wellbeing(request):
    org_id = require_org(request)
    member_id = perms.active_member_id(request)
    return [_wb_payload(r) for r in selectors.recent_wellbeing(org_id=org_id, member_id=member_id)]


# ---------------------------------------------------------------- self: CPD
@router.get("/me/cpd", response=list[CpdOut])
def my_cpd(request):
    org_id = require_org(request)
    member_id = perms.active_member_id(request)
    return [_cpd_payload(r) for r in selectors.cpd_entries(org_id=org_id, member_id=member_id)]


@router.post("/me/cpd", response=CpdOut)
def add_my_cpd(request, data: CpdIn):
    org_id = require_org(request)
    profile = _my_profile(request)
    entry = services.record_external_cpd(
        org_id=org_id,
        member=profile.member,
        title=data.title,
        provider=data.provider,
        completed_on=data.completed_on,
        hours=data.hours,
    )
    return _cpd_payload(entry)


# ---------------------------------------------------------------- self: qualifications
@router.get("/me/qualifications", response=list[MemberQualificationOut])
def my_qualifications(request):
    org_id = require_org(request)
    member_id = perms.active_member_id(request)
    return [_mq_payload(r) for r in selectors.member_qualifications(org_id=org_id, member_id=member_id)]


# ---------------------------------------------------------------- HR: qualifications catalogue
@router.get("/qualifications", response=list[QualificationOut])
def list_qualifications(request, include_archived: bool = False):
    org_id = require_org(request)
    perms.require_hr_admin(request)
    return [
        {"id": q.id, "name": q.name, "code": q.code, "archived": q.archived_at is not None}
        for q in selectors.qualification_catalogue(org_id=org_id, include_archived=include_archived)
    ]


@router.post("/qualifications", response=QualificationOut)
def create_qualification(request, data: QualificationIn):
    org_id = require_org(request)
    perms.require_hr_admin(request)
    q = services.create_qualification(org_id=org_id, name=data.name, code=data.code)
    return {"id": q.id, "name": q.name, "code": q.code, "archived": False}


# ---------------------------------------------------------------- HR: on a specific member
@router.get("/people/{member_id}/profile", response=ProfileOut)
def get_profile(request, member_id: UUID):
    perms.require_self_or_hr(request, member_id)
    return selectors.profile_payload(_profile(request, member_id))


@router.patch("/people/{member_id}/profile", response=ProfileOut)
def update_hr_profile(request, member_id: UUID, data: HrProfilePatch):
    perms.require_hr_admin(request)
    profile = _profile(request, member_id)
    services.update_hr_profile(
        profile=profile,
        patch=data.dict(exclude_unset=True),
        org_id=require_org(request),
    )
    return selectors.profile_payload(profile)


@router.post("/people/{member_id}/qualifications", response=MemberQualificationOut)
def award_member_qualification(request, member_id: UUID, data: MemberQualificationIn):
    perms.require_hr_admin(request)
    org_id = require_org(request)
    member = selectors.member_in_org(org_id=org_id, member_id=member_id)
    if member is None:
        raise ServiceError("member_not_found", "Member not found in this company.", status=404)
    qual = get_object_or_404(Qualification, pk=data.qualification_id, org_id=org_id)
    mq = services.award_qualification(
        org_id=org_id,
        member=member,
        qualification=qual,
        awarded_on=data.awarded_on,
        expires_on=data.expires_on,
    )
    mq.qualification = qual  # avoid a second fetch inside the payload helper
    return _mq_payload(mq)


# ---------------------------------------------------------------- misc
@router.get("/health", response=HcmOk)
def health(request):
    require_org(request)
    return {"ok": True}
