"""Competence scoring (pure compute + cache refresh).

The *evidenced* level of a competency for a member is the highest `target_level`
among the courses they have completed that are tagged with that competency
(`CourseCompetency`). A role version's requirements each name a competency and a
required level; `competence_score` is the weight-weighted fraction of required
levels the member has evidenced, scaled to 0..100. `readiness` combines that with
the version's required qualifications.

Nothing here mutates framework definitions; `recompute_evidenced` is the only
writer and it only refreshes the denormalised cache on `hcm.MemberProfile`.
"""

from __future__ import annotations

from uuid import UUID

from django.utils import timezone

from .models import CourseCompetency, MaturityCriterion, MaturityResponse

READY_THRESHOLD = 80.0  # competence_score at or above this (and quals met) = ready


# ---------------------------------------------------------------- evidence
def evidenced_levels(*, org_id: UUID, user_id: UUID) -> dict[str, int]:
    """Map {str(competency_id): evidenced_level 1..5} from the member's completed
    course enrolments. Keys are stringified UUIDs so the result is JSON-safe for the
    `MemberProfile.evidenced_cached` column."""
    # Late import: frameworks -> learning is a "downward" dependency (STRUCTURE.md).
    from apps.learning.models import Enrollment

    completed_course_ids = list(
        Enrollment.objects.filter(
            org_id=org_id, user_id=user_id, status=Enrollment.Status.COMPLETED
        ).values_list("course_id", flat=True)
    )
    if not completed_course_ids:
        return {}

    levels: dict[str, int] = {}
    tags = CourseCompetency.objects.filter(course_id__in=completed_course_ids).values_list(
        "competency_id", "target_level"
    )
    for competency_id, target_level in tags:
        key = str(competency_id)
        if target_level > levels.get(key, 0):
            levels[key] = int(target_level)
    return levels


def competence_score(*, evidenced: dict[str, int], requirements) -> float:
    """Weight-weighted attainment of the requirement levels, 0..100.

    `requirements` is an iterable of RoleRequirement rows. Requirements with no
    competency (free-text only) do not contribute to the score. Returns 100.0 when
    there is nothing measurable to score against."""
    total_weight = 0
    attained = 0.0
    for req in requirements:
        if req.competency_id is None or req.level <= 0:
            continue
        have = evidenced.get(str(req.competency_id), 0)
        frac = min(have / req.level, 1.0)
        attained += frac * req.weight
        total_weight += req.weight
    if total_weight == 0:
        return 100.0
    return round(100.0 * attained / total_weight, 1)


def readiness(*, org_id: UUID, member, version) -> dict:
    """Full readiness breakdown of `member` against a RoleFrameworkVersion."""
    from apps.hcm.models import MemberQualification

    requirements = list(version.requirements.select_related("competency").all())
    evidenced = evidenced_levels(org_id=org_id, user_id=member.user_id)

    score = competence_score(evidenced=evidenced, requirements=requirements)

    required_quals = list(version.required_qualification_ids or [])
    missing_quals: list[UUID] = []
    if required_quals:
        held = set(
            MemberQualification.objects.filter(
                org_id=org_id, member_id=member.id, qualification_id__in=required_quals
            ).values_list("qualification_id", flat=True)
        )
        missing_quals = [q for q in required_quals if q not in held]
    quals_met = not missing_quals

    gaps = []
    for req in requirements:
        if req.competency_id is None:
            continue
        have = evidenced.get(str(req.competency_id), 0)
        if have < req.level:
            gaps.append(
                {
                    "competency_id": req.competency_id,
                    "code": req.competency.code if req.competency_id else "",
                    "name": req.competency.name if req.competency_id else req.text,
                    "required_level": req.level,
                    "evidenced_level": have,
                    "priority": req.priority,
                }
            )

    return {
        "member_id": member.id,
        "version_id": version.id,
        "competence_score": score,
        "qualifications_met": quals_met,
        "missing_qualification_ids": missing_quals,
        "ready": score >= READY_THRESHOLD and quals_met,
        "gaps": gaps,
    }


def recompute_evidenced(*, org_id: UUID, member) -> dict[str, int]:
    """Refresh `hcm.MemberProfile.evidenced_cached` for one member and return the map."""
    from apps.hcm.models import MemberProfile

    levels = evidenced_levels(org_id=org_id, user_id=member.user_id)
    MemberProfile.objects.filter(org_id=org_id, member_id=member.id).update(
        evidenced_cached=levels, evidenced_cached_at=timezone.now()
    )
    return levels


# ---------------------------------------------------------------- maturity scoring
def score_campaign(*, org_id: UUID, campaign) -> dict:
    """Aggregate all responses for a campaign into a scores snapshot.

    `MaturityResponse.answers` is {str(criterion_id): rating 1..5}. We compute the
    mean rating per criterion, roll criteria up into their dimensions weighted by
    `MaturityCriterion.weight`, then roll dimensions up weighted by dimension weight.
    If criterion ids don't resolve to this version's criteria (free-form answers),
    we fall back to a flat mean of every rating."""
    responses = list(
        MaturityResponse.objects.filter(org_id=org_id, campaign_id=campaign.id).values_list(
            "answers", flat=True
        )
    )
    n = len(responses)
    if n == 0:
        return {"n": 0, "overall": None, "by_criterion": {}, "by_dimension": {}}

    # Mean rating per criterion id across responses.
    sums: dict[str, float] = {}
    counts: dict[str, int] = {}
    all_ratings: list[float] = []
    for answers in responses:
        if not isinstance(answers, dict):
            continue
        for crit_id, rating in answers.items():
            try:
                val = float(rating)
            except (TypeError, ValueError):
                continue
            sums[crit_id] = sums.get(crit_id, 0.0) + val
            counts[crit_id] = counts.get(crit_id, 0) + 1
            all_ratings.append(val)

    by_criterion = {cid: round(sums[cid] / counts[cid], 2) for cid in sums}

    # Resolve criteria -> dimensions for a weighted rollup.
    version_id = campaign.framework_version_id
    crit_rows = {
        str(c.id): c
        for c in MaturityCriterion.objects.filter(
            dimension__version_id=version_id, id__in=list(by_criterion.keys())
        ).select_related("dimension")
    }

    by_dimension: dict[str, float] = {}
    if crit_rows:
        dim_num: dict[str, float] = {}
        dim_den: dict[str, float] = {}
        dim_weight: dict[str, int] = {}
        for cid, mean in by_criterion.items():
            crit = crit_rows.get(cid)
            if crit is None:
                continue
            dkey = str(crit.dimension_id)
            dim_num[dkey] = dim_num.get(dkey, 0.0) + mean * crit.weight
            dim_den[dkey] = dim_den.get(dkey, 0.0) + crit.weight
            dim_weight[dkey] = crit.dimension.weight
        for dkey in dim_num:
            if dim_den[dkey]:
                by_dimension[dkey] = round(dim_num[dkey] / dim_den[dkey], 2)
        if by_dimension:
            tot_w = sum(dim_weight[d] for d in by_dimension) or 1
            overall = round(sum(by_dimension[d] * dim_weight[d] for d in by_dimension) / tot_w, 2)
            return {
                "n": n,
                "overall": overall,
                "by_criterion": by_criterion,
                "by_dimension": by_dimension,
            }

    # Fallback: flat mean of every rating.
    overall = round(sum(all_ratings) / len(all_ratings), 2) if all_ratings else None
    return {"n": n, "overall": overall, "by_criterion": by_criterion, "by_dimension": {}}
