"""allauth adapters: how a Google / Microsoft sign-in fills in our user, and the platform
switches for sign-up and email verification."""

from allauth.account.adapter import DefaultAccountAdapter
from allauth.mfa.adapter import DefaultMFAAdapter
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter


class SocialAdapter(DefaultSocialAccountAdapter):
    def populate_user(self, request, sociallogin, data):
        user = super().populate_user(request, sociallogin, data)
        name = (
            data.get("name") or " ".join(p for p in (data.get("first_name"), data.get("last_name")) if p)
        ).strip()
        if name and not getattr(user, "full_name", ""):
            user.full_name = name[:200]
        return user


class AccountAdapter(DefaultAccountAdapter):
    """The console switches (Settings > General / Security) applied to sign-up and sign-in."""

    def is_open_for_signup(self, request):
        from apps.platform.services import get_setting

        return bool(get_setting("access.registration_enabled"))

    def pre_login(self, request, user, **kwargs):
        # "Require email verification" off: an unverified address no longer blocks sign-in
        # (allauth's mandatory check then passes). On (the default): unchanged.
        from apps.platform.services import get_setting

        if not get_setting("security.require_email_verification"):
            from allauth.account.models import EmailAddress

            EmailAddress.objects.filter(user=user, verified=False).update(verified=True)
        return super().pre_login(request, user, **kwargs)

    def format_email_subject(self, subject):
        # sign-in emails carry the platform name from the console (Settings > General)
        from apps.platform.services import get_setting

        return f"[{get_setting('general.platform_name')}] {subject}"


class MFAAdapter(DefaultMFAAdapter):
    def get_totp_issuer(self) -> str:
        # the authenticator app shows the platform name from the console
        from apps.platform.services import get_setting

        return str(get_setting("general.platform_name"))
