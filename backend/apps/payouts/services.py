"""Instructor earnings and payouts. Every write here runs as a platform job (staff
RLS context): instructors can only read their own ledger.

Ledger rules:
  * one line per instructor per sale, written when the order is paid (signal)
  * a refund adds a negative line; nothing is ever edited or deleted
  * lines become payable after the refund window (available_at)
  * the monthly run bundles everything payable into one payout per instructor,
    if the balance reaches the minimum; staff approve before money moves
"""

import calendar
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from django.db import connection, transaction
from django.db.models import Q, Sum
from django.utils import timezone

from apps.catalog.models import Course, CourseInstructor
from apps.commerce import gateway, pricing
from apps.commerce.models import Order, OrderItem
from core.errors import ServiceError
from core.tenancy import tenant_context

from .models import CommissionRule, Earning, Payout, PayoutAccount, PayoutRequest, RevenueShare

C = RevenueShare.Channel


def _rates() -> dict[str, int]:
    return dict(RevenueShare.objects.values_list("channel", "instructor_bps"))


# ---------------------------------------------------------------- platform fee (basic, set by staff)
def default_fee_bps() -> int:
    """The platform's default cut of a marketplace sale (the marketplace channel's rest)."""
    share = (
        RevenueShare.objects.filter(channel=C.MARKETPLACE).values_list("instructor_bps", flat=True).first()
    )
    return 10000 - (share if share is not None else 10000)


def instructor_fees(user_ids) -> dict:
    """{user_id: platform fee bps} for instructors with their own fee (others use the default)."""
    from apps.identity.models import InstructorProfile

    return dict(
        InstructorProfile.objects.filter(user_id__in=user_ids, platform_fee_bps__isnull=False).values_list(
            "user_id", "platform_fee_bps"
        )
    )


def set_default_fee(*, fee_bps: int) -> None:
    """Changes the default for instructors approved FROM NOW ON (and anyone without a fee of
    their own). Instructors already approved keep the fee they were given."""
    if not 0 <= fee_bps <= 10000:
        raise ServiceError("bad_fee", "The fee must be between 0% and 100%.")
    RevenueShare.objects.update_or_create(channel=C.MARKETPLACE, defaults={"instructor_bps": 10000 - fee_bps})


def set_instructor_fee(*, user_id, fee_bps: int | None) -> None:
    """One instructor's own fee; None = follow the platform default."""
    from apps.identity.models import InstructorProfile

    if fee_bps is not None and not 0 <= fee_bps <= 10000:
        raise ServiceError("bad_fee", "The fee must be between 0% and 100%.")
    if not InstructorProfile.objects.filter(user_id=user_id).update(
        platform_fee_bps=fee_bps, updated_at=timezone.now()
    ):
        raise ServiceError("not_found", "Instructor not found.", status=404)


def _weights(course_ids) -> dict:
    """{course_id: [(user_id, weight 0..1)]}; equal split when no shares are set."""
    links: dict = {}
    for cid, uid, bps in CourseInstructor.objects.filter(course_id__in=course_ids).values_list(
        "course_id", "user_id", "revenue_share_bps"
    ):
        links.setdefault(cid, []).append((uid, bps))
    out = {}
    for cid, rows in links.items():
        total = sum(b for _, b in rows)
        out[cid] = [(u, Decimal(b) / total if total else Decimal(1) / len(rows)) for u, b in rows]
    return out


# ---------------------------------------------------------------- ledger
def hold_days() -> int:
    """Days before a sale can be paid out (client question 2). Never shorter than the refund
    window (console setting payments.refund_window_days), so a refund can't follow a payout."""
    from apps.commerce.services import refund_window_days
    from apps.platform.services import get_setting

    return max(int(get_setting("payouts.hold_days")), refund_window_days())


def minimum_gbp_minor() -> int:
    from apps.platform.services import get_setting

    return int(get_setting("payouts.minimum_gbp_minor"))


# ---------------------------------------------------------------- commission rules
SCOPE_ORDER = {
    CommissionRule.Scope.COURSE: 0,
    CommissionRule.Scope.INSTRUCTOR: 1,
    CommissionRule.Scope.CATEGORY: 2,
    CommissionRule.Scope.PRICE_BAND: 3,
}


def active_rules(at) -> list[CommissionRule]:
    """Rules live at `at` (the sale time). A small staff-only table: read it whole."""
    return list(
        CommissionRule.objects.filter(is_active=True)
        .filter(Q(starts_at__isnull=True) | Q(starts_at__lte=at))
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=at))
    )


def _rule_matches(rule: CommissionRule, *, course_id, category_id, user_id, price_gbp_minor: int) -> bool:
    if rule.scope == CommissionRule.Scope.COURSE:
        return rule.target_id == course_id
    if rule.scope == CommissionRule.Scope.INSTRUCTOR:
        return rule.target_id == user_id
    if rule.scope == CommissionRule.Scope.CATEGORY:
        return category_id is not None and rule.target_id == category_id
    low, high = rule.band_min_gbp_minor or 0, rule.band_max_gbp_minor
    return price_gbp_minor >= low and (high is None or price_gbp_minor < high)


def match_rule(rules, *, course_id, category_id, user_id, price_gbp_minor: int) -> CommissionRule | None:
    """The most specific rule wins: course > instructor > category > price band. Inside
    one scope the higher priority wins, then the newest rule."""
    hits = [
        r
        for r in rules
        if _rule_matches(
            r, course_id=course_id, category_id=category_id, user_id=user_id, price_gbp_minor=price_gbp_minor
        )
    ]
    hits.sort(key=lambda r: (SCOPE_ORDER[r.scope], -r.priority, -r.created_at.timestamp()))
    return hits[0] if hits else None


def marketplace_rate(*, rule: CommissionRule | None, user_id, fees: dict, rates: dict) -> tuple[int, str]:
    """(instructor bps, where it came from) for a marketplace sale: a matching rule, else
    the instructor's own rate (set when approved), else the platform default."""
    if rule is not None:
        return rule.instructor_bps, "rule"
    if user_id in fees:
        return 10000 - fees[user_id], "instructor"
    return rates.get(C.MARKETPLACE, 10000), "default"


def preview_rate(*, course_id, at=None) -> dict:
    """What a sale of this course at its list price would earn its first instructor now."""
    from apps.commerce.models import CoursePrice

    at = at or timezone.now()
    course = Course.objects.get(pk=course_id)
    cp = CoursePrice.objects.select_related("tier").filter(course=course).first()
    price = cp.tier.gbp_minor if cp and cp.tier else 0
    weights = _weights([course.id]).get(course.id, [])
    user_id = weights[0][0] if weights else None
    fees = instructor_fees([user_id]) if user_id else {}
    rule = match_rule(active_rules(at), course_id=course.id, category_id=course.category_id, user_id=user_id,
                      price_gbp_minor=price)  # fmt: skip
    bps, source = marketplace_rate(rule=rule, user_id=user_id, fees=fees, rates=_rates())
    return {
        "instructor_bps": bps,
        "source": source,
        "rule": rule,
        "instructor_id": user_id,
        "price_gbp_minor": price,
    }


def _undiscounted_gbp(item: OrderItem) -> int:
    """The item's GBP value before any discount (price bands, the discount setting)."""
    if not item.discount_minor or not item.gross_minor:
        return item.gbp_gross_minor
    return int(Decimal(item.gbp_gross_minor) * (item.gross_minor + item.discount_minor) / item.gross_minor)


def record_sale(order_id) -> int:
    """Called after an order is paid. Idempotent (unique per instructor and item).

    Marketplace sales use the matching commission rule at sale time, else the
    instructor's own rate, else the default. The rate is stored on the line, so later
    changes never rewrite past earnings. With payments.discount_reduces_commission off,
    the platform absorbs its discounts (the line is never more than the customer paid)."""
    from apps.platform.services import get_setting

    with tenant_context(staff=True):
        order = Order.objects.select_related("coupon").get(pk=order_id)
        items = list(
            OrderItem.objects.filter(
                order=order, gbp_gross_minor__gt=0, course__ownership=Course.Ownership.INSTRUCTOR
            ).select_related("course")
        )
        if not items:
            return 0
        rates, weights = _rates(), _weights([i.course_id for i in items])
        fees = instructor_fees({u for ws in weights.values() for u, _ in ws})
        rules = active_rules(order.paid_at)
        discount_cuts_share = get_setting("payments.discount_reduces_commission")
        available = order.paid_at + timedelta(days=hold_days())
        lines = []
        for item in items:
            instructors = weights.get(item.course_id, [])
            own_coupon = order.coupon and any(u == order.coupon.created_by_id for u, _ in instructors)
            channel = C.INSTRUCTOR_COUPON if own_coupon else C.MARKETPLACE
            list_gbp = _undiscounted_gbp(item)
            for user_id, w in instructors:
                gross = int(item.gbp_gross_minor * w)
                note = ""
                if channel == C.MARKETPLACE:
                    rule = match_rule(rules, course_id=item.course_id, category_id=item.course.category_id,
                                      user_id=user_id, price_gbp_minor=list_gbp)  # fmt: skip
                    bps, _ = marketplace_rate(rule=rule, user_id=user_id, fees=fees, rates=rates)
                    if rule is not None:
                        note = f"Commission rule: {rule.name or rule.get_scope_display()}"[:300]
                    base = gross if discount_cuts_share else int(list_gbp * w)
                    amount = min(base * bps // 10000, gross)
                else:  # the instructor's own coupon: their discount, their share
                    bps = rates[channel]
                    amount = gross * bps // 10000
                lines.append(
                    Earning(
                        user_id=user_id,
                        kind=Earning.Kind.SALE,
                        course_id=item.course_id,
                        order_item=item,
                        channel=channel,
                        gross_gbp_minor=gross,
                        share_bps=bps,
                        amount_gbp_minor=amount,
                        earned_at=order.paid_at,
                        available_at=available,
                        note=note,
                    )  # fmt: skip
                )
        return len(Earning.objects.bulk_create(lines, ignore_conflicts=True))


def record_refund(item_id) -> int:
    """A negative line for every sale line of the refunded item. If the sale was not
    paid out yet, both land in the same payout and cancel; if it was, the next payout
    is reduced."""
    now = timezone.now()
    with tenant_context(staff=True):
        sales = list(Earning.objects.filter(order_item_id=item_id, kind=Earning.Kind.SALE))
        lines = [
            Earning(
                user_id=s.user_id,
                kind=Earning.Kind.REFUND,
                course_id=s.course_id,
                order_item_id=item_id,
                channel=s.channel,
                gross_gbp_minor=-s.gross_gbp_minor,
                share_bps=s.share_bps,
                amount_gbp_minor=-s.amount_gbp_minor,
                earned_at=now,
                available_at=s.available_at if s.payout_id is None else now,
            )  # fmt: skip
            for s in sales
        ]
        return len(Earning.objects.bulk_create(lines, ignore_conflicts=True))


def _month_bounds(month: date) -> tuple[datetime, datetime]:
    start = datetime(month.year, month.month, 1, tzinfo=UTC)
    days = calendar.monthrange(month.year, month.month)[1]
    return start, start + timedelta(days=days)


def settle_subscription_pool(month: date) -> int:
    """Personal-plan revenue of the month x pool share, split by seconds watched on
    instructor courses through plan enrolments. Two aggregate queries, any volume."""
    start, end = _month_bounds(month)
    with tenant_context(staff=True), connection.cursor() as cur:
        if Earning.objects.filter(kind=Earning.Kind.SUBSCRIPTION, period=month.replace(day=1)).exists():
            return 0  # already settled (the unique constraint also guards a parallel run)
        cur.execute(
            """
            SELECT i.currency, i.issued_at::date, sum(i.amount_minor)
              FROM commerce.invoices i
              JOIN commerce.subscriptions s ON s.id = i.subscription_id
              JOIN commerce.plans p ON p.id = s.plan_id AND p.audience = 'personal'
             WHERE i.issued_at >= %s AND i.issued_at < %s AND i.status = 'paid'
             GROUP BY 1, 2
            """,
            [start, end],
        )
        revenue_rows = cur.fetchall()
        cur.execute("SELECT code, exponent FROM commerce.currencies")
        exps = dict(cur.fetchall())
        revenue = sum(
            pricing.gbp_equivalent(amount, exps[code], pricing.latest_rate(code, day))
            for code, day, amount in revenue_rows
        )
        cur.execute(
            """
            SELECT pe.course_id, sum(pe.seconds)
              FROM learning.progress_events pe
              JOIN learning.enrollments e ON e.id = pe.enrollment_id AND e.source = 'subscription'
              JOIN catalog.courses c ON c.id = pe.course_id AND c.ownership = 'instructor'
             WHERE pe.created_at >= %s AND pe.created_at < %s
             GROUP BY 1
            """,
            [start, end],
        )
        seconds = dict(cur.fetchall())
        total = sum(seconds.values())
        if not revenue or not total:
            return 0
        bps = _rates()[C.SUBSCRIPTION_POOL]
        weights = _weights(list(seconds))
        lines = []
        for course_id, secs in seconds.items():
            course_revenue = Decimal(revenue) * secs / total
            for user_id, w in weights.get(course_id, []):
                gross = int(course_revenue * w)
                lines.append(
                    Earning(
                        user_id=user_id,
                        kind=Earning.Kind.SUBSCRIPTION,
                        course_id=course_id,
                        period=month.replace(day=1),
                        channel=C.SUBSCRIPTION_POOL,
                        gross_gbp_minor=gross,
                        share_bps=bps,
                        amount_gbp_minor=gross * bps // 10000,
                        earned_at=end,
                        available_at=end,
                        note=f"{secs // 60} minutes watched",
                    )  # fmt: skip
                )
        return len(Earning.objects.bulk_create(lines, ignore_conflicts=True))


# ---------------------------------------------------------------- payouts
def create_payouts(*, period_end: date, now=None) -> list:
    """One payout per verified instructor whose payable balance reaches the minimum.
    A single statement bundles the lines, so a line can never be in two payouts."""
    now = now or timezone.now()
    with tenant_context(staff=True), connection.cursor() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(hashtextextended('payouts:run', 0))")
        cur.execute(
            """
            WITH due AS (
                SELECT e.user_id, sum(e.amount_gbp_minor) AS total
                  FROM payouts.earnings e
                 WHERE e.payout_id IS NULL AND e.available_at <= %(now)s
                   AND NOT EXISTS (SELECT 1 FROM payouts.payout_requests r
                                    WHERE r.user_id = e.user_id AND r.status IN ('pending', 'disputed'))
                 GROUP BY e.user_id
                HAVING sum(e.amount_gbp_minor) >= %(min)s
            ), made AS (
                INSERT INTO payouts.payouts
                       (id, created_at, updated_at, user_id, period_end, amount_gbp_minor, status, method,
                        provider_ref, failure_reason)
                SELECT uuidv7(), %(now)s, %(now)s, d.user_id, %(period)s, d.total, 'pending', a.method, '', ''
                  FROM due d
                  JOIN payouts.payout_accounts a ON a.user_id = d.user_id AND a.verified_at IS NOT NULL
                ON CONFLICT (user_id, period_end) DO NOTHING
                RETURNING id, user_id
            )
            UPDATE payouts.earnings e SET payout_id = made.id, updated_at = %(now)s
              FROM made
             WHERE e.user_id = made.user_id AND e.payout_id IS NULL AND e.available_at <= %(now)s
            RETURNING made.id
            """,
            {"now": now, "min": minimum_gbp_minor(), "period": period_end},
        )
        return list({r[0] for r in cur.fetchall()})


@transaction.atomic
def approve_payout(*, payout: Payout, by, provider_ref: str = "") -> Payout:
    """Staff only (console). Stripe Connect transfers automatically; PayPal needs the
    reference of the payment made in PayPal."""
    payout = Payout.objects.select_for_update().get(pk=payout.pk)
    if payout.status != Payout.Status.PENDING:
        raise ServiceError("not_pending", f"Payout is {payout.status}.")
    total = payout.earnings.aggregate(t=Sum("amount_gbp_minor"))["t"] or 0
    if total != payout.amount_gbp_minor:  # defence in depth: the bundle was tampered with
        raise ServiceError("mismatch", "Payout total does not match its earnings.")
    account = PayoutAccount.objects.get(user_id=payout.user_id, verified_at__isnull=False)
    if payout.method == PayoutAccount.Method.STRIPE:
        provider_ref = gateway.transfer(
            destination=account.stripe_account_id, amount_gbp_minor=payout.amount_gbp_minor,
            idempotency_key=f"payout-{payout.id}", description=f"LearnHub payout {payout.period_end:%B %Y}",
        )  # fmt: skip
    elif not provider_ref.strip():
        raise ServiceError("reference_required", "Enter the payment reference.")
    payout.status, payout.provider_ref, payout.approved_by, payout.paid_at = (
        "paid",
        provider_ref,
        by,
        timezone.now(),
    )
    payout.save(update_fields=["status", "provider_ref", "approved_by", "paid_at", "updated_at"])
    return payout


@transaction.atomic
def fail_payout(*, payout: Payout, reason: str) -> None:
    """Release the lines so they roll into next month's payout."""
    Payout.objects.filter(pk=payout.pk, status=Payout.Status.PENDING).update(
        status=Payout.Status.FAILED, failure_reason=reason[:300], updated_at=timezone.now()
    )
    Earning.objects.filter(payout=payout).update(payout=None, updated_at=timezone.now())


def set_payout_account(
    *, user, method: str, stripe_account_id: str = "", paypal_email: str = "", country: str = ""
):
    """The instructor's own details. Any change clears verification until staff re-check."""
    if method == PayoutAccount.Method.PAYPAL and not paypal_email:
        raise ServiceError("email_required", "Enter your PayPal email.")
    if method == PayoutAccount.Method.STRIPE and not stripe_account_id.startswith("acct_"):
        raise ServiceError("bad_account", "Connect your Stripe account first.")
    with tenant_context(user_id=user.id, staff=True):  # narrow, validated write on the user's own row
        account, _ = PayoutAccount.objects.update_or_create(
            user=user,
            defaults={
                "method": method, "stripe_account_id": stripe_account_id, "paypal_email": paypal_email,
                "country": country.upper()[:2], "verified_at": None,
            },
        )  # fmt: skip
    return account


def verify_account(*, account: PayoutAccount) -> None:
    PayoutAccount.objects.filter(pk=account.pk).update(verified_at=timezone.now(), updated_at=timezone.now())


def monthly_run(today: date | None = None) -> dict:
    """1st of the month: settle last month's subscription pool, then create payouts."""
    today = today or timezone.now().date()
    last_month_end = today.replace(day=1) - timedelta(days=1)
    pool = settle_subscription_pool(last_month_end.replace(day=1))
    made = create_payouts(period_end=last_month_end)
    return {"subscription_lines": pool, "payouts": len(made)}


def is_payout_day(day: date) -> bool:
    from apps.platform.services import get_setting

    if get_setting("payouts.schedule") == "weekly":
        return day.weekday() == 0  # Mondays
    return day.day == int(get_setting("payouts.day_of_month"))


def next_payout_date(today: date | None = None) -> date:
    """The next scheduled run (today counts if it has not happened yet)."""
    today = today or timezone.now().date()
    day = today
    for _ in range(62):
        if is_payout_day(day):
            return day
        day += timedelta(days=1)
    return day


def scheduled_run(today: date | None = None) -> dict:
    """Daily job. On the 1st: settle last month's subscription pool. On a payout day
    (console > Payouts > Schedule): bundle every available balance into payouts."""
    from apps.engagement.notify import notify_staff

    today = today or timezone.now().date()
    out = {"subscription_lines": 0, "payouts": 0}
    if today.day == 1:
        out["subscription_lines"] = settle_subscription_pool((today - timedelta(days=1)).replace(day=1))
    if is_payout_day(today):
        made = create_payouts(period_end=today - timedelta(days=1))
        out["payouts"] = len(made)
        if made:
            notify_staff("staff_payout_due", {"count": str(len(made)), "date": today.strftime("%d %b %Y")},
                         url="/console/payouts?tab=history", dedupe=f"payouts-due:{today}")  # fmt: skip
    return out


# ---------------------------------------------------------------- payout methods (instructor)
METHOD_LABEL = dict(PayoutAccount.Method.choices)


def configured_methods(account: PayoutAccount | None) -> list[dict]:
    """Every method the account holds details for, masked for display."""
    if account is None:
        return []
    out = []
    if account.stripe_account_id:
        out.append({"method": "stripe", "detail": "Stripe account connected"})
    if account.paypal_email:
        out.append({"method": "paypal", "detail": mask_email(account.paypal_email)})
    if account.wise_email:
        out.append({"method": "wise", "detail": mask_email(account.wise_email)})
    if account.bank_account_last4:
        name = account.bank_account_name or "Bank account"
        out.append({"method": "bank", "detail": f"{name} (•••• {account.bank_account_last4})"})
    for m in out:
        m["label"] = METHOD_LABEL[m["method"]]
        m["is_default"] = m["method"] == account.method
    return out


def mask_email(email: str) -> str:
    at = email.find("@")
    return email[:2] + "***" + email[at:] if at > 0 else ""


def save_method(
    *,
    user,
    method: str,
    stripe_account_id: str = "",
    paypal_email: str = "",
    wise_email: str = "",
    bank_account_name: str = "",
    bank_sort_code_last2: str = "",
    bank_account_last4: str = "",
    country: str = "",
    make_default: bool = False,
) -> PayoutAccount:
    """Add or change ONE method; the others stay. Bank details are a masked hint only
    (the transfer itself happens outside the app). Any change needs a new staff check."""
    if method not in PayoutAccount.Method.values:
        raise ServiceError("bad_method", "Choose Stripe, PayPal, Wise or bank transfer.")
    fields: dict = {}
    if method == PayoutAccount.Method.STRIPE:
        if not stripe_account_id.startswith("acct_"):
            raise ServiceError("bad_account", "Enter your Stripe account ID (it starts with acct_).")
        fields["stripe_account_id"] = stripe_account_id[:64]
    elif method == PayoutAccount.Method.PAYPAL:
        if "@" not in paypal_email:
            raise ServiceError("email_required", "Enter your PayPal email.")
        fields["paypal_email"] = paypal_email.strip().lower()
    elif method == PayoutAccount.Method.WISE:
        if "@" not in wise_email:
            raise ServiceError("email_required", "Enter the email of your Wise account.")
        fields["wise_email"] = wise_email.strip().lower()
    else:
        if not (bank_account_last4.isdigit() and len(bank_account_last4) == 4):
            raise ServiceError("bad_bank", "Enter the last 4 digits of the account number.")
        if bank_sort_code_last2 and not (bank_sort_code_last2.isdigit() and len(bank_sort_code_last2) == 2):
            raise ServiceError("bad_bank", "Enter the last 2 digits of the sort code.")
        if len(bank_account_name.strip()) < 2:
            raise ServiceError("bad_bank", "Enter the name on the account.")
        fields.update(bank_account_name=bank_account_name.strip()[:120], bank_sort_code_last2=bank_sort_code_last2,
                      bank_account_last4=bank_account_last4)  # fmt: skip
    if country:
        fields["country"] = country.upper()[:2]
    with tenant_context(user_id=user.id, staff=True):  # narrow, validated write on the user's own row
        account = PayoutAccount.objects.filter(user=user).first()
        if account is None:
            account = PayoutAccount.objects.create(user=user, method=method, **fields)
            return account
        for k, v in fields.items():
            setattr(account, k, v)
        if make_default:
            account.method = method
        account.verified_at = None
        account.save()
        return account


def set_default_method(*, user, method: str) -> PayoutAccount:
    with tenant_context(user_id=user.id, staff=True):
        account = PayoutAccount.objects.filter(user=user).first()
        if account is None or method not in {m["method"] for m in configured_methods(account)}:
            raise ServiceError("no_method", "Add that payout method first.")
        PayoutAccount.objects.filter(pk=account.pk).update(method=method, updated_at=timezone.now())
        account.method = method
        return account


def remove_method(*, user, method: str) -> PayoutAccount:
    with tenant_context(user_id=user.id, staff=True):
        account = PayoutAccount.objects.filter(user=user).first()
        if account is None:
            raise ServiceError("no_method", "There is nothing to remove.", status=404)
        if account.method == method:
            raise ServiceError("is_default", "Choose another default method before removing this one.")
        blank = {"stripe": {"stripe_account_id": ""}, "paypal": {"paypal_email": ""}, "wise": {"wise_email": ""},
                 "bank": {"bank_account_name": "", "bank_sort_code_last2": "", "bank_account_last4": ""}}  # fmt: skip
        PayoutAccount.objects.filter(pk=account.pk).update(**blank.get(method, {}), updated_at=timezone.now())
        account.refresh_from_db()
        return account


def verify_and_notify(*, account: PayoutAccount) -> None:
    from apps.engagement.notify import notify

    verify_account(account=account)
    notify([account.user_id], "payout_account_verified", {"method": METHOD_LABEL.get(account.method, "")},
           url="/studio/payouts", dedupe=f"payout-account-verified:{account.user_id}:{timezone.now():%Y%m%d%H%M}")  # fmt: skip


# ---------------------------------------------------------------- payout requests
OPEN = (PayoutRequest.Status.PENDING, PayoutRequest.Status.APPROVED, PayoutRequest.Status.DISPUTED)


def reference(req: PayoutRequest) -> str:
    return f"PAY-{req.id.hex[-6:].upper()}"


def request_status(*, user) -> dict:
    """What the instructor may request now, and why not."""
    from apps.identity.models import InstructorProfile
    from apps.platform.services import get_setting

    from . import selectors

    bal = selectors.balance(user_id=user.id)
    minimum = minimum_gbp_minor()
    open_req = PayoutRequest.objects.filter(user=user, status__in=OPEN).order_by("-created_at").first()
    account = PayoutAccount.objects.filter(user=user).first()
    why = ""
    if not get_setting("payouts.requests_enabled"):
        why = "Payout requests are switched off at the moment. Payouts go out on the schedule."
    elif not InstructorProfile.objects.filter(user=user, status=InstructorProfile.Status.APPROVED).exists():
        why = "Only active instructors can request a payout."
    elif open_req is not None:
        why = "You already have a payout request in progress."
    elif not configured_methods(account):
        why = "Add a payout method first."
    elif bal["available"] < max(minimum, 1):
        why = "Your available balance is below the minimum payout."
    return {"balance": bal, "minimum_gbp_minor": minimum, "open_request": open_req, "can_request": not why,
            "reason": why}  # fmt: skip


@transaction.atomic
def create_request(*, user, amount_gbp_minor: int, method: str, note: str = "") -> PayoutRequest:
    from apps.engagement.notify import notify_staff

    with tenant_context(user_id=user.id, staff=True):
        # one request at a time: lock the user's rows so two clicks cannot both pass
        cur_lock = f"payout-request:{user.id}"
        with connection.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [cur_lock])
        state = request_status(user=user)
        if not state["can_request"]:
            raise ServiceError("cannot_request", state["reason"])
        if amount_gbp_minor < state["minimum_gbp_minor"]:
            raise ServiceError(
                "below_minimum", f"The minimum payout is {pricing.gbp_money(state['minimum_gbp_minor'])}."
            )
        if amount_gbp_minor > state["balance"]["available"]:
            raise ServiceError("above_balance", "You can request up to your available balance.")
        account = PayoutAccount.objects.get(user=user)
        if method not in {m["method"] for m in configured_methods(account)}:
            raise ServiceError("no_method", "Choose one of your payout methods.")
        req = PayoutRequest.objects.create(user=user, amount_gbp_minor=amount_gbp_minor, method=method,
                                           note=note.strip()[:300])  # fmt: skip
    name = user.full_name or user.email
    transaction.on_commit(lambda: notify_staff(
        "staff_payout_request", {"name": name, "amount": pricing.gbp_money(amount_gbp_minor)},
        url=f"/console/payouts?tab=requests&request={req.id}", dedupe=f"payout-request:{req.id}"))  # fmt: skip
    return req


def _notify(req: PayoutRequest, code: str, **extra) -> None:
    from apps.engagement.notify import notify

    ctx = {"amount": pricing.gbp_money(req.amount_gbp_minor), **extra}
    transaction.on_commit(lambda: notify([req.user_id], code, ctx, url="/studio/payouts",
                                         dedupe=f"{code}:{req.id}:{int(req.updated_at.timestamp())}"))  # fmt: skip


def _bundle(req: PayoutRequest, now) -> Payout:
    """Reserve exactly the requested amount: every available line goes into a payout; if
    they add up to more, a pair of adjustment lines carries the rest to the next payout
    (append-only, the ledger always balances)."""
    with connection.cursor() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(hashtextextended('payouts:run', 0))")
    lines = list(
        Earning.objects.select_for_update()
        .filter(user_id=req.user_id, payout__isnull=True, available_at__lte=now)
        .order_by("available_at", "id")
    )
    total = sum(e.amount_gbp_minor for e in lines)
    if total < req.amount_gbp_minor:
        raise ServiceError(
            "balance_changed", "The instructor's available balance is now lower than the request."
        )
    period = now.date()
    if Payout.objects.filter(user_id=req.user_id, period_end=period).exists():
        raise ServiceError(
            "payout_today", "This instructor already has a payout dated today. Try again tomorrow."
        )
    payout = Payout.objects.create(user_id=req.user_id, period_end=period, amount_gbp_minor=req.amount_gbp_minor,
                                   method=req.method)  # fmt: skip
    Earning.objects.filter(pk__in=[e.pk for e in lines]).update(payout=payout, updated_at=now)
    rest = total - req.amount_gbp_minor
    if rest:
        course_id, note = lines[-1].course_id, f"Carried over from payout request {reference(req)}"
        common = {"user_id": req.user_id, "kind": Earning.Kind.ADJUSTMENT, "course_id": course_id,
                  "channel": C.MARKETPLACE, "gross_gbp_minor": 0, "share_bps": 0, "earned_at": now,
                  "available_at": now, "note": note}  # fmt: skip
        Earning.objects.create(**common, amount_gbp_minor=-rest, payout=payout)
        Earning.objects.create(**common, amount_gbp_minor=rest)
    return payout


def _release(payout: Payout, status: str, reason: str) -> None:
    """Free the lines of an unpaid payout so they go out with the next one."""
    Payout.objects.filter(pk=payout.pk).exclude(status=Payout.Status.PAID).update(
        status=status, failure_reason=reason[:300], updated_at=timezone.now()
    )
    Earning.objects.filter(payout=payout).update(payout=None, updated_at=timezone.now())


def _locked(req: PayoutRequest, *allowed) -> PayoutRequest:
    req = PayoutRequest.objects.select_for_update().get(pk=req.pk)
    if req.status not in allowed:
        raise ServiceError("bad_status", f"This request is {req.get_status_display().lower()}.")
    return req


def _paid(req: PayoutRequest, payout: Payout, by) -> None:
    now = timezone.now()
    req.status, req.provider_ref, req.paid_at = (
        PayoutRequest.Status.PAID,
        payout.provider_ref,
        payout.paid_at or now,
    )
    req.decided_by, req.decided_at = req.decided_by or by, req.decided_at or now
    req.save()
    _notify(req, "payout_paid")


@transaction.atomic
def approve_request(*, req: PayoutRequest, by) -> PayoutRequest:
    """Stripe Connect pays at once; PayPal, Wise and bank are paid by hand, then marked paid."""
    with tenant_context(user_id=by.id, staff=True):
        req = _locked(req, PayoutRequest.Status.PENDING, PayoutRequest.Status.DISPUTED)
        if not PayoutAccount.objects.filter(user_id=req.user_id, verified_at__isnull=False).exists():
            raise ServiceError("not_verified", "Verify the instructor's payout details first.")
        now = timezone.now()
        if req.payout_id is None:
            req.payout = _bundle(req, now)
        else:  # a disputed request goes ahead
            Payout.objects.filter(pk=req.payout_id).update(status=Payout.Status.PENDING, failure_reason="",
                                                           updated_at=now)  # fmt: skip
        req.status, req.decided_by, req.decided_at, req.reason = PayoutRequest.Status.APPROVED, by, now, ""
        req.save()
        if req.method == PayoutAccount.Method.STRIPE:
            payout = approve_payout(payout=Payout.objects.get(pk=req.payout_id), by=by)
            _paid(req, payout, by)
        else:
            _notify(req, "payout_request_approved")
        return req


@transaction.atomic
def mark_request_paid(*, req: PayoutRequest, by, provider_ref: str) -> PayoutRequest:
    if not provider_ref.strip():
        raise ServiceError("reference_required", "Enter the payment reference.")
    with tenant_context(user_id=by.id, staff=True):
        req = _locked(req, PayoutRequest.Status.APPROVED)
        payout = approve_payout(
            payout=Payout.objects.get(pk=req.payout_id), by=by, provider_ref=provider_ref.strip()
        )
        _paid(req, payout, by)
        return req


@transaction.atomic
def reject_request(*, req: PayoutRequest, by, reason: str) -> PayoutRequest:
    with tenant_context(user_id=by.id, staff=True):
        req = _locked(req, *OPEN)
        if req.payout_id:
            _release(Payout.objects.get(pk=req.payout_id), Payout.Status.FAILED, reason)
        req.status, req.reason, req.decided_by, req.decided_at = (
            PayoutRequest.Status.REJECTED, reason[:300], by, timezone.now())  # fmt: skip
        req.save()
        _notify(req, "payout_request_rejected", reason=req.reason)
        return req


@transaction.atomic
def dispute_request(*, req: PayoutRequest, by, reason: str) -> PayoutRequest:
    """On hold while staff check something; the money stays reserved."""
    with tenant_context(user_id=by.id, staff=True):
        req = _locked(req, PayoutRequest.Status.PENDING, PayoutRequest.Status.APPROVED)
        if req.payout_id:
            Payout.objects.filter(pk=req.payout_id).update(status=Payout.Status.DISPUTED, failure_reason=reason[:300],
                                                           updated_at=timezone.now())  # fmt: skip
        req.status, req.reason, req.decided_by, req.decided_at = (
            PayoutRequest.Status.DISPUTED, reason[:300], by, timezone.now())  # fmt: skip
        req.save()
        _notify(req, "payout_request_disputed", reason=req.reason)
        return req


@transaction.atomic
def fail_request(*, req: PayoutRequest, by, reason: str) -> PayoutRequest:
    """The manual transfer bounced: the money goes back to the balance."""
    with tenant_context(user_id=by.id, staff=True):
        req = _locked(req, PayoutRequest.Status.APPROVED)
        _release(Payout.objects.get(pk=req.payout_id), Payout.Status.FAILED, reason)
        req.status, req.reason, req.decided_by, req.decided_at = (
            PayoutRequest.Status.FAILED, reason[:300], by, timezone.now())  # fmt: skip
        req.save()
        _notify(req, "payout_request_rejected", reason=req.reason)
        return req
