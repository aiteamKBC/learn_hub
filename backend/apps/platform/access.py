"""Unified Content Access Engine — one authoritative access function for B2C + legacy B2B.

`resolve(user, scope, target_id)` returns a typed `AccessDecision` and records the
outcome in `AccessAuditLog`. Every learner endpoint that gates protected content
(video URL signing, download SAS, quiz fetch, live-session join) MUST call it before
issuing any payload.

Decision precedence (architecture §1, decision-register D-02):
    1. admin_revoke          -> DENY   (explicit revoked ContentEntitlement with source=admin_grant)
    2. legacy enrollment     -> ALLOW  (existing personal learning.Enrollment with completed order)
    3. cash_package /
       full_course_token     -> ALLOW  (course-scope ContentEntitlement)
    4. token_unlock          -> ALLOW  (lecture/material-scope ContentEntitlement)
    5. subscription          -> ALLOW  (live-evaluated personal subscription)
    6. free preview flag     -> ALLOW  (Lecture.is_preview)
    7. otherwise             -> DENY

Subscription ALLOW is NOT persisted as an entitlement row (architecture §4.3 / §2.2).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from django.db.models import Q
from django.utils import timezone

from apps.platform.models import AccessAuditLog, ContentEntitlement

# Reason codes are stable: frontend copy and later `upgrade_hint` keying rely on them.
R_ALLOW_LEGACY = "legacy_purchase"
R_ALLOW_CASH = "cash_package"
R_ALLOW_FULL_TOKEN = "full_course_token_unlock"  # noqa: S105 - access reason code, not a password
R_ALLOW_TOKEN = "token_unlock"  # noqa: S105 - access reason code, not a password
R_ALLOW_SUB = "subscription"
R_ALLOW_PREVIEW = "preview"
R_ALLOW_ADMIN = "admin_grant"
R_DENY_REVOKED = "admin_revoked"
R_DENY_NO_ACCESS = "no_access"
R_DENY_EXPIRED = "entitlement_expired"

SCOPE_COURSE = "course"
SCOPE_LECTURE = "lecture"
SCOPE_MATERIAL = "material"


@dataclass(frozen=True)
class AccessDecision:
    allowed: bool
    source: str
    reason_code: str
    expires_at: datetime | None = None
    entitlement_id: UUID | None = None


# ---------------------------------------------------------------- lookup helpers
def _active_q(now):
    return Q(revoked_at__isnull=True) & (Q(expires_at__isnull=True) | Q(expires_at__gt=now))


def _course_id_for(scope: str, target_id, lecture_hint=None):
    """Find the course that owns a lecture/material, for the course-scope fast path."""
    if scope == SCOPE_COURSE:
        return target_id
    from apps.catalog.models import Lecture, LectureResource  # local import — no cycle

    if scope == SCOPE_LECTURE:
        lec = lecture_hint or Lecture.objects.filter(pk=target_id).only("version_id").first()
        if lec is None:
            return None
        return _course_from_version(lec.version_id)
    if scope == SCOPE_MATERIAL:
        res = (
            LectureResource.objects.filter(pk=target_id)
            .select_related("lecture")
            .only("lecture__version_id")
            .first()
        )
        if res is None:
            return None
        return _course_from_version(res.lecture.version_id)
    return None


def _course_from_version(version_id):
    from apps.catalog.models import CourseVersion

    cv = CourseVersion.objects.filter(pk=version_id).only("course_id").first()
    return cv.course_id if cv else None


def _legacy_enrollment_allows(user, course_id, now) -> bool:
    """Grandfathering: an existing personal Enrollment with a non-expired, non-revoked
    access window grants access even before the one-off backfill migration runs."""
    from apps.learning.models import Enrollment

    qs = Enrollment.objects.filter(
        user=user,
        course_id=course_id,
        org__isnull=True,
        status__in=(Enrollment.Status.ACTIVE, Enrollment.Status.COMPLETED),
    ).filter(Q(access_expires_at__isnull=True) | Q(access_expires_at__gt=now))
    return qs.exists()


def _subscription_allows(user, course_id, now, *, scope: str = "", target_id=None) -> bool:
    """Live personal subscription check. Returns True only when the user has an
    active unlimited_b2c subscription AND the course is marked in_subscription AND
    (for lecture scope) the lecture is not excluded from subscription."""
    try:
        from apps.catalog.models import Course
        from apps.commerce.models import Subscription
    except Exception:  # noqa: BLE001 - this optional resolver lookup must fail closed
        return False
    course = Course.objects.filter(pk=course_id).only("in_subscription").first()
    if course is None or not course.in_subscription:
        return False
    if scope == SCOPE_LECTURE and target_id is not None:
        from apps.catalog.models import Lecture

        lec = Lecture.objects.filter(pk=target_id).only("excluded_from_subscription").first()
        if lec and lec.excluded_from_subscription:
            return False
    has_sub = (
        Subscription.objects.filter(
            user=user,
            org__isnull=True,
            status__in=("active", "trialing"),
            plan__kind="unlimited_b2c",
        )
        .filter(Q(current_period_end__isnull=True) | Q(current_period_end__gt=now))
        .exists()
    )
    return has_sub


def _preview_allows(scope: str, target_id, lecture_hint=None) -> bool:
    if scope != SCOPE_LECTURE:
        return False
    from apps.catalog.models import Lecture

    lec = lecture_hint or Lecture.objects.filter(pk=target_id).only("is_preview").first()
    return bool(lec and lec.is_preview)


# ---------------------------------------------------------------- resolver
def resolve(user, scope: str, target_id, *, lecture_hint=None, request_id: str = "") -> AccessDecision:
    """Compute and log the access decision for one (user, scope, target).

    `lecture_hint` lets a caller that already fetched the Lecture skip a re-query.
    """
    now = timezone.now()
    course_id = _course_id_for(scope, target_id, lecture_hint=lecture_hint)

    # 1) admin_revoke — an explicit, non-expired admin_grant row with revoked_at set
    #    on this scope/target is a hard DENY. (We treat an admin grant followed by
    #    a revoke as an authoritative "no" that trumps every other ALLOW path.)
    revoked = (
        ContentEntitlement.objects.filter(
            user=user,
            scope=scope,
            target_id=target_id,
            source=ContentEntitlement.Source.ADMIN_GRANT,
            revoked_at__isnull=False,
        )
        .order_by("-revoked_at")
        .first()
    )
    if revoked is not None:
        return _record(
            user, scope, target_id, AccessDecision(False, "admin_grant", R_DENY_REVOKED), now, request_id
        )

    # Also honour course-level revoke when checking a lecture/material inside it.
    if course_id is not None and scope != SCOPE_COURSE:
        if ContentEntitlement.objects.filter(
            user=user,
            scope=SCOPE_COURSE,
            target_id=course_id,
            source=ContentEntitlement.Source.ADMIN_GRANT,
            revoked_at__isnull=False,
        ).exists():
            return _record(
                user, scope, target_id, AccessDecision(False, "admin_grant", R_DENY_REVOKED), now, request_id
            )

    # 2) legacy direct enrollment (grandfathering branch)
    if course_id is not None and _legacy_enrollment_allows(user, course_id, now):
        return _record(
            user, scope, target_id, AccessDecision(True, R_ALLOW_LEGACY, R_ALLOW_LEGACY), now, request_id
        )

    # 3) cash_package OR full_course_token_unlock — course-scope entitlement covering this content
    if course_id is not None:
        ent = (
            ContentEntitlement.objects.filter(
                _active_q(now),
                user=user,
                scope=SCOPE_COURSE,
                target_id=course_id,
                source__in=(
                    ContentEntitlement.Source.CASH_PACKAGE,
                    ContentEntitlement.Source.FULL_COURSE_TOKEN_UNLOCK,
                    ContentEntitlement.Source.ADMIN_GRANT,
                ),
            )
            .only("id", "source", "expires_at")
            .first()
        )
        if ent is not None:
            reason = (
                R_ALLOW_CASH
                if ent.source == ContentEntitlement.Source.CASH_PACKAGE
                else (
                    R_ALLOW_FULL_TOKEN
                    if ent.source == ContentEntitlement.Source.FULL_COURSE_TOKEN_UNLOCK
                    else R_ALLOW_ADMIN
                )
            )
            return _record(
                user,
                scope,
                target_id,
                AccessDecision(True, ent.source, reason, ent.expires_at, ent.id),
                now,
                request_id,
            )

    # 4) token_unlock OR admin_grant on this exact scope/target
    ent = (
        ContentEntitlement.objects.filter(
            _active_q(now),
            user=user,
            scope=scope,
            target_id=target_id,
            source__in=(
                ContentEntitlement.Source.TOKEN_UNLOCK,
                ContentEntitlement.Source.ADMIN_GRANT,
                ContentEntitlement.Source.LEGACY_PURCHASE,
                ContentEntitlement.Source.CASH_PACKAGE,
                ContentEntitlement.Source.FULL_COURSE_TOKEN_UNLOCK,
            ),
        )
        .only("id", "source", "expires_at")
        .first()
    )
    if ent is not None:
        reason = {
            ContentEntitlement.Source.TOKEN_UNLOCK: R_ALLOW_TOKEN,
            ContentEntitlement.Source.ADMIN_GRANT: R_ALLOW_ADMIN,
            ContentEntitlement.Source.LEGACY_PURCHASE: R_ALLOW_LEGACY,
            ContentEntitlement.Source.CASH_PACKAGE: R_ALLOW_CASH,
            ContentEntitlement.Source.FULL_COURSE_TOKEN_UNLOCK: R_ALLOW_FULL_TOKEN,
        }[ent.source]
        return _record(
            user,
            scope,
            target_id,
            AccessDecision(True, ent.source, reason, ent.expires_at, ent.id),
            now,
            request_id,
        )

    # 5) live personal subscription
    if course_id is not None and _subscription_allows(user, course_id, now, scope=scope, target_id=target_id):
        return _record(
            user,
            scope,
            target_id,
            AccessDecision(True, ContentEntitlement.Source.SUBSCRIPTION, R_ALLOW_SUB),
            now,
            request_id,
        )

    # 6) free preview
    if _preview_allows(scope, target_id, lecture_hint=lecture_hint):
        return _record(
            user,
            scope,
            target_id,
            AccessDecision(True, ContentEntitlement.Source.PREVIEW, R_ALLOW_PREVIEW),
            now,
            request_id,
        )

    # 7) nothing matched
    return _record(user, scope, target_id, AccessDecision(False, "", R_DENY_NO_ACCESS), now, request_id)


def _record(user, scope, target_id, decision: AccessDecision, now, request_id: str) -> AccessDecision:
    try:
        AccessAuditLog.objects.create(
            user=user,
            scope=scope,
            target_id=target_id,
            decision=AccessAuditLog.Decision.ALLOW if decision.allowed else AccessAuditLog.Decision.DENY,
            reason_code=decision.reason_code,
            resolved_source=decision.source or "",
            checked_at=now,
            request_id=request_id or "",
        )
    except Exception:  # noqa: BLE001, S110 - audit failure must not break access resolution
        # Resolver must never fail the request because of an audit-write hiccup.
        # TODO(M-wallet): move to async queue so this branch becomes impossible.
        pass
    return decision
