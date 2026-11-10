"""Staff invite someone to teach (console > Instructors > Add instructor).

The emailed link is a signed, time-limited token (Django's signing with the SECRET_KEY)
naming an InstructorInvite row, so nothing secret is stored and a changed or expired link
is refused. The row lets staff see pending invitations, resend them (a fresh 7 days) and
cancel them (every link for it stops working). Accepting needs the signed-in account to
own the invited email address; it then becomes an approved marketplace instructor with
the platform's default rate.
"""

from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from core.errors import ServiceError
from core.tenancy import tenant_context

from .models import InstructorInvite, InstructorProfile

SALT = "lms.instructor-invite"
MAX_AGE = 7 * 24 * 3600  # 7 days, like company invites


def make_token(*, email: str, invited_by, invite_id=None) -> str:
    data = {"email": email.strip().lower(), "by": str(invited_by.id)}
    if invite_id:
        data["id"] = str(invite_id)
    return signing.dumps(data, salt=SALT, compress=True)


def read_token(token: str) -> dict:
    try:
        data = signing.loads(token, salt=SALT, max_age=MAX_AGE)
    except signing.SignatureExpired as e:
        raise ServiceError(
            "invite_expired", "This invitation has expired. Ask for a new one.", status=404
        ) from e
    except signing.BadSignature as e:
        raise ServiceError("invite_invalid", "This invitation is not valid.", status=404) from e
    if data.get("id"):  # links sent before invitations were kept have no row to check
        with tenant_context(staff=True):  # the signed token is the permission to look
            cancelled = InstructorInvite.objects.filter(pk=data["id"], cancelled_at__isnull=False).exists()
        if cancelled:
            raise ServiceError("invite_cancelled", "This invitation was cancelled.", status=404)
    return data


def _check_invitable(email: str) -> None:
    profile = InstructorProfile.objects.filter(user__email__iexact=email).first()
    if profile and profile.status == InstructorProfile.Status.APPROVED:
        raise ServiceError("already_instructor", "This person is already an instructor.")
    if profile and profile.status == InstructorProfile.Status.SUSPENDED:
        raise ServiceError("suspended", "This instructor is suspended. Reactivate them instead.")


def send_invite(*, email: str, name: str, invited_by) -> str:
    """Records the invitation (one pending row per email) and emails the link after the
    transaction commits. Returns the token (tests)."""
    email = email.strip().lower()
    _check_invitable(email)
    now = timezone.now()
    invite = InstructorInvite.objects.filter(
        email=email, accepted_at__isnull=True, cancelled_at__isnull=True
    ).first()
    if invite:
        invite.name = name.strip() or invite.name
        invite.invited_by = invited_by
        invite.sent_at, invite.expires_at, invite.send_count = (
            now,
            now + timedelta(seconds=MAX_AGE),
            invite.send_count + 1,
        )
        invite.save(update_fields=["name", "invited_by", "sent_at", "expires_at", "send_count", "updated_at"])
    else:
        invite = InstructorInvite.objects.create(email=email, name=name.strip(), invited_by=invited_by, sent_at=now,
                                                 expires_at=now + timedelta(seconds=MAX_AGE))  # fmt: skip
    return _email(invite, invited_by)


def resend(*, invite: InstructorInvite, by) -> InstructorInvite:
    if invite.accepted_at or invite.cancelled_at:
        raise ServiceError("invite_closed", "This invitation is no longer pending.", status=409)
    _check_invitable(invite.email)
    now = timezone.now()
    invite.sent_at, invite.expires_at, invite.send_count = (
        now,
        now + timedelta(seconds=MAX_AGE),
        invite.send_count + 1,
    )
    invite.save(update_fields=["sent_at", "expires_at", "send_count", "updated_at"])
    _email(invite, by)
    return invite


def cancel(*, invite: InstructorInvite) -> InstructorInvite:
    if invite.accepted_at:
        raise ServiceError("invite_closed", "This invitation was already accepted.", status=409)
    if not invite.cancelled_at:
        invite.cancelled_at = timezone.now()
        invite.save(update_fields=["cancelled_at", "updated_at"])
    return invite


def _email(invite: InstructorInvite, sender) -> str:
    from apps.platform.services import get_setting

    email, name, invited_by = invite.email, invite.name, sender
    token = make_token(email=email, invited_by=invited_by, invite_id=invite.id)
    platform = get_setting("general.platform_name")
    inviter = invited_by.full_name or "The team"
    link = f"{settings.FRONTEND_URL}/teach/invite/{token}"
    hello = f"Hello {name.strip()}," if name.strip() else "Hello,"
    transaction.on_commit(lambda: send_mail(
        f"{inviter} invited you to teach on {platform}",
        f"{hello}\n\n{inviter} has invited you to teach on {platform}.\n\n"
        f"Accept the invitation (valid for 7 days):\n{link}\n\n"
        "Sign in or create an account with this email address. If you were not expecting this, ignore this email.",
        None, [email], fail_silently=True,
    ))  # fmt: skip
    return token


def preview(token: str) -> dict:
    data = read_token(token)
    return {"email": data["email"]}


@transaction.atomic
def accept(*, token: str, user) -> InstructorProfile:
    from apps.engagement.notify import notify
    from apps.payouts import services as payouts

    data = read_token(token)
    if data["email"] != user.email.lower():
        raise ServiceError("wrong_account", f"This invitation is for {data['email']}. Sign in with that address.",
                           status=403)  # fmt: skip
    with tenant_context(user_id=user.id, staff=True):  # a narrow, validated write on the user's own profile
        InstructorInvite.objects.filter(
            email=data["email"], accepted_at__isnull=True, cancelled_at__isnull=True
        ).update(accepted_at=timezone.now())
        profile, _ = InstructorProfile.objects.select_for_update().get_or_create(user=user)
        if profile.status == InstructorProfile.Status.SUSPENDED:
            raise ServiceError(
                "suspended", "Your teaching account is suspended. Contact support.", status=403
            )
        if profile.status != InstructorProfile.Status.APPROVED:
            profile.status, profile.approved_at = InstructorProfile.Status.APPROVED, timezone.now()
            profile.public_slug = profile.public_slug or f"i-{user.id.hex[-12:]}"
            if profile.platform_fee_bps is None:
                profile.platform_fee_bps = payouts.default_fee_bps()
            profile.save()
            notify(
                [user.id], "instructor_approved", {}, url="/studio", dedupe=f"instructor-approved:{user.id}"
            )
    return profile
