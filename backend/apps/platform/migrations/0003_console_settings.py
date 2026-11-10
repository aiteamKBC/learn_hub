"""M5 platform settings with their defaults (apps/platform/registry.py at the time of writing).
Insert only: a setting that already has a value keeps it."""

from django.db import migrations

SETTINGS = [
    ("general.platform_name", "LearnHub", "Platform name", True),
    ("general.tagline", "Learn. Practise. Grow.", "Tagline", True),
    ("general.logo_url", "", "Logo", True),
    ("general.favicon_url", "", "Favicon", True),
    ("general.default_language", "en", "Default language", True),
    ("general.default_currency", "GBP", "Default currency", True),
    ("general.time_zone", "Europe/London", "Time zone", True),
    ("general.date_format", "d MMM yyyy", "Date format", True),
    ("access.registration_enabled", True, "Registration enabled", True),
    ("access.instructor_applications", True, "Instructor applications", True),
    ("access.guest_browsing", True, "Guest browsing", True),
    ("access.maintenance_mode", False, "Maintenance mode", True),
    (
        "access.maintenance_message",
        "We're making improvements and will be back shortly.",
        "Maintenance message",
        True,
    ),
    ("payments.refund_window_days", 30, "Refund window (days)", True),
    ("payments.prices_include_tax", True, "Prices include VAT", True),
    ("payments.allow_promotion_stacking", False, "Promotions can stack with coupons", False),
    ("payments.discount_reduces_commission", True, "Discounts reduce the instructor's share", False),
    ("learning.course_review_required", True, "New courses need staff review", False),
    ("learning.certificates_enabled", True, "Issue certificates on completion", True),
    ("learning.certificate_expiry_months", 0, "Default certificate expiry (months, 0 = never)", False),
    ("learning.reviews_enabled", True, "Learners can review courses", True),
    ("learning.qa_enabled", True, "Course Q&A", True),
    ("notifications.email_enabled", True, "Send email copies", False),
    ("notifications.digest", "off", "Digest for instructors", False),
    ("notifications.staff_alerts", True, "Health alerts to staff", False),
    ("instructors.default_max_courses", 0, "Course limit for new instructors (0 = none)", False),
    ("instructors.coupons_enabled", True, "Instructors can create coupons", False),
    ("payouts.schedule", "monthly", "Payout schedule", False),
    ("payouts.day_of_month", 5, "Payout day of the month", False),
    ("payouts.minimum_gbp_minor", 2500, "Minimum payout (pence)", False),
    ("payouts.hold_days", 30, "Hold before earnings are available (days)", False),
    ("payouts.requests_enabled", True, "Instructors can request a payout", False),
    ("pricing.regional_enabled", True, "Use regional prices at checkout", True),
    ("pricing.fx_auto_refresh", True, "Refresh exchange rates daily", False),
    ("security.password_min_length", 8, "Minimum password length", True),
    ("security.session_days", 14, "Stay signed in for (days)", False),
    ("security.require_email_verification", True, "Require email verification", False),
    ("security.mfa_enabled", True, "People can turn on 2-step sign-in", True),
    ("security.mfa_required_for_staff", False, "Staff must use 2-step sign-in", False),
]


def insert(apps, schema_editor):
    Setting = apps.get_model("platform", "Setting")
    db = schema_editor.connection.alias
    for key, value, description, public in SETTINGS:
        Setting.objects.using(db).get_or_create(
            key=key, defaults={"value": value, "description": description, "is_public": public}
        )


class Migration(migrations.Migration):
    dependencies = [("platform", "0002_security_and_audit")]

    operations = [migrations.RunPython(insert, migrations.RunPython.noop)]
