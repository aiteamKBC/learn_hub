"""Every platform setting the console can edit: its key, type, default and limits.

The defaults here are the single source of truth: `get_setting` falls back to them, the
console shows them, and migration platform 0003 inserts them (insert only). Client
decisions (docs/client-questions.md) are settings with these defaults, never constants
in code. `public` settings may be sent to every browser (branding, switches).
"""

from dataclasses import dataclass, field

from core.errors import ServiceError


@dataclass(frozen=True)
class Def:
    key: str
    default: object
    kind: str  # bool | int | str | choice
    label: str
    group: (
        str  # general | access | payment | learning | notification | instructor | payout | security | pricing
    )
    public: bool = False
    min: int | None = None
    max: int | None = None
    max_len: int = 200
    choices: tuple = field(default_factory=tuple)


BRANDING_PATH = "/api/v1/platform/branding/"  # uploaded logo / favicon, served by the platform API
DATE_FORMATS = ("d MMM yyyy", "dd/MM/yyyy", "yyyy-MM-dd")
LANGUAGES = ("en", "ar", "fr", "de", "es")

SETTINGS: tuple[Def, ...] = (
    # general (shown site-wide: header, emails, PDFs, page titles)
    Def("general.platform_name", "LearnHub", "str", "Platform name", "general", public=True, max_len=60),
    Def("general.tagline", "Learn. Practise. Grow.", "str", "Tagline", "general", public=True, max_len=120),
    Def("general.logo_url", "", "str", "Logo", "general", public=True, max_len=500),
    Def("general.favicon_url", "", "str", "Favicon", "general", public=True, max_len=500),
    Def("general.default_language", "en", "choice", "Default language", "general", public=True, choices=LANGUAGES),
    Def("general.default_currency", "GBP", "str", "Default currency", "general", public=True, max_len=3),
    Def("general.time_zone", "Europe/London", "str", "Time zone", "general", public=True, max_len=64),
    Def("general.date_format", "d MMM yyyy", "choice", "Date format", "general", public=True, choices=DATE_FORMATS),
    # switches the backend enforces (staff always bypass)
    Def("access.registration_enabled", True, "bool", "Registration enabled", "access", public=True),
    Def("access.instructor_applications", True, "bool", "Instructor applications", "access", public=True),
    Def("access.guest_browsing", True, "bool", "Guest browsing", "access", public=True),
    Def("access.maintenance_mode", False, "bool", "Maintenance mode", "access", public=True),
    Def("access.maintenance_message", "We're making improvements and will be back shortly.", "str",
        "Maintenance message", "access", public=True, max_len=300),
    # payments (client questions 3, 4, 16)
    Def("payments.refund_window_days", 30, "int", "Refund window (days)", "payment", public=True, min=0, max=365),
    Def("payments.prices_include_tax", True, "bool", "Prices include VAT", "payment", public=True),
    Def("payments.allow_promotion_stacking", False, "bool", "Promotions can stack with coupons", "payment"),
    Def("payments.discount_reduces_commission", True, "bool", "Discounts reduce the instructor's share", "payment"),
    # learning (client question 18)
    Def("learning.course_review_required", True, "bool", "New courses need staff review", "learning"),
    Def("learning.certificates_enabled", True, "bool", "Issue certificates on completion", "learning", public=True),
    Def("learning.certificate_expiry_months", 0, "int", "Default certificate expiry (months, 0 = never)",
        "learning", min=0, max=120),
    Def("learning.reviews_enabled", True, "bool", "Learners can review courses", "learning", public=True),
    Def("learning.qa_enabled", True, "bool", "Course Q&A", "learning", public=True),
    # notifications
    Def("notifications.email_enabled", True, "bool", "Send email copies", "notification"),
    Def("notifications.digest", "off", "choice", "Digest for instructors", "notification",
        choices=("off", "daily", "weekly")),
    Def("notifications.staff_alerts", True, "bool", "Health alerts to staff", "notification"),
    # instructors
    Def("instructors.default_max_courses", 0, "int", "Course limit for new instructors (0 = none)", "instructor",
        min=0, max=1000),
    Def("instructors.coupons_enabled", True, "bool", "Instructors can create coupons", "instructor"),
    # payouts (client questions 2, 13, 14)
    Def("payouts.schedule", "monthly", "choice", "Payout schedule", "payout", choices=("weekly", "monthly")),
    Def("payouts.day_of_month", 5, "int", "Payout day of the month", "payout", min=1, max=28),
    Def("payouts.minimum_gbp_minor", 2500, "int", "Minimum payout (pence)", "payout", min=0, max=10_000_000),
    Def("payouts.hold_days", 30, "int", "Hold before earnings are available (days)", "payout", min=0, max=180),
    Def("payouts.requests_enabled", True, "bool", "Instructors can request a payout", "payout"),
    # pricing (client question 15)
    Def("pricing.regional_enabled", True, "bool", "Use regional prices at checkout", "pricing", public=True),
    Def("pricing.fx_auto_refresh", True, "bool", "Refresh exchange rates daily", "pricing"),
    # security (client question 19)
    Def("security.password_min_length", 8, "int", "Minimum password length", "security", public=True, min=8, max=64),
    Def("security.session_days", 14, "int", "Stay signed in for (days)", "security", min=1, max=90),
    Def("security.require_email_verification", True, "bool", "Require email verification", "security"),
    Def("security.mfa_enabled", True, "bool", "People can turn on 2-step sign-in", "security", public=True),
    Def("security.mfa_required_for_staff", False, "bool", "Staff must use 2-step sign-in", "security"),
)  # fmt: skip

BY_KEY = {d.key: d for d in SETTINGS}


def default(key: str):
    d = BY_KEY.get(key)
    return d.default if d else None


def validate(key: str, value):
    """The value to store, or a ServiceError. Unknown keys keep the old free-form rules."""
    d = BY_KEY.get(key)
    if d is None:
        return value
    if d.kind == "bool":
        if not isinstance(value, bool):
            raise ServiceError("bad_value", f"{d.label}: choose on or off.")
        return value
    if d.kind == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ServiceError("bad_value", f"{d.label}: enter a whole number.")
        if (d.min is not None and value < d.min) or (d.max is not None and value > d.max):
            raise ServiceError("bad_value", f"{d.label}: enter a number from {d.min} to {d.max}.")
        return value
    if not isinstance(value, str):
        raise ServiceError("bad_value", f"{d.label}: enter text.")
    value = value.strip()
    if d.kind == "choice" and value not in d.choices:
        raise ServiceError("bad_value", f"{d.label}: choose one of the options.")
    if len(value) > d.max_len:
        raise ServiceError("bad_value", f"{d.label}: at most {d.max_len} characters.")
    uploaded = value.startswith(BRANDING_PATH) and "//" not in value  # our own upload (console)
    if d.key.endswith("_url") and value and not uploaded and not value.startswith("https://"):
        raise ServiceError("bad_value", f"{d.label}: use an https link.")
    return value
