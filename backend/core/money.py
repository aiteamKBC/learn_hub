"""Which currency to show prices in, for this request."""

from apps.commerce.models import Currency

BASE = "GBP"


def request_currency(request, wanted: str | None = None) -> dict:
    """?currency=  ->  the user's preference  ->  Settings > default currency  ->  GBP.
    Only active currencies are used."""
    from apps.platform.services import get_setting

    user = getattr(request, "user", None)
    candidates = [
        wanted,
        getattr(user, "preferred_currency", None) if user and user.is_authenticated else None,
        get_setting("general.default_currency"),
        BASE,
    ]
    for code in candidates:
        if not code:
            continue
        row = (
            Currency.objects.filter(code=code.upper()[:3], is_active=True).values("code", "exponent").first()
        )
        if row:
            return row
    return {"code": BASE, "exponent": 2}
