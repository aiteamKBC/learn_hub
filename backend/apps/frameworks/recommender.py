"""Gap → course recommender.

Given a member's readiness gaps against a role version, suggest courses that are
tagged (`CourseCompetency`) with the gap competency at a target level that meets or
exceeds what the role requires. Platform and own-org tags are both visible under
RLS. Courses the member has already completed are excluded.
"""

from __future__ import annotations

from uuid import UUID

from .models import CourseCompetency
from .scoring import readiness


def recommend_for_version(*, org_id: UUID, member, version, limit: int = 20) -> list[dict]:
    r = readiness(org_id=org_id, member=member, version=version)
    gaps = r["gaps"]
    if not gaps:
        return []

    from apps.learning.models import Enrollment

    completed = set(
        Enrollment.objects.filter(
            org_id=org_id, user_id=member.user_id, status=Enrollment.Status.COMPLETED
        ).values_list("course_id", flat=True)
    )

    gap_by_comp = {g["competency_id"]: g for g in gaps}
    tags = (
        CourseCompetency.objects.filter(competency_id__in=list(gap_by_comp.keys()))
        .select_related("course", "competency")
        .order_by("competency__sort_order", "-target_level")
    )

    out: list[dict] = []
    seen: set[tuple[UUID, UUID]] = set()
    for tag in tags:
        gap = gap_by_comp.get(tag.competency_id)
        if gap is None or tag.target_level < gap["required_level"]:
            continue
        if tag.course_id in completed:
            continue
        key = (tag.competency_id, tag.course_id)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "competency_id": tag.competency_id,
                "competency_code": tag.competency.code,
                "required_level": gap["required_level"],
                "course_id": tag.course_id,
                "course_title": tag.course.title,
                "target_level": tag.target_level,
            }
        )
        if len(out) >= limit:
            break
    return out
