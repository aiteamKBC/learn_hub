"""What staff allow each marketplace instructor to do (console > Instructors > Permissions).

No row = the defaults on `InstructorPermission`, plus two platform settings
(instructors.default_max_courses, instructors.coupons_enabled). The studio calls these
checks on the server; the UI only mirrors them.
"""

from core.errors import ServiceError

from .models import Course, CourseInstructor, InstructorPermission, VideoLibrary

FIELDS = ("can_publish_without_review", "can_create_coupons", "can_use_drm", "can_issue_certificates")


def for_user(user_id) -> dict:
    """The effective permissions of one instructor (row or defaults, settings applied)."""
    from apps.platform.services import get_setting

    row = InstructorPermission.objects.filter(user_id=user_id).first()
    perms = {f: getattr(row, f) if row else InstructorPermission._meta.get_field(f).default for f in FIELDS}
    default_max = get_setting("instructors.default_max_courses") or None  # 0 = no limit
    perms["max_courses"] = row.max_courses if row and row.max_courses is not None else default_max
    perms["is_custom"] = row is not None
    if not get_setting("instructors.coupons_enabled"):
        perms["can_create_coupons"] = False  # switched off for everyone
    return perms


def ensure_active(user) -> None:
    """A suspended instructor keeps their courses live but loses the studio."""
    from apps.identity.models import InstructorProfile

    if InstructorProfile.objects.filter(user=user, status=InstructorProfile.Status.SUSPENDED).exists():
        raise ServiceError("suspended", "Your teaching account is suspended. Contact support.", status=403)


def check_course_limit(user) -> None:
    limit = for_user(user.id)["max_courses"]
    if limit is None:
        return
    owned = (
        CourseInstructor.objects.filter(user=user, course__deleted_at__isnull=True)
        .values("course_id")
        .distinct()
        .count()
    )
    if owned >= limit:
        raise ServiceError(
            "course_limit", f"You can have up to {limit} courses. Contact support to raise it.", status=403
        )


def check_coupons(user) -> None:
    if not for_user(user.id)["can_create_coupons"]:
        raise ServiceError("coupons_off", "Creating coupons is not allowed on your account.", status=403)


def publishes_without_review(user, course: Course) -> bool:
    return course.ownership == Course.Ownership.INSTRUCTOR and for_user(user.id)["can_publish_without_review"]


def default_library(user, course: Course) -> VideoLibrary | None:
    """Marketplace instructors upload to a DRM library only with permission."""
    qs = VideoLibrary.objects.filter(is_default=True)
    if course.ownership == Course.Ownership.INSTRUCTOR and not for_user(user.id)["can_use_drm"]:
        qs = qs.filter(protection_level=VideoLibrary.Protection.STANDARD)
    return qs.first()
