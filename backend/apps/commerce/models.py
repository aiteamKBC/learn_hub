"""Commerce: money in (decisions 9 and 10).

Postgres schema: commerce. Money is always an integer in the currency's MINOR unit
(pence, cents; yen have none, dinars have three: Currency.exponent). Never floats.

    GLOBAL (no RLS, written only by staff endpoints and jobs)
        currencies, fx_rates            every ISO currency; ECB rates daily, manual for the rest
        price_tiers, price_tier_amounts Udemy-style tiers: a GBP base and a per-currency
                                        amount (auto from FX with natural rounding, or locked by admin)
        course_prices                   a course is free or uses a tier
        promotions, coupons             site-wide sales; instructor or staff coupon codes
        plans, plan_prices              personal and team subscriptions
        addons, addon_prices            e.g. content protection (DRM library)
    PERSONAL (core.rls.personal)        cart_items, wishlist_items
    MIXED (core.rls.mixed)              orders, order_items, payments, refunds, coupon_redemptions,
                                        subscriptions, addon_subscriptions, invoices
                                        (org_id set = bought by a company)
    STAFF ONLY (core.rls.staff_only)    stripe_events (raw webhooks, idempotency)

Enrolment happens only after Stripe's signed webhook says the money arrived.
"""

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from core.db import table
from core.models import BaseModel, MixedTenantModel

SCHEMA = "commerce"
User = settings.AUTH_USER_MODEL


def currency_fk(**kw):
    return models.ForeignKey(
        "commerce.Currency",
        to_field="code",
        db_column=kw.pop("db_column", "currency"),
        on_delete=models.PROTECT,
        related_name="+",
        **kw,
    )


# ======================================================================= global
class Currency(BaseModel):
    class RateSource(models.TextChoices):
        ECB = "ecb", "European Central Bank (daily)"
        MANUAL = "manual", "Entered by an admin"

    code = models.CharField(max_length=3, unique=True)  # ISO 4217
    name = models.CharField(max_length=80)
    exponent = models.PositiveSmallIntegerField(default=2)  # minor units: GBP 2, JPY 0, KWD 3
    stripe_supported = models.BooleanField(default=True)
    rate_source = models.CharField(max_length=8, choices=RateSource.choices, default=RateSource.MANUAL)
    is_active = models.BooleanField(default=False)  # offered at checkout

    class Meta:
        db_table = table(SCHEMA, "currencies")
        ordering = ["code"]

    def __str__(self) -> str:
        return self.code


class FxRate(BaseModel):
    """Units of `currency` for 1 GBP on rate_date (the platform base currency)."""

    currency = currency_fk()
    rate_date = models.DateField()
    rate = models.DecimalField(max_digits=20, decimal_places=10)
    source = models.CharField(max_length=8, choices=Currency.RateSource.choices)

    class Meta:
        db_table = table(SCHEMA, "fx_rates")
        constraints = [models.UniqueConstraint(fields=["currency", "rate_date"], name="uq_fx_day")]
        indexes = [models.Index(fields=["currency", "-rate_date"], name="ix_fx_latest")]


class PriceTier(BaseModel):
    name = models.CharField(max_length=40, unique=True)  # "Tier 5"
    gbp_minor = models.PositiveIntegerField()  # base price in pence
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = table(SCHEMA, "price_tiers")
        ordering = ["sort_order", "gbp_minor"]

    def __str__(self) -> str:
        return self.name


class PriceTierAmount(BaseModel):
    """The price shown in a currency. Recomputed from FX only when it drifts > 5%,
    so prices stay stable; is_locked = an admin set it by hand and FX never touches it."""

    tier = models.ForeignKey(PriceTier, on_delete=models.CASCADE, related_name="amounts")
    currency = currency_fk()
    amount_minor = models.PositiveIntegerField()
    is_locked = models.BooleanField(default=False)
    fx_rate = models.DecimalField(max_digits=20, decimal_places=10, null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "price_tier_amounts")
        constraints = [models.UniqueConstraint(fields=["tier", "currency"], name="uq_tier_currency")]


class CoursePrice(BaseModel):
    course = models.OneToOneField("catalog.Course", on_delete=models.CASCADE, related_name="price")
    tier = models.ForeignKey(PriceTier, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    is_free = models.BooleanField(default=False)

    class Meta:
        db_table = table(SCHEMA, "course_prices")
        constraints = [
            models.CheckConstraint(
                condition=Q(is_free=True, tier__isnull=True) | Q(is_free=False, tier__isnull=False),
                name="ck_price_free_xor_tier",
            )
        ]


class Promotion(BaseModel):
    """A platform promotion (console > Promotions). `kind` decides how it applies:

        campaign         applied automatically to its targets during its window (a sale)
        promo_code       applied when the buyer enters `code` at checkout
        first_purchase   applied automatically to a buyer's first paid order
        subscription     a discount on plan checkout (targets plans)

    One promotion per order (no stacking unless the setting allows it); instructor
    coupons keep working as before. The shown status is derived from the dates."""

    class Kind(models.TextChoices):
        PROMO_CODE = "promo_code", "Promo code"
        CAMPAIGN = "campaign", "Campaign"
        SUBSCRIPTION = "subscription", "Subscription"
        FIRST_PURCHASE = "first_purchase", "First purchase"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SCHEDULED = "scheduled", "Scheduled"
        ACTIVE = "active", "Active"
        ENDED = "ended", "Ended"

    name = models.CharField(max_length=120)
    percent_off = models.PositiveSmallIntegerField()
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.CAMPAIGN)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    code = models.CharField(max_length=40, blank=True)  # promo codes only
    description = models.CharField(max_length=300, blank=True)
    max_redemptions = models.PositiveIntegerField(null=True, blank=True)  # NULL = unlimited
    per_user_limit = models.PositiveIntegerField(null=True, blank=True)
    min_order_minor = models.PositiveIntegerField(default=0)  # GBP pence, compared on the GBP value
    redeemed_count = models.PositiveIntegerField(default=0)
    stripe_coupon_id = models.CharField(max_length=64, blank=True)  # subscription promotions

    class Meta:
        db_table = table(SCHEMA, "promotions")
        constraints = [
            models.CheckConstraint(condition=Q(percent_off__gte=1, percent_off__lte=95), name="ck_promo_pct"),
            models.CheckConstraint(condition=Q(ends_at__gt=models.F("starts_at")), name="ck_promo_dates"),
            models.UniqueConstraint(Lower("code"), condition=~Q(code=""), name="uq_promo_code"),
        ]
        indexes = [models.Index(fields=["starts_at", "ends_at"], name="ix_promo_window")]


class PromotionTarget(BaseModel):
    """What a promotion applies to. No rows = everything (same as one `all` row)."""

    class TargetType(models.TextChoices):
        ALL = "all", "Everything"
        COURSE = "course", "Course"
        CATEGORY = "category", "Category"
        PLAN = "plan", "Subscription plan"
        USER_SEGMENT = "user_segment", "Group of people"

    class Segment(models.TextChoices):
        NEW_USERS = "new_users", "Joined in the last 30 days"
        NO_PURCHASES = "no_purchases", "Never bought a course"
        LEARNERS = "learners", "Every learner"
        COMPANY_MEMBERS = "company_members", "Members of a company"

    promotion = models.ForeignKey(Promotion, on_delete=models.CASCADE, related_name="targets")
    target_type = models.CharField(max_length=16, choices=TargetType.choices)
    target_id = models.UUIDField(null=True, blank=True)  # course / category / plan id
    segment = models.CharField(max_length=20, choices=Segment.choices, blank=True)

    class Meta:
        db_table = table(SCHEMA, "promotion_targets")
        indexes = [models.Index(fields=["promotion", "target_type"], name="ix_promo_targets")]


class Coupon(BaseModel):
    """A code for one course (instructor's own) or every course (staff). 100% = free."""

    code = models.CharField(max_length=40)
    course = models.ForeignKey(
        "catalog.Course", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    percent_off = models.PositiveSmallIntegerField()
    max_redemptions = models.PositiveIntegerField(null=True, blank=True)
    redeemed_count = models.PositiveIntegerField(default=0)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "coupons")
        constraints = [
            models.UniqueConstraint(Lower("code"), name="uq_coupon_code"),
            models.CheckConstraint(
                condition=Q(percent_off__gte=1, percent_off__lte=100), name="ck_coupon_pct"
            ),
            models.CheckConstraint(
                condition=Q(max_redemptions__isnull=True)
                | Q(redeemed_count__lte=models.F("max_redemptions")),
                name="ck_coupon_limit",
            ),
        ]


class Plan(BaseModel):
    class Audience(models.TextChoices):
        PERSONAL = "personal", "Personal plan"
        TEAM = "team", "Team plan (per seat)"

    class Interval(models.TextChoices):
        MONTH = "month", "Monthly"
        YEAR = "year", "Yearly"

    class Kind(models.TextChoices):
        STANDARD = "standard", "Standard plan"
        UNLIMITED_B2C = "unlimited_b2c", "Unlimited B2C (all in-subscription courses)"

    code = models.SlugField(max_length=40, unique=True)
    name = models.CharField(max_length=80)
    audience = models.CharField(max_length=8, choices=Audience.choices)
    kind = models.CharField(max_length=16, choices=Kind.choices, default="standard")
    interval = models.CharField(max_length=5, choices=Interval.choices)
    trial_days = models.PositiveSmallIntegerField(default=0)
    min_seats = models.PositiveSmallIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    renewal = models.CharField(
        max_length=10, choices=[("automatic", "Automatic"), ("manual", "Manual")], default="automatic"
    )
    description = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = table(SCHEMA, "plans")

    def __str__(self) -> str:
        return self.name


class PlanPrice(BaseModel):
    plan = models.ForeignKey(Plan, on_delete=models.CASCADE, related_name="prices")
    currency = currency_fk()
    amount_minor = models.PositiveIntegerField()  # per seat for team plans
    stripe_price_id = models.CharField(max_length=64, blank=True)

    class Meta:
        db_table = table(SCHEMA, "plan_prices")
        constraints = [models.UniqueConstraint(fields=["plan", "currency"], name="uq_plan_currency")]


class PlanCourse(BaseModel):
    """Courses included in a plan. A plan with no rows includes every course marked
    `in_subscription` (the behaviour before plans could list courses)."""

    plan = models.ForeignKey(Plan, on_delete=models.CASCADE, related_name="course_links")
    course = models.ForeignKey("catalog.Course", on_delete=models.CASCADE, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "plan_courses")
        constraints = [models.UniqueConstraint(fields=["plan", "course"], name="uq_plan_course")]


class RegionalPrice(BaseModel):
    """A price for buyers in one country, for one course or a whole tier. Course beats
    tier; no row = the tier's price in the buyer's currency."""

    course = models.ForeignKey(
        "catalog.Course", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    tier = models.ForeignKey(PriceTier, on_delete=models.CASCADE, null=True, blank=True, related_name="+")
    country = models.CharField(max_length=2)  # ISO 3166-1 alpha-2
    currency = currency_fk()
    amount_minor = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = table(SCHEMA, "regional_prices")
        constraints = [
            models.CheckConstraint(
                condition=(Q(course__isnull=False) & Q(tier__isnull=True))
                | (Q(course__isnull=True) & Q(tier__isnull=False)),
                name="ck_regional_one_target",
            ),
            models.UniqueConstraint(
                fields=["course", "country"], condition=Q(course__isnull=False), name="uq_regional_course"
            ),
            models.UniqueConstraint(
                fields=["tier", "country"], condition=Q(tier__isnull=False), name="uq_regional_tier"
            ),
        ]


class PricingRule(BaseModel):
    """A bulk price change staff preview and then apply (console > Pricing > Rules).
    Applying writes course prices once; the rule stays as a record of what was done."""

    class Scope(models.TextChoices):
        ALL = "all", "All courses"
        CATEGORY = "category", "A category"
        INSTRUCTOR = "instructor", "An instructor's courses"

    class Action(models.TextChoices):
        SET_TIER = "set_tier", "Set a price tier"
        PERCENT = "percent", "Change by a percentage"

    class Rounding(models.TextChoices):
        NEAREST = "nearest", "Nearest tier"
        UP = "up", "Tier above"
        DOWN = "down", "Tier below"

    name = models.CharField(max_length=120)
    scope = models.CharField(max_length=12, choices=Scope.choices, default=Scope.ALL)
    target_id = models.UUIDField(null=True, blank=True)  # category or instructor
    action = models.CharField(max_length=10, choices=Action.choices)
    tier = models.ForeignKey(PriceTier, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    percent = models.SmallIntegerField(null=True, blank=True)  # -90..+500, then moved onto a tier
    rounding = models.CharField(max_length=10, choices=Rounding.choices, default=Rounding.NEAREST)
    is_active = models.BooleanField(default=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    applied_count = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "pricing_rules")


class Addon(BaseModel):
    code = models.SlugField(max_length=40, unique=True)  # "content_protection"
    name = models.CharField(max_length=80)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = table(SCHEMA, "addons")

    def __str__(self) -> str:
        return self.name


class AddonPrice(BaseModel):
    addon = models.ForeignKey(Addon, on_delete=models.CASCADE, related_name="prices")
    currency = currency_fk()
    interval = models.CharField(max_length=5, choices=Plan.Interval.choices)
    amount_minor = models.PositiveIntegerField()
    stripe_price_id = models.CharField(max_length=64, blank=True)

    class Meta:
        db_table = table(SCHEMA, "addon_prices")
        constraints = [
            models.UniqueConstraint(fields=["addon", "currency", "interval"], name="uq_addon_price")
        ]


class StripeEvent(BaseModel):
    """Every webhook Stripe sends, once. The unique event id makes retries harmless."""

    event_id = models.CharField(max_length=64, unique=True)
    type = models.CharField(max_length=80)
    payload = models.JSONField()
    processed_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True)

    class Meta:
        db_table = table(SCHEMA, "stripe_events")
        indexes = [
            models.Index(
                fields=["created_at"], name="ix_stripe_unprocessed", condition=Q(processed_at__isnull=True)
            )
        ]


# ===================================================================== personal
class CartItem(BaseModel):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+", db_index=False)
    course = models.ForeignKey("catalog.Course", on_delete=models.CASCADE, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "cart_items")
        constraints = [models.UniqueConstraint(fields=["user", "course"], name="uq_cart_course")]


class WishlistItem(BaseModel):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+", db_index=False)
    course = models.ForeignKey("catalog.Course", on_delete=models.CASCADE, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "wishlist_items")
        constraints = [models.UniqueConstraint(fields=["user", "course"], name="uq_wishlist_course")]


# ======================================================================== mixed
class Order(MixedTenantModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Awaiting payment"
        PAID = "paid", "Paid"
        FAILED = "failed", "Payment failed"
        EXPIRED = "expired", "Checkout expired"
        REFUNDED = "refunded", "Refunded"
        PARTIALLY_REFUNDED = "partially_refunded", "Partly refunded"

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    currency = currency_fk()
    subtotal_minor = models.PositiveIntegerField()  # list prices
    discount_minor = models.PositiveIntegerField(default=0)
    tax_minor = models.PositiveIntegerField(default=0)  # prices are tax-inclusive; Stripe Tax later
    total_minor = models.PositiveIntegerField()
    fx_rate = models.DecimalField(max_digits=20, decimal_places=10)  # currency per GBP at checkout
    gbp_total_minor = models.PositiveIntegerField()  # for reporting and instructor revenue
    coupon = models.ForeignKey(Coupon, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    promotion = models.ForeignKey(
        Promotion, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    country = models.CharField(max_length=2, blank=True)  # buyer's country when a regional price applied
    stripe_session_id = models.CharField(max_length=128, null=True, blank=True, unique=True)
    stripe_payment_intent_id = models.CharField(max_length=64, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    # From Stripe's PaymentIntent (webhook); empty on orders paid before M5
    payment_method_type = models.CharField(max_length=32, blank=True)  # card / paypal / link ...
    card_brand = models.CharField(max_length=20, blank=True)  # visa / mastercard / amex
    card_last4 = models.CharField(max_length=4, blank=True)

    class Meta:
        db_table = table(SCHEMA, "orders")
        constraints = [models.UniqueConstraint(fields=["org", "id"], name="uq_orders_org_id")]
        indexes = [
            models.Index(fields=["user", "-created_at"], name="ix_orders_user"),
            models.Index(fields=["org", "-created_at"], name="ix_orders_org", condition=Q(org__isnull=False)),
            models.Index(
                fields=["status", "created_at"], name="ix_orders_pending", condition=Q(status="pending")
            ),
        ]


class OrderItem(MixedTenantModel):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    course = models.ForeignKey("catalog.Course", on_delete=models.PROTECT, related_name="+")
    list_minor = models.PositiveIntegerField()
    discount_minor = models.PositiveIntegerField(default=0)
    tax_minor = models.PositiveIntegerField(default=0)
    gross_minor = models.PositiveIntegerField()  # what was paid for this item
    gbp_gross_minor = models.PositiveIntegerField()
    enrollment = models.ForeignKey(
        "learning.Enrollment", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    refunded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "order_items")
        constraints = [models.UniqueConstraint(fields=["order", "course"], name="uq_order_course")]
        indexes = [
            models.Index(fields=["course", "created_at"], name="ix_items_course")
        ]  # instructor revenue


class Payment(MixedTenantModel):
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="payments")
    provider_ref = models.CharField(max_length=64, unique=True)  # payment intent id
    amount_minor = models.PositiveIntegerField()
    currency = currency_fk()
    status = models.CharField(max_length=16)  # succeeded / failed
    payment_method_type = models.CharField(max_length=32, blank=True)
    card_brand = models.CharField(max_length=20, blank=True)
    card_last4 = models.CharField(max_length=4, blank=True)

    class Meta:
        db_table = table(SCHEMA, "payments")


class Refund(MixedTenantModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCEEDED = "succeeded", "Refunded"
        FAILED = "failed", "Failed"

    item = models.OneToOneField(OrderItem, on_delete=models.PROTECT, related_name="refund")
    amount_minor = models.PositiveIntegerField()
    reason = models.CharField(max_length=300, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    provider_ref = models.CharField(max_length=64, blank=True)
    requested_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "refunds")


class CouponRedemption(MixedTenantModel):
    coupon = models.ForeignKey(Coupon, on_delete=models.PROTECT, related_name="redemptions")
    order = models.OneToOneField(Order, on_delete=models.CASCADE, related_name="redemption")

    class Meta:
        db_table = table(SCHEMA, "coupon_redemptions")


class PromotionRedemption(MixedTenantModel):
    """One use of a platform promotion by a paid order (usage counts, revenue generated)."""

    promotion = models.ForeignKey(Promotion, on_delete=models.PROTECT, related_name="redemptions")
    order = models.OneToOneField(Order, on_delete=models.CASCADE, related_name="promotion_redemption")
    discount_minor = models.PositiveIntegerField()  # in the order's currency
    gbp_discount_minor = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = table(SCHEMA, "promotion_redemptions")
        indexes = [models.Index(fields=["promotion", "user"], name="ix_promo_redemptions")]


class Subscription(MixedTenantModel):
    class Status(models.TextChoices):  # mirrors Stripe's subscription statuses
        INCOMPLETE = "incomplete", "Incomplete"
        TRIALING = "trialing", "Trial"
        ACTIVE = "active", "Active"
        PAST_DUE = "past_due", "Past due"
        CANCELED = "canceled", "Cancelled"
        UNPAID = "unpaid", "Unpaid"

    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.INCOMPLETE)
    currency = currency_fk()
    seats = models.PositiveIntegerField(default=1)
    stripe_subscription_id = models.CharField(max_length=64, null=True, blank=True, unique=True)
    stripe_session_id = models.CharField(max_length=128, null=True, blank=True, unique=True)
    current_period_end = models.DateTimeField(null=True, blank=True)
    cancel_at_period_end = models.BooleanField(default=False)
    canceled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "subscriptions")
        constraints = [models.UniqueConstraint(fields=["org", "id"], name="uq_subs_org_id")]
        indexes = [
            models.Index(fields=["user", "status"], name="ix_subs_user"),
            models.Index(fields=["org", "status"], name="ix_subs_org", condition=Q(org__isnull=False)),
        ]


class AddonSubscription(MixedTenantModel):
    addon = models.ForeignKey(Addon, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=12, choices=Subscription.Status.choices, default="incomplete")
    currency = currency_fk()
    stripe_subscription_id = models.CharField(max_length=64, null=True, blank=True, unique=True)
    stripe_session_id = models.CharField(max_length=128, null=True, blank=True, unique=True)
    current_period_end = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "addon_subscriptions")
        indexes = [models.Index(fields=["user", "addon", "status"], name="ix_addon_subs")]


class Invoice(MixedTenantModel):
    order = models.ForeignKey(Order, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    subscription = models.ForeignKey(
        Subscription, on_delete=models.PROTECT, null=True, blank=True, related_name="invoices"
    )
    stripe_invoice_id = models.CharField(max_length=64, unique=True)
    number = models.CharField(max_length=40, blank=True)
    currency = currency_fk()
    amount_minor = models.PositiveIntegerField()
    status = models.CharField(max_length=16)
    hosted_url = models.URLField(max_length=500, blank=True)
    pdf_url = models.URLField(max_length=500, blank=True)
    issued_at = models.DateTimeField()

    class Meta:
        db_table = table(SCHEMA, "invoices")
        indexes = [models.Index(fields=["user", "-issued_at"], name="ix_invoices_user")]


class SubscriptionEvent(MixedTenantModel):
    """What happened to a subscription, in order (console > Subscriptions > Plan changes).
    Written by the Stripe webhook handler; org_id and user_id copy the subscription's."""

    class Kind(models.TextChoices):
        CREATED = "created", "Started"
        UPGRADED = "upgraded", "Upgraded"
        DOWNGRADED = "downgraded", "Downgraded"
        SEATS_CHANGED = "seats_changed", "Seats changed"
        RENEWED = "renewed", "Renewed"
        CANCELLED = "cancelled", "Cancelled"
        PAYMENT_FAILED = "payment_failed", "Payment failed"

    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name="events")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    from_value = models.CharField(max_length=80, blank=True)  # plan code or seat count before
    to_value = models.CharField(max_length=80, blank=True)
    amount_minor = models.PositiveIntegerField(null=True, blank=True)  # e.g. the renewal invoice
    at = models.DateTimeField()

    class Meta:
        db_table = table(SCHEMA, "subscription_events")
        indexes = [
            models.Index(fields=["subscription", "-at"], name="ix_sub_events_sub"),
            models.Index(fields=["kind", "-at"], name="ix_sub_events_kind"),
        ]


# ======================================================================= B2C-03 token pricing
# Additive token-pricing models (milestone B2C-03 / M8 / M13). Multi-currency is handled the
# same way as cash: a single GBP-base `TokenRate` is converted to other currencies via the
# existing `FxRate` table. We do NOT store a per-currency rate row.
#
# Audit for every mutation goes through `apps.platform.services.audit()` (which writes to
# the partitioned, append-only `platform.audit_logs` table). No parallel `PricingAuditLog`
# is defined — the existing audit backend already matches the requirements (append-only,
# WHO/WHAT/WHEN/WHY captured, plus `data` JSONB for before/after values and `reason`).
#
# Invariant: price changes affect FUTURE purchases only. Existing `ContentEntitlement` and
# `PriceSnapshot` rows are never modified or deleted by any service in this milestone (A06).


class TokenPack(BaseModel):
    """A catalogue SKU: N tokens for a published cash price (via PriceTier)."""

    name = models.CharField(max_length=120)
    token_amount = models.PositiveIntegerField()
    price_tier = models.ForeignKey(PriceTier, on_delete=models.PROTECT, related_name="token_packs")
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "token_packs")
        ordering = ["sort_order", "name"]
        indexes = [
            models.Index(
                fields=["is_active", "sort_order"], name="ix_tpk_active", condition=Q(is_active=True)
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.token_amount})"


class TokenRate(BaseModel):
    """Versioned conversion rate (GBP base).

    `tokens_per_gbp_minor` = tokens granted per 1 GBP minor unit (per penny). Keeping it on
    the base currency means we convert to any other currency via `FxRate`, matching the
    cash-pricing pattern used by PriceTier.gbp_minor.

    Exactly one row at a time may have `effective_to IS NULL` (the live rate). Enforced by
    a partial unique index in migration (see `0005_token_pricing.py`).
    """

    tokens_per_gbp_minor = models.DecimalField(max_digits=12, decimal_places=4)
    effective_from = models.DateTimeField()
    effective_to = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    notes = models.TextField(blank=True)

    class Meta:
        db_table = table(SCHEMA, "token_rates")
        ordering = ["-effective_from"]
        indexes = [
            models.Index(fields=["effective_from"], name="ix_trate_from"),
        ]

    def __str__(self) -> str:
        return f"TokenRate({self.tokens_per_gbp_minor} /penny from {self.effective_from})"

    @classmethod
    def current(cls, *, at=None):
        """Return the currently-effective rate (or None).

        A rate is current when `effective_from <= at` and (`effective_to IS NULL` or
        `effective_to > at`).
        """
        from django.utils import timezone as _tz

        at = at or _tz.now()
        return (
            cls.objects.filter(effective_from__lte=at)
            .filter(Q(effective_to__isnull=True) | Q(effective_to__gt=at))
            .order_by("-effective_from")
            .first()
        )


class TopUpPolicy(BaseModel):
    """Per-currency min/max custom top-up bounds. One row active per currency at a time."""

    currency = models.CharField(max_length=3)  # ISO 4217; not FK — policy may precede Currency rows
    min_minor = models.PositiveIntegerField()
    max_minor = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True)
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "topup_policies")
        indexes = [
            models.Index(fields=["currency"], name="ix_topup_active_cur", condition=Q(is_active=True)),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(max_minor__gte=models.F("min_minor")),
                name="ck_topup_max_gte_min",
            ),
        ]


class BonusCampaign(BaseModel):
    """Configuration for bonus-token campaigns.

    NOTE: Issuance of bonus tokens at purchase/top-up time is the wallet module's job
    (see M7-b2c-wallet). This model is config-only; no wallet writes happen here.
    Activation is GATED: see `pricing_service.upsert_bonus_campaign` — any attempt to set
    `is_active=True` raises `ConfigurationBlocked("F02")` until the funding model lands.
    """

    class ConditionType(models.TextChoices):
        TOPUP_MIN_AMOUNT = "topup_min_amount", "Top-up at or above a minimum amount"
        FIRST_TOPUP = "first_topup", "First top-up by a user"
        PACK_PURCHASE = "pack_purchase", "Token pack purchase"

    name = models.CharField(max_length=120)
    condition_type = models.CharField(max_length=20, choices=ConditionType.choices)
    condition_value = models.JSONField(default=dict, blank=True)
    bonus_tokens = models.PositiveIntegerField(null=True, blank=True)
    bonus_percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    bonus_expiry_days = models.PositiveIntegerField(null=True, blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    is_active = models.BooleanField(default=False)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "bonus_campaigns")
        constraints = [
            # Exactly one of bonus_tokens or bonus_percent is non-null.
            models.CheckConstraint(
                condition=(
                    (Q(bonus_tokens__isnull=False) & Q(bonus_percent__isnull=True))
                    | (Q(bonus_tokens__isnull=True) & Q(bonus_percent__isnull=False))
                ),
                name="ck_bonus_amount_xor",
            ),
            models.CheckConstraint(
                condition=Q(ends_at__gt=models.F("starts_at")),
                name="ck_bonus_dates",
            ),
        ]


class PriceSnapshot(BaseModel):
    """Frozen pricing used at the moment of purchase / unlock / top-up. IMMUTABLE.

    Populated by M-wallet and M-cash-package when they write `TokenSpend`, `Order`, or a
    wallet top-up. Nothing in this milestone (B2C-03 / M8 / M13 PR 1) writes rows here —
    the table ships so downstream modules have a stable write target.
    """

    class Scope(models.TextChoices):
        COURSE = "course", "Course"
        LECTURE = "lecture", "Lecture"
        MATERIAL = "material", "Material / downloadable asset"
        PACK = "pack", "Token pack"
        CUSTOM_TOPUP = "custom_topup", "Custom cash top-up"

    class SourceRefKind(models.TextChoices):
        ORDER = "order", "commerce.Order"
        TOKEN_SPEND = "token_spend", "commerce.TokenSpend"
        WALLET_TOPUP = "wallet_topup", "commerce.WalletTopUp"

    scope = models.CharField(max_length=16, choices=Scope.choices)
    target_id = models.CharField(max_length=64)  # string — may be UUID or int depending on target
    amount_minor = models.PositiveIntegerField(null=True, blank=True)  # cash side
    token_amount = models.PositiveIntegerField(null=True, blank=True)  # token side
    currency = models.CharField(max_length=3, blank=True)
    source_rate = models.ForeignKey(
        TokenRate, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    snapshot_at = models.DateTimeField(auto_now_add=True)
    source_ref_kind = models.CharField(max_length=20, choices=SourceRefKind.choices)
    source_ref = models.CharField(max_length=64)

    class Meta:
        db_table = table(SCHEMA, "price_snapshots")
        indexes = [
            models.Index(fields=["scope", "target_id"], name="ix_snap_target"),
            models.Index(fields=["source_ref_kind", "source_ref"], name="ix_snap_source"),
        ]


# ======================================================================= B2C-02 wallet
class TokenGrant(BaseModel):
    """A lot of tokens granted to a user. FEFO: oldest-expiring lots are spent first.

    Sources: pack purchase, custom top-up, admin adjustment, bonus campaign.
    `remaining` is decremented atomically by spend_tokens(); never goes below 0.
    """

    class Source(models.TextChoices):
        PACK = "pack", "Token pack purchase"
        TOPUP = "topup", "Custom cash top-up"
        ADMIN = "admin", "Admin adjustment"
        BONUS = "bonus", "Bonus campaign"
        REFUND = "refund", "Spend reversal / refund"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+", db_index=False)
    source = models.CharField(max_length=10, choices=Source.choices)
    amount = models.PositiveIntegerField()
    remaining = models.PositiveIntegerField()
    unit_cost_gbp = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    granted_at = models.DateTimeField()
    expires_at = models.DateTimeField(null=True, blank=True)
    expired_at = models.DateTimeField(null=True, blank=True)
    source_ref = models.CharField(max_length=64, blank=True)
    stripe_session_id = models.CharField(max_length=128, null=True, blank=True, unique=True)
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = table(SCHEMA, "token_grants")
        indexes = [
            models.Index(
                fields=["user", "expires_at", "granted_at", "id"],
                name="ix_tgrant_fefo",
                condition=Q(remaining__gt=0, expired_at__isnull=True),
            ),
            models.Index(fields=["user"], name="ix_tgrant_user"),
            models.Index(
                fields=["expires_at"],
                name="ix_tgrant_expires",
                condition=Q(expires_at__isnull=False, expired_at__isnull=True),
            ),
        ]

    def __str__(self):
        return f"Grant({self.user_id}, {self.amount}, remaining={self.remaining})"


class TokenSpend(BaseModel):
    """One unlock operation: user spent N tokens on a piece of content."""

    class Scope(models.TextChoices):
        COURSE = "course", "Course"
        LECTURE = "lecture", "Lecture"
        MATERIAL = "material", "Material"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+", db_index=False)
    scope = models.CharField(max_length=12, choices=Scope.choices)
    target_id = models.UUIDField()
    tokens_total = models.PositiveIntegerField()
    weighted_unit_cost_gbp = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    course_id = models.UUIDField(null=True, blank=True)
    instructor_id = models.UUIDField(null=True, blank=True)
    entitlement = models.ForeignKey(
        "platform.ContentEntitlement", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = table(SCHEMA, "token_spends")
        indexes = [
            models.Index(fields=["user", "-created_at"], name="ix_tspend_user"),
            models.Index(
                fields=["course_id"],
                name="ix_tspend_course",
                condition=Q(course_id__isnull=False),
            ),
        ]


class TokenLedgerEntry(BaseModel):
    """Append-only record of every token balance change. Never UPDATE or DELETE."""

    class Kind(models.TextChoices):
        GRANT = "grant", "Tokens granted"
        SPEND = "spend", "Tokens spent on content"
        EXPIRY = "expiry", "Tokens expired (FEFO)"
        ADMIN_CLAWBACK = "admin_clawback", "Admin removed tokens"
        REFUND_REVERSAL = "refund_reversal", "Spend reversed (refund)"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+", db_index=False)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    amount = models.IntegerField()
    balance_after = models.PositiveIntegerField()
    grant = models.ForeignKey(TokenGrant, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    spend = models.ForeignKey(TokenSpend, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = table(SCHEMA, "token_ledger")
        indexes = [
            models.Index(fields=["user", "-created_at"], name="ix_tledger_user"),
        ]


# ======================================================================= B2C-06 cash packages
class CashPackage(BaseModel):
    """A bundle of courses sold for a one-off cash price (via PriceTier)."""

    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=120, unique=True)
    description = models.TextField(blank=True, max_length=4000)
    price_tier = models.ForeignKey(PriceTier, on_delete=models.PROTECT, related_name="cash_packages")
    is_active = models.BooleanField(default=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "cash_packages")
        indexes = [
            models.Index(fields=["is_active", "slug"], name="ix_cpkg_active"),
        ]

    def __str__(self):
        return self.name


class CashPackageCourse(BaseModel):
    """Association: which courses are included in a package. Snapshot stores the
    course's list GBP price at the time the package was last published/saved, so
    pro-rata revenue share is deterministic."""

    package = models.ForeignKey(CashPackage, on_delete=models.CASCADE, related_name="courses")
    course = models.ForeignKey("catalog.Course", on_delete=models.CASCADE, related_name="+")
    snapshot_gbp_minor = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = table(SCHEMA, "cash_package_courses")
        constraints = [
            models.UniqueConstraint(fields=["package", "course"], name="uq_cpkg_course"),
        ]
