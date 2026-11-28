"""HCM endpoints: member profile, qualifications, CPD and wellbeing.

Mounted at /api/v1/hcm/ via DOMAIN_APPS. Requires session auth + X-Org-Id.
Self-service endpoints live under /me/; HR admin endpoints under /people/ and
/qualifications/.
"""

from __future__ import annotations

from uuid import UUID

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router

from apps.catalog.models import MediaAsset
from core.auth import session_auth
from core.errors import ServiceError
from core.permissions import OrgRole, org_scope, require_org

from . import certificates, selectors, services
from . import permissions as perms
from .models import MemberProfile, MemberQualification, Qualification, TrainingPlan, TrainingPlanItem
from .schemas import (
    CertificateTicketOut,
    CertificateUploadIn,
    CertificateUrlOut,
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
    TrainingPlanCompleteIn,
    TrainingPlanItemIn,
    TrainingPlanItemOut,
    TrainingPlanOut,
    TrainingPlanPatch,
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
    asset = row.evidence_asset
    has_cert = asset is not None and asset.status == MediaAsset.Status.READY
    return {
        "id": row.id,
        "qualification_id": row.qualification_id,
        "qualification_name": row.qualification.name,
        "code": row.qualification.code,
        "awarded_on": row.awarded_on,
        "expires_on": row.expires_on,
        "has_certificate": has_cert,
        "certificate_filename": (asset.original_filename if has_cert else "") or "",
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
        "answers": row.answers or {},
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


@router.get("/people/{member_id}/wellbeing", response=list[WellbeingOut])
def member_wellbeing(request, member_id: UUID):
    """A member's wellbeing check-ins, for the member themselves or an HR admin.
    RLS already limits raw rows to the member and their managers."""
    perms.require_self_or_hr(request, member_id)
    org_id = require_org(request)
    return [_wb_payload(r) for r in selectors.recent_wellbeing(org_id=org_id, member_id=member_id)]


@router.get("/people/{member_id}/qualifications", response=list[MemberQualificationOut])
def list_member_qualifications(request, member_id: UUID):
    """The qualifications an HR admin has awarded a specific person (with certificates)."""
    perms.require_self_or_hr(request, member_id)
    org_id = require_org(request)
    return [_mq_payload(r) for r in selectors.member_qualifications(org_id=org_id, member_id=member_id)]


@router.post("/people/{member_id}/qualifications/certificate-upload", response=CertificateTicketOut)
def start_certificate_upload(request, member_id: UUID, data: CertificateUploadIn):
    """Step 1 of attaching a certificate: a short-lived, write-only link to Azure."""
    perms.require_hr_admin(request)
    org_id = require_org(request)
    member = selectors.member_in_org(org_id=org_id, member_id=member_id)
    if member is None:
        raise ServiceError("member_not_found", "Member not found in this company.", status=404)
    return certificates.start_upload(
        org_id=org_id, member=member, user=request.auth, filename=data.filename, size_bytes=data.size_bytes
    )


@router.post("/people/{member_id}/qualifications", response=MemberQualificationOut)
def award_member_qualification(request, member_id: UUID, data: MemberQualificationIn):
    perms.require_hr_admin(request)
    org_id = require_org(request)
    member = selectors.member_in_org(org_id=org_id, member_id=member_id)
    if member is None:
        raise ServiceError("member_not_found", "Member not found in this company.", status=404)
    qual = get_object_or_404(Qualification, pk=data.qualification_id, org_id=org_id)
    asset = None
    if data.certificate_asset_id is not None:
        # confirm the certificate really landed in storage before linking it
        asset = certificates.verify(org_id=org_id, asset_id=data.certificate_asset_id, user=request.auth)
    mq = services.award_qualification(
        org_id=org_id,
        member=member,
        qualification=qual,
        awarded_on=data.awarded_on,
        expires_on=data.expires_on,
        evidence_asset=asset,
    )
    mq.qualification = qual  # avoid a second fetch inside the payload helper
    return _mq_payload(mq)


@router.get("/member-qualifications/{mq_id}/certificate", response=CertificateUrlOut)
def member_qualification_certificate(request, mq_id: UUID):
    """A 1-hour download link for a qualification's certificate. The holder may see
    their own; HR admins may see anyone's in their company."""
    org_id = require_org(request)
    mq = (
        MemberQualification.objects.select_related("evidence_asset", "member")
        .filter(org_id=org_id, pk=mq_id)
        .first()
    )
    if mq is None or mq.evidence_asset is None:
        raise ServiceError("not_found", "No certificate on file.", status=404)
    perms.require_self_or_hr(request, mq.member_id)
    if mq.evidence_asset.status != MediaAsset.Status.READY:
        raise ServiceError("not_found", "No certificate on file.", status=404)
    return {
        "url": certificates.download_url(mq.evidence_asset),
        "filename": mq.evidence_asset.original_filename or "certificate",
    }


# ---------------------------------------------------------------- development training plans
def _training_item_payload(item):
    course = item.course
    owner = item.owner
    return {
        "id": item.id,
        "kind": item.kind,
        "course_id": item.course_id,
        "course_slug": course.slug if course else None,
        "title": course.title if course else item.title,
        "provider": item.provider,
        "external_url": item.external_url,
        "purpose": item.purpose,
        "source": item.source,
        "source_detail": item.source_detail,
        "owner_id": item.owner_id,
        "owner_name": owner.user.full_name if owner else None,
        "assigned_by_name": item.assigned_by.full_name,
        "assigned_at": item.assigned_at,
        "due_at": item.due_at,
        "estimated_hours": item.estimated_hours,
        "completed_hours": item.completed_hours,
        "status": item.status,
        "completed_on": item.completed_on,
    }


def _training_plan_payload(member_id, plan):
    return {
        "member_id": member_id,
        "owner_id": plan.owner_id if plan else None,
        "owner_name": plan.owner.user.full_name if plan and plan.owner else None,
        "period_start": plan.period_start if plan else None,
        "period_end": plan.period_end if plan else None,
        "items": [
            _training_item_payload(item)
            for item in plan.items.select_related("course", "owner__user", "assigned_by").order_by(
                "due_at", "created_at"
            )
        ]
        if plan
        else [],
    }


@router.get("/people/{member_id}/training-plan", response=TrainingPlanOut)
def get_training_plan(request, member_id: UUID):
    perms.require_hr_admin(request)
    org_id = require_org(request)
    member = selectors.member_in_org(org_id=org_id, member_id=member_id)
    if member is None:
        raise ServiceError("member_not_found", "Member not found in this company.", status=404)
    plan = TrainingPlan.objects.filter(org_id=org_id, member=member).select_related("owner__user").first()
    return _training_plan_payload(member_id, plan)


@router.patch("/people/{member_id}/training-plan", response=TrainingPlanOut)
def update_training_plan(request, member_id: UUID, data: TrainingPlanPatch):
    perms.require_hr_admin(request)
    org_id = require_org(request)
    member = selectors.member_in_org(org_id=org_id, member_id=member_id)
    if member is None:
        raise ServiceError("member_not_found", "Member not found in this company.", status=404)
    changes = data.dict(exclude_unset=True)
    owner_id = changes.pop("owner_id", None)
    owner = selectors.member_in_org(org_id=org_id, member_id=owner_id) if owner_id else None
    if owner_id and owner is None:
        raise ServiceError("owner_not_found", "Plan owner not found in this company.", status=404)
    plan, _ = TrainingPlan.objects.get_or_create(org_id=org_id, member=member)
    next_start = changes.get("period_start", plan.period_start)
    next_end = changes.get("period_end", plan.period_end)
    if next_start and next_end and next_end < next_start:
        raise ServiceError("invalid_plan_period", "The plan end date must be on or after its start date.")
    for field, value in changes.items():
        setattr(plan, field, value)
    if "owner_id" in data.model_fields_set:
        plan.owner = owner
    plan.save()
    return _training_plan_payload(member_id, plan)


@router.post("/people/{member_id}/training-plan/items", response=TrainingPlanItemOut)
def add_training_plan_item(request, member_id: UUID, data: TrainingPlanItemIn):
    # Thin view keeps a clean signature for OpenAPI; the atomic work is in the helper
    # (stacking @transaction.atomic on a Ninja view breaks schema generation under
    # `from __future__ import annotations`).
    return _add_training_plan_item(request, member_id, data)


@transaction.atomic
def _add_training_plan_item(request, member_id, data):
    perms.require_hr_admin(request)
    org_id = require_org(request)
    member = selectors.member_in_org(org_id=org_id, member_id=member_id)
    if member is None:
        raise ServiceError("member_not_found", "Member not found in this company.", status=404)

    owner = selectors.member_in_org(org_id=org_id, member_id=data.owner_id) if data.owner_id else None
    if data.owner_id and owner is None:
        raise ServiceError("owner_not_found", "Item owner not found in this company.", status=404)

    course = None
    if data.kind == TrainingPlanItem.Kind.COURSE:
        if data.course_id is None:
            raise ServiceError("course_required", "Choose a course for an internal learning item.")
        from apps.org.api import _library

        course = _library(org_id).filter(pk=data.course_id).first()
        if course is None:
            raise ServiceError(
                "course_unavailable", "This course is not available to your company.", status=404
            )
    elif data.course_id is not None:
        raise ServiceError("external_course_id", "External learning cannot use a LearnHub course.")
    elif not data.title.strip():
        raise ServiceError("title_required", "Enter a title for external learning.")

    plan, _ = TrainingPlan.objects.get_or_create(org_id=org_id, member=member)
    if course:
        duplicate = plan.items.filter(course=course).exists()
        if duplicate:
            raise ServiceError("already_planned", "This course is already on this person's plan.", status=409)
        from apps.learning.models import Enrollment

        has_access = Enrollment.objects.filter(
            org_id=org_id,
            user_id=member.user_id,
            course=course,
            status__in=[Enrollment.Status.ACTIVE, Enrollment.Status.COMPLETED],
        ).exists()
        if not has_access:
            from apps.corporate.assign import assign_with_seats, seat_check
            from apps.learning import services as learning

            seats = seat_check(org_id, course.id, 1)
            if seats is not None:
                scope = org_scope(request, OrgRole.ADMIN)
                assigned = assign_with_seats(request, scope, seats, [member.user_id])
            else:
                assigned = learning.assign_to_members(
                    org_id=org_id, course=course, user_ids=[member.user_id], assigned_by=request.user
                )
            if assigned:
                from apps.engagement import notify
                from apps.org.models import Organization

                org_name = Organization.objects.filter(pk=org_id).values_list("name", flat=True).first()
                notify.notify(
                    assigned,
                    "course_assigned",
                    {"course": course.title, "company": org_name},
                    url=f"/learn/{course.slug}",
                    dedupe=f"assign:{course.id}:{org_id}",
                )

    item = TrainingPlanItem.objects.create(
        org_id=org_id,
        plan=plan,
        kind=data.kind,
        course=course,
        title=course.title if course else data.title.strip(),
        provider=data.provider.strip(),
        external_url=data.external_url.strip(),
        purpose=data.purpose,
        source=TrainingPlanItem.Source.EXTERNAL
        if data.kind == TrainingPlanItem.Kind.EXTERNAL
        else data.source,
        source_detail=data.source_detail.strip(),
        owner=owner,
        assigned_by=request.user,
        assigned_at=timezone.now(),
        due_at=data.due_at,
        estimated_hours=data.estimated_hours,
    )
    from apps.platform.services import audit_request

    audit_request(
        request,
        "training_plan.item_add",
        "training_plan_item",
        item.id,
        {"member_id": str(member_id), "kind": item.kind, "course_id": str(course.id) if course else None},
    )
    return _training_item_payload(item)


@router.post("/people/{member_id}/training-plan/items/{item_id}/complete", response=TrainingPlanItemOut)
def complete_training_plan_item(request, member_id: UUID, item_id: UUID, data: TrainingPlanCompleteIn):
    return _complete_training_plan_item(request, member_id, item_id, data)


@transaction.atomic
def _complete_training_plan_item(request, member_id, item_id, data):
    perms.require_hr_admin(request)
    org_id = require_org(request)
    item = get_object_or_404(
        TrainingPlanItem.objects.select_related("plan__member", "course", "owner__user", "assigned_by"),
        pk=item_id,
        org_id=org_id,
        plan__member_id=member_id,
    )
    if item.kind != TrainingPlanItem.Kind.EXTERNAL:
        raise ServiceError(
            "internal_completion", "LearnHub course completion is recorded from learner progress."
        )
    if item.status != TrainingPlanItem.Status.COMPLETED:
        item.status = TrainingPlanItem.Status.COMPLETED
        item.completed_on = timezone.now().date()
        item.completed_hours = data.hours
        item.save(update_fields=["status", "completed_on", "completed_hours", "updated_at"])
        services.record_external_cpd(
            org_id=org_id,
            member=item.plan.member,
            title=item.title,
            provider=item.provider,
            completed_on=item.completed_on,
            hours=item.completed_hours,
        )
    return _training_item_payload(item)


@router.delete("/people/{member_id}/training-plan/items/{item_id}", response=HcmOk)
def delete_training_plan_item(request, member_id: UUID, item_id: UUID):
    perms.require_hr_admin(request)
    org_id = require_org(request)
    item = get_object_or_404(TrainingPlanItem, pk=item_id, org_id=org_id, plan__member_id=member_id)
    item.delete()  # Removes the plan entry only; an issued course enrolment remains valid.
    from apps.platform.services import audit_request

    audit_request(request, "training_plan.item_remove", "training_plan", member_id, {"item_id": str(item_id)})
    return {"ok": True}


# ---------------------------------------------------------------- misc
@router.get("/health", response=HcmOk)
def health(request):
    require_org(request)
    return {"ok": True}
