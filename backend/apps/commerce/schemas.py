"""Pydantic In/Out schemas for the commerce API. Money is integer minor units plus the
currency's exponent; the browser formats it with Intl.NumberFormat."""

from datetime import datetime
from uuid import UUID

from ninja import Field, Schema

from apps.catalog.schemas import CourseCard
from apps.identity.schemas import OkOut  # noqa: F401 - shared response shape


class CurrencyOut(Schema):
    code: str
    name: str
    exponent: int


class CartLine(Schema):
    course: CourseCard
    list_minor: int
    price_minor: int


class CartOut(Schema):
    currency: str
    exponent: int
    lines: list[CartLine]
    subtotal_minor: int
    discount_minor: int
    total_minor: int
    coupon: str | None = None
    coupon_error: str | None = None
    promotion: str | None = None  # the platform promotion applied, by name


class CourseRef(Schema):
    course_id: UUID


class CheckoutIn(Schema):
    course_ids: list[UUID] = Field(..., min_length=1, max_length=50)
    currency: str = Field(..., min_length=3, max_length=3)
    coupon: str | None = Field(None, max_length=40)


class CheckoutOut(Schema):
    order_id: UUID
    status: str
    checkout_url: str | None  # None when nothing to pay (free / 100% coupon): already enrolled
    total_minor: int
    currency: str


class OrderItemOut(Schema):
    id: UUID
    course_id: UUID
    course_title: str
    course_slug: str
    gross_minor: int
    refunded_at: datetime | None
    refundable: bool


class OrderOut(Schema):
    id: UUID
    status: str
    currency: str
    exponent: int
    subtotal_minor: int
    discount_minor: int
    total_minor: int
    created_at: datetime
    paid_at: datetime | None
    items: list[OrderItemOut]


class OrderPage(Schema):
    items: list[OrderOut]
    next_cursor: str | None


class RefundIn(Schema):
    reason: str = Field("", max_length=300)


class PlanPriceOut(Schema):
    plan_id: UUID
    code: str
    name: str
    audience: str
    interval: str
    trial_days: int
    currency: str
    exponent: int
    amount_minor: int


class CartCountOut(Schema):
    count: int


class WishlistOut(Schema):
    items: list[CourseCard]


class WishlistToggleOut(Schema):
    in_wishlist: bool


class RefundOut(Schema):
    ok: bool = True
    status: str


class PlanEnrollOut(Schema):
    enrollment_id: UUID


class SubscriptionOut(Schema):
    id: UUID
    plan: str
    audience: str
    status: str
    seats: int
    currency: str
    current_period_end: datetime | None
    cancel_at_period_end: bool


class SubscribeOut(Schema):
    subscription_id: UUID
    checkout_url: str


class CancelOut(Schema):
    cancel_at_period_end: bool
    access_until: datetime | None


class AddonOut(Schema):
    addon_subscription_id: UUID
    checkout_url: str


class UrlOut(Schema):
    url: str


class InvoiceOut(Schema):
    id: UUID
    number: str
    currency: str
    amount_minor: int
    status: str
    hosted_url: str
    pdf_url: str
    issued_at: datetime | None
