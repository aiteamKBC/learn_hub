"""B2C-05 — Token unlock: spend tokens to gain access to content.

Server-authoritative: the price is looked up on the server, never trusted from
the client. On success a ContentEntitlement row is created (source=token_unlock
or full_course_token_unlock) and the wallet is debited via wallet.spend_tokens().
"""

from __future__ import annotations

from uuid import UUID

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.platform.models import ContentEntitlement
from apps.platform.services import audit_request

from . import wallet


class AlreadyUnlocked(Exception):
    pass


class NoPriceSet(Exception):
    pass


@transaction.atomic
def unlock_lecture(*, user, lecture_id: UUID, actor=None, request=None) -> ContentEntitlement:
    from apps.catalog.models import Lecture

    lec = Lecture.objects.select_related("section__version__course").filter(pk=lecture_id).first()
    if lec is None:
        raise ValueError("Lecture not found.")

    if lec.token_price is None or lec.token_price <= 0:
        raise NoPriceSet("This lecture does not have a token price.")

    existing = (
        ContentEntitlement.objects.filter(
            user=user,
            scope=ContentEntitlement.Scope.LECTURE,
            target_id=lecture_id,
            revoked_at__isnull=True,
        )
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()))
        .first()
    )
    if existing:
        raise AlreadyUnlocked("You already have access to this lecture.")

    course = lec.section.version.course
    course_id = course.id
    instructor_id = _instructor_id(course_id)

    spend = wallet.spend_tokens(
        user=user,
        scope="lecture",
        target_id=lecture_id,
        tokens=lec.token_price,
        course_id=course_id,
        instructor_id=instructor_id,
        actor=actor or user,
        request=request,
    )

    ent = ContentEntitlement.objects.create(
        user=user,
        scope=ContentEntitlement.Scope.LECTURE,
        target_id=lecture_id,
        source=ContentEntitlement.Source.TOKEN_UNLOCK,
        source_ref=spend.id,
        source_ref_kind="token_spend",
        granted_at=timezone.now(),
    )

    spend.entitlement = ent
    spend.save(update_fields=["entitlement", "updated_at"])

    if request:
        audit_request(
            request,
            "content.unlock",
            "lecture",
            str(lecture_id),
            {
                "tokens": lec.token_price,
                "spend_id": str(spend.id),
            },
        )

    return ent


@transaction.atomic
def unlock_material(*, user, material_id: UUID, actor=None, request=None) -> ContentEntitlement:
    from apps.catalog.models import LectureResource

    res = (
        LectureResource.objects.select_related("lecture__section__version__course")
        .filter(pk=material_id)
        .first()
    )
    if res is None:
        raise ValueError("Material not found.")

    if res.token_price is None or res.token_price <= 0:
        raise NoPriceSet("This material does not have a token price.")

    existing = (
        ContentEntitlement.objects.filter(
            user=user,
            scope=ContentEntitlement.Scope.MATERIAL,
            target_id=material_id,
            revoked_at__isnull=True,
        )
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()))
        .first()
    )
    if existing:
        raise AlreadyUnlocked("You already have access to this material.")

    course = res.lecture.section.version.course
    course_id = course.id
    instructor_id = _instructor_id(course_id)

    spend = wallet.spend_tokens(
        user=user,
        scope="material",
        target_id=material_id,
        tokens=res.token_price,
        course_id=course_id,
        instructor_id=instructor_id,
        actor=actor or user,
        request=request,
    )

    ent = ContentEntitlement.objects.create(
        user=user,
        scope=ContentEntitlement.Scope.MATERIAL,
        target_id=material_id,
        source=ContentEntitlement.Source.TOKEN_UNLOCK,
        source_ref=spend.id,
        source_ref_kind="token_spend",
        granted_at=timezone.now(),
    )

    spend.entitlement = ent
    spend.save(update_fields=["entitlement", "updated_at"])

    if request:
        audit_request(
            request,
            "content.unlock",
            "material",
            str(material_id),
            {
                "tokens": res.token_price,
                "spend_id": str(spend.id),
            },
        )

    return ent


@transaction.atomic
def unlock_course(*, user, course_id: UUID, actor=None, request=None) -> ContentEntitlement:
    from apps.catalog.models import Course

    course = Course.objects.filter(pk=course_id).first()
    if course is None:
        raise ValueError("Course not found.")

    if course.full_course_token_price is None or course.full_course_token_price <= 0:
        raise NoPriceSet("This course does not have a full-course token price.")

    existing = (
        ContentEntitlement.objects.filter(
            user=user,
            scope=ContentEntitlement.Scope.COURSE,
            target_id=course_id,
            source=ContentEntitlement.Source.FULL_COURSE_TOKEN_UNLOCK,
            revoked_at__isnull=True,
        )
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()))
        .first()
    )
    if existing:
        raise AlreadyUnlocked("You already have full access to this course.")

    instructor_id = _instructor_id(course_id)

    spend = wallet.spend_tokens(
        user=user,
        scope="course",
        target_id=course_id,
        tokens=course.full_course_token_price,
        course_id=course_id,
        instructor_id=instructor_id,
        actor=actor or user,
        request=request,
    )

    ent = ContentEntitlement.objects.create(
        user=user,
        scope=ContentEntitlement.Scope.COURSE,
        target_id=course_id,
        source=ContentEntitlement.Source.FULL_COURSE_TOKEN_UNLOCK,
        source_ref=spend.id,
        source_ref_kind="token_spend",
        granted_at=timezone.now(),
    )

    spend.entitlement = ent
    spend.save(update_fields=["entitlement", "updated_at"])

    if request:
        audit_request(
            request,
            "content.unlock",
            "course",
            str(course_id),
            {
                "tokens": course.full_course_token_price,
                "spend_id": str(spend.id),
            },
        )

    return ent


def _instructor_id(course_id):
    from apps.catalog.models import CourseInstructor

    ci = CourseInstructor.objects.filter(course_id=course_id).order_by("position").first()
    return ci.user_id if ci else None
