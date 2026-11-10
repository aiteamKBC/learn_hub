"""Password rules from the console (Settings > Security > minimum password length)."""

from django.core.exceptions import ValidationError


class PlatformMinimumLengthValidator:
    """Like Django's MinimumLengthValidator, with the length read from the platform
    setting security.password_min_length (default 8, the same as before)."""

    def _min(self) -> int:
        from apps.platform.services import get_setting

        return int(get_setting("security.password_min_length") or 8)

    def validate(self, password, user=None):
        n = self._min()
        if len(password or "") < n:
            raise ValidationError(
                f"This password is too short. It must contain at least {n} characters.",
                code="password_too_short",
                params={"min_length": n},
            )

    def get_help_text(self):
        return f"Your password must contain at least {self._min()} characters."
