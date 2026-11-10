"""Prices in every currency (decision 10).

1. A tier has a GBP base price (e.g. Tier 5 = £44.99).
2. Each day the ECB rates are stored (fx_rates); currencies the ECB does not publish
   get a manual rate from an admin.
3. A tier's price in a currency = GBP x rate, rounded to a natural-looking price
   (12.99, 1,299, ¥2,400, 4.990 KWD). It is re-priced only when FX drifts > 5%,
   so prices do not jitter every day. An admin can lock a price by hand.
4. Checkout always re-prices on the server: the browser never sends an amount.
5. Regional prices (M5): a course (or a whole tier) can have its own price for buyers in
   one country, in that country's currency. The buyer's country comes from the edge
   (CF-IPCountry) or the region of their browser language (en-IN -> IN); it is read once
   per request (apps.py) and applies only when they pay in that currency.
"""

import contextvars
import logging
import math
import re
import xml.etree.ElementTree as ET  # noqa: S405 - only parses the ECB feed over HTTPS, size-capped
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import httpx
from django.conf import settings
from django.db import transaction
from django.db.models import F, OuterRef, Q, Subquery
from django.utils import timezone

from core.errors import ServiceError

from .models import Currency, FxRate, PriceTier, PriceTierAmount, RegionalPrice

log = logging.getLogger(__name__)
BASE = "GBP"
SYMBOLS = {"GBP": "£", "USD": "$", "EUR": "€"}


def format_money(minor: int, code: str = BASE, exponent: int = 2) -> str:
    """For notification text: £44.99, $12.00, 1,299 INR."""
    major = to_major(minor, exponent)
    text = f"{major:,.{exponent}f}"
    return f"{SYMBOLS[code]}{text}" if code in SYMBOLS else f"{text} {code}"


def gbp_money(minor: int) -> str:
    return format_money(minor, BASE, 2)


# ---------------------------------------------------------------- buyer country
BUYER_COUNTRY: contextvars.ContextVar[str] = contextvars.ContextVar("buyer_country", default="")
_LANG_REGION = re.compile(r"^[a-z]{2,3}(?:-[a-z]{4})?-([a-z]{2})(?![a-z])", re.I)


def country_from_headers(headers: dict) -> str:
    """ISO country of the buyer: the CDN's geo header, else the browser language's region."""
    edge = (headers.get("HTTP_CF_IPCOUNTRY") or "").strip().upper()
    if len(edge) == 2 and edge.isalpha() and edge not in ("XX", "T1"):
        return edge
    first = (headers.get("HTTP_ACCEPT_LANGUAGE") or "").split(",")[0].strip()
    m = _LANG_REGION.match(first)
    return m.group(1).upper() if m else ""


def buyer_country() -> str:
    return BUYER_COUNTRY.get()


# ---------------------------------------------------------------- rounding
def natural_minor(amount: Decimal, exponent: int) -> int:
    """A major-unit amount -> a natural price in minor units, never below the input
    by more than one minor unit (so conversions do not quietly lose money)."""
    if amount <= 0:
        return 0
    unit = 10**exponent
    digits = len(str(int(amount)))
    if digits >= 3:  # 1,234.50 -> 1,299 ; 4,567 -> 4,599 ; ¥2,345 -> ¥2,399
        step = 10 ** (digits - 2)
        major = math.ceil(amount / step) * step - 1
        return int(major) * unit
    major = math.ceil(amount)  # 12.30 -> 12.99 ; 4.2 KWD -> 4.990
    if exponent == 0:
        return int(major)
    tail = 1 if exponent <= 2 else 10 ** (exponent - 2)  # KWD keeps a trailing 0 (Stripe rule)
    return int(major) * unit - tail


def to_major(minor: int, exponent: int) -> Decimal:
    return Decimal(minor) / (10**exponent)


def gbp_equivalent(minor: int, exponent: int, rate: Decimal) -> int:
    """An amount in a currency -> pence, for reporting and instructor revenue."""
    if rate <= 0:
        return 0
    return int((to_major(minor, exponent) / rate * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


# ---------------------------------------------------------------- rates
def latest_rate(code: str, on: date | None = None) -> Decimal:
    if code == BASE:
        return Decimal(1)
    on = on or timezone.now().date()
    rate = (
        FxRate.objects.filter(currency_id=code, rate_date__lte=on)
        .order_by("-rate_date")
        .values_list("rate", flat=True)
        .first()
    )
    if rate is None:
        raise ServiceError("no_rate", f"No exchange rate for {code} yet.")
    return rate


def parse_ecb(xml_text: str) -> tuple[date, dict[str, Decimal]]:
    """ECB daily feed: EUR -> X. Returns the day and EUR-based rates."""
    root = ET.fromstring(xml_text)  # noqa: S314 - trusted source, no DTDs/entities in the feed
    day, rates = None, {}
    for node in root.iter():
        if node.get("time"):
            day = date.fromisoformat(node.get("time"))
        if node.get("currency") and node.get("rate"):
            rates[node.get("currency")] = Decimal(node.get("rate"))
    if day is None or "GBP" not in rates:
        raise ValueError("Unexpected ECB feed format")
    return day, rates


def store_ecb_rates(day: date, eur_rates: dict[str, Decimal]) -> int:
    """Re-base EUR rates to GBP (X per 1 GBP) and upsert. Only for currencies we know."""
    eur_per_gbp = eur_rates["GBP"]
    per_gbp = {code: (r / eur_per_gbp) for code, r in eur_rates.items() if code != "GBP"}
    per_gbp["EUR"] = Decimal(1) / eur_per_gbp
    known = set(Currency.objects.filter(code__in=per_gbp).values_list("code", flat=True))
    rows = [
        FxRate(currency_id=c, rate_date=day, rate=per_gbp[c].quantize(Decimal("0.0000000001")), source="ecb")
        for c in known
    ]
    FxRate.objects.bulk_create(
        rows, update_conflicts=True, unique_fields=["currency", "rate_date"], update_fields=["rate", "source"]
    )
    Currency.objects.filter(code__in=known).exclude(rate_source="ecb").update(rate_source="ecb")
    return len(rows)


def fetch_ecb() -> int:
    with httpx.Client(timeout=15, follow_redirects=False) as client:
        resp = client.get(settings.ECB_RATES_URL)
        resp.raise_for_status()
        if len(resp.content) > 200_000:
            raise ValueError("ECB feed unexpectedly large")
    day, rates = parse_ecb(resp.text)
    with transaction.atomic():
        return store_ecb_rates(day, rates)


def set_manual_rate(*, code: str, rate: Decimal, on: date | None = None) -> FxRate:
    """Admin: a rate for a currency the ECB does not publish (e.g. AED, SAR, EGP)."""
    if rate <= 0:
        raise ServiceError("bad_rate", "The rate must be above zero.")
    currency = Currency.objects.get(code=code)
    if currency.rate_source == Currency.RateSource.ECB:
        raise ServiceError("ecb_currency", f"{code} is updated daily from the ECB.")
    fx, _ = FxRate.objects.update_or_create(
        currency_id=code, rate_date=on or timezone.now().date(), defaults={"rate": rate, "source": "manual"}
    )
    return fx


# ---------------------------------------------------------------- tiers
def refresh_tier_amounts(*, drift: float | None = None) -> int:
    """For every active currency with a rate: create missing tier prices, and re-price
    unlocked ones whose FX value drifted beyond the threshold. Returns rows written."""
    drift = settings.FX_DRIFT_REPRICE if drift is None else drift
    latest = FxRate.objects.filter(currency=OuterRef("code")).order_by("-rate_date")
    currencies = list(
        Currency.objects.filter(is_active=True)
        .annotate(rate=Subquery(latest.values("rate")[:1]))
        .values("code", "exponent", "rate")
    )
    tiers = list(PriceTier.objects.filter(is_active=True))
    existing = {(a.tier_id, a.currency_id): a for a in PriceTierAmount.objects.filter(tier__in=tiers)}
    writes = []
    for c in currencies:
        rate = Decimal(1) if c["code"] == BASE else c["rate"]
        if rate is None:
            continue
        for t in tiers:
            target = (
                t.gbp_minor
                if c["code"] == BASE
                else natural_minor(to_major(t.gbp_minor, 2) * rate, c["exponent"])
            )
            row = existing.get((t.id, c["code"]))
            if row is None:
                writes.append(
                    PriceTierAmount(tier=t, currency_id=c["code"], amount_minor=target, fx_rate=rate)
                )
            elif (
                not row.is_locked
                and row.amount_minor
                and abs(target - row.amount_minor) / row.amount_minor > drift
            ):
                row.amount_minor, row.fx_rate = target, rate
                writes.append(row)
    PriceTierAmount.objects.bulk_create(
        writes,
        update_conflicts=True,
        unique_fields=["tier", "currency"],
        update_fields=["amount_minor", "fx_rate", "updated_at"],
    )
    return len(writes)


def reprice_tier(tier: PriceTier) -> int:
    """After a tier's GBP base changes: its unlocked prices in every active currency are
    recalculated from the latest rate (locked ones stay as the admin set them)."""
    latest = FxRate.objects.filter(currency=OuterRef("code")).order_by("-rate_date")
    currencies = (
        Currency.objects.filter(is_active=True)
        .annotate(rate=Subquery(latest.values("rate")[:1]))
        .values("code", "exponent", "rate")
    )
    locked = set(
        PriceTierAmount.objects.filter(tier=tier, is_locked=True).values_list("currency_id", flat=True)
    )
    rows = []
    for c in currencies:
        if c["code"] in locked or (c["code"] != BASE and c["rate"] is None):
            continue
        rate = Decimal(1) if c["code"] == BASE else c["rate"]
        amount = (
            tier.gbp_minor
            if c["code"] == BASE
            else natural_minor(to_major(tier.gbp_minor, 2) * rate, c["exponent"])
        )
        rows.append(PriceTierAmount(tier=tier, currency_id=c["code"], amount_minor=amount, fx_rate=rate))
    PriceTierAmount.objects.bulk_create(
        rows, update_conflicts=True, unique_fields=["tier", "currency"],
        update_fields=["amount_minor", "fx_rate", "updated_at"],
    )  # fmt: skip
    return len(rows)


def set_tier_amount(*, tier: PriceTier, code: str, amount_minor: int, lock: bool = True) -> PriceTierAmount:
    """Admin override for one tier in one currency."""
    row, _ = PriceTierAmount.objects.update_or_create(
        tier=tier, currency_id=code, defaults={"amount_minor": amount_minor, "is_locked": lock}
    )
    return row


# ---------------------------------------------------------------- quotes
def regional_amounts(prices: dict, code: str, country: str) -> dict:
    """{course_id: amount} for the courses (or their tiers) with a price for this country
    in this currency. A course's own price beats its tier's."""
    if not country:
        return {}
    from apps.platform.services import get_setting

    if not get_setting("pricing.regional_enabled"):
        return {}
    tier_ids = {p.tier_id for p in prices.values() if p.tier_id}
    rows = RegionalPrice.objects.filter(country=country, currency_id=code, is_active=True).filter(
        Q(course_id__in=list(prices)) | Q(tier_id__in=tier_ids)
    )
    by_course, by_tier = {}, {}
    for r in rows:
        if r.course_id:
            by_course[r.course_id] = r.amount_minor
        else:
            by_tier[r.tier_id] = r.amount_minor
    out = {}
    for cid, p in prices.items():
        if p.is_free:
            continue
        if cid in by_course:
            out[cid] = by_course[cid]
        elif p.tier_id in by_tier:
            out[cid] = by_tier[p.tier_id]
    return out


_UNSET = object()


def quote(course_ids, code: str, now=None, country=_UNSET) -> dict:
    """{course_id: {"free", "list_minor", "sale_minor"}} for a page of courses.
    At most 4 queries, whatever the number of courses (5 with a regional price lookup).
    `sale_minor` is the best public campaign for the course (no buyer conditions)."""
    from . import promotions
    from .models import CoursePrice, Promotion

    country = buyer_country() if country is _UNSET else (country or "")
    currency = Currency.objects.filter(code=code, is_active=True).values("code", "exponent").first()
    if currency is None:
        raise ServiceError("bad_currency", f"{code} is not offered.")
    prices = {
        p.course_id: p
        for p in CoursePrice.objects.filter(course_id__in=list(course_ids)).annotate(
            category_id=F("course__category_id")
        )
    }
    tier_ids = {p.tier_id for p in prices.values() if p.tier_id}
    amounts = dict(
        PriceTierAmount.objects.filter(tier_id__in=tier_ids, currency_id=code).values_list(
            "tier_id", "amount_minor"
        )
    )
    missing = tier_ids - set(amounts)
    if missing:  # a brand-new currency before the job ran: convert on the fly
        rate = latest_rate(code)
        for t in PriceTier.objects.filter(id__in=missing):
            amounts[t.id] = (
                t.gbp_minor
                if code == BASE
                else natural_minor(to_major(t.gbp_minor, 2) * rate, currency["exponent"])
            )
    regional = regional_amounts(prices, code, country)
    campaigns = [lv for lv in promotions.live([Promotion.Kind.CAMPAIGN], now) if lv.public]
    out = {}
    for cid in course_ids:
        p = prices.get(cid)
        if p is None:
            continue  # unpriced: not for sale
        if p.is_free:
            out[cid] = {"free": True, "list_minor": 0, "sale_minor": None}
            continue
        list_minor = regional.get(cid, amounts[p.tier_id])
        best = next((lv for lv in campaigns if lv.covers_course(cid, p.category_id)), None)
        sale = promotions.discounted(list_minor, best.pct, currency["exponent"]) if best else None
        out[cid] = {"free": False, "list_minor": list_minor, "sale_minor": sale}
        if cid in regional:
            out[cid]["regional"] = True  # only present when it applies (the order records the country)
    return out
