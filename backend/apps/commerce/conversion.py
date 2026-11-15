"""Single source of truth for GBP <-> token conversion.

The authoritative rate is `commerce.TokenRate.current()` — the versioned row with
`effective_to IS NULL`. Every surface that quotes a programme in tokens (catalog detail,
checkout, unlock, console) MUST call through this module. Programme-level token prices
stored on `catalog.Course.full_course_token_price` are treated as legacy overrides only;
new writes go through `course_token_price()` which derives from cash + rate.

Rounding policy
---------------
`ROUND_HALF_UP` to the nearest integer. A fractional token amount (e.g. £0.01 at rate
0.5 = 0.005 tokens) rounds up to 1 token. Favours revenue safety — no free unlocks from
rounding to zero.

Historical rows (`TokenSpend`, `TokenGrant`) are NEVER modified by this module. They
already carry their own snapshot (`tokens_total`, `unit_cost_gbp`).
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal


class NoTokenRate(Exception):
    """Raised when the system has no live TokenRate and the caller needs one."""


def _current_rate(at=None):
    from apps.commerce.models import TokenRate

    rate = TokenRate.current(at=at)
    if rate is None:
        raise NoTokenRate("No live TokenRate configured. Set one in the console.")
    return rate


def tokens_for_gbp_minor(gbp_minor: int, *, at=None, rate=None) -> int:
    """Convert a GBP-minor amount (pennies) to a whole number of tokens.

    `rate` may be a Decimal (tokens per penny) for pure callers; `at` picks a historical
    rate for audit replays. When neither is given, the current live rate is used.
    """
    if gbp_minor < 0:
        raise ValueError("gbp_minor must be >= 0")
    if gbp_minor == 0:
        return 0
    if rate is None:
        rate = _current_rate(at=at).tokens_per_gbp_minor
    tokens = (Decimal(gbp_minor) * Decimal(rate)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(tokens)


def gbp_minor_for_tokens(tokens: int, *, at=None, rate=None) -> int:
    """Inverse: how many pennies does `tokens` tokens represent at the given rate.

    Useful for admin sanity checks and audit UI. Rounds half-up.
    """
    if tokens < 0:
        raise ValueError("tokens must be >= 0")
    if tokens == 0:
        return 0
    if rate is None:
        rate = _current_rate(at=at).tokens_per_gbp_minor
    r = Decimal(rate)
    if r <= 0:
        raise ValueError("rate must be > 0")
    pennies = (Decimal(tokens) / r).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(pennies)


def course_token_price(course, *, at=None) -> int | None:
    """The authoritative token price for a whole course.

    Returns:
        * `0` if the course is free (no cash tier set AND no override).
        * a positive int derived from `course.cash_price_tier.gbp_minor × TokenRate`
          when a cash tier is set and a live rate exists.
        * the stored `course.full_course_token_price` if — and only if — a staff
          override has been recorded there AND no cash tier exists (legacy path).
        * `None` when no cash price is set and no override exists (course cannot be
          unlocked in tokens — caller should raise NoPriceSet).

    Raises:
        NoTokenRate: when a cash tier is set but no live rate is configured.
    """
    tier_id = getattr(course, "cash_price_tier_id", None)
    if tier_id:
        tier = course.cash_price_tier  # already fetched on most read paths
        if tier is None or tier.gbp_minor is None:
            return None
        return tokens_for_gbp_minor(tier.gbp_minor, at=at)
    stored = getattr(course, "full_course_token_price", None)
    if stored is not None:
        return int(stored)
    return None
