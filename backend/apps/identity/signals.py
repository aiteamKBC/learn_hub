"""Sign-in side effects from the console settings and security notices.

* session length: each sign-in lasts security.session_days (default 14, as before);
* 2-step sign-in turned on / off: the person gets a security notice.
"""

from allauth.mfa.signals import authenticator_added, authenticator_removed
from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver


@receiver(user_logged_in)
def session_length(sender, request, user, **kwargs):
    from apps.platform.services import get_setting

    if request is not None and hasattr(request, "session"):
        request.session.set_expiry(int(get_setting("security.session_days") or 14) * 86400)


def _security_notice(user, code: str, authenticator) -> None:
    if getattr(authenticator, "type", "") != "totp":
        return  # recovery codes come and go with TOTP: one notice is enough
    from apps.engagement.notify import notify

    notify([user.id], code, {}, url="/account", dedupe=f"{code}:{authenticator.pk}")


@receiver(authenticator_added)
def mfa_added(sender, request, user, authenticator, **kwargs):
    _security_notice(user, "mfa_enabled", authenticator)


@receiver(authenticator_removed)
def mfa_removed(sender, request, user, authenticator, **kwargs):
    _security_notice(user, "mfa_disabled", authenticator)
