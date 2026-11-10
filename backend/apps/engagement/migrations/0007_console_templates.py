"""M5 notification wordings (section N of the brief). Insert only: an existing row with the
same code is left exactly as staff edited it."""

from django.db import migrations

TEMPLATES = [
    ("order_receipt", "Receipt for your order", "Thanks for buying {items}. Total paid: {amount}.", True),
    (
        "refund_issued",
        "Refund issued",
        "We refunded {amount} for {course}. Your access to it has ended.",
        True,
    ),
    ("subscription_started", "Welcome to {plan}", "Your subscription has started.", True),
    ("subscription_renewed", "{plan} renewed", "Your subscription renewed until {date}.", True),
    (
        "subscription_cancelled",
        "{plan} cancelled",
        "Your subscription won't renew. You keep access until {date}.",
        True,
    ),
    (
        "subscription_payment_failed",
        "Payment failed for {plan}",
        "We couldn't take your payment. Update your card to keep access.",
        True,
    ),
    (
        "ticket_opened",
        "We've got your request ({reference})",
        'Thanks for contacting us about "{subject}". We will reply soon.',
        True,
    ),
    (
        "ticket_resolved",
        "Request resolved ({reference})",
        'We marked "{subject}" as resolved. Reply if you still need help.',
        True,
    ),
    (
        "content_hidden",
        "Your {kind} was hidden",
        "Our moderators hid your {kind} on {course}: {reason}",
        True,
    ),
    (
        "report_handled",
        "Thanks for your report",
        "We looked at the {kind} you reported and {outcome}.",
        False,
    ),
    (
        "certificate_revoked",
        "Certificate revoked: {course}",
        "Your certificate for {course} was revoked: {reason}",
        True,
    ),
    (
        "certificate_expiring",
        "Certificate expiring soon: {course}",
        "Your certificate for {course} expires on {date}.",
        True,
    ),
    (
        "account_suspended",
        "Your account is suspended",
        "Your {platform} account has been suspended. Contact support if you think this is a mistake.",
        True,
    ),
    ("account_reactivated", "Your account is active again", "You can sign in to {platform} again.", True),
    (
        "staff_access_granted",
        "Security notice: staff access",
        "Your account was given platform staff access. If you didn't expect this, contact support.",
        True,
    ),
    ("mfa_enabled", "2-step sign-in turned on", "2-step sign-in is now on for your account.", True),
    (
        "mfa_disabled",
        "2-step sign-in turned off",
        "2-step sign-in was turned off for your account. If this wasn't you, change your password.",
        True,
    ),
    ("broadcast", "{title}", "{body}", True),
    (
        "instructor_approved",
        "You're approved to teach on {platform}",
        "Your instructor application was approved. You can now create courses.",
        True,
    ),
    (
        "instructor_rejected",
        "Your instructor application",
        "We couldn't approve your application this time: {reason}",
        True,
    ),
    ("course_approved", "{course} is live", "Your course was approved and is now on the marketplace.", True),
    (
        "course_changes_requested",
        "Changes requested for {course}",
        "A reviewer asked for changes: {notes}",
        True,
    ),
    ("course_rejected", "{course} was not approved", "A reviewer did not approve the course: {reason}", True),
    (
        "course_unpublished",
        "{course} was unpublished",
        "Staff took the course off the marketplace: {reason}. Learners who have it keep access.",
        True,
    ),
    ("course_relisted", "{course} is back on the marketplace", "Your course is listed again.", True),
    ("new_sale", "New sale: {course}", "Someone bought {course}. You earned {amount}.", False),
    ("new_review", "New review on {course}", "A learner rated {course} {rating} out of 5.", False),
    (
        "template_approved",
        "Certificate template approved",
        '"{template}" can now be used on your courses.',
        True,
    ),
    (
        "template_rejected",
        "Certificate template not approved",
        '"{template}" was not approved: {reason}',
        True,
    ),
    (
        "payout_request_approved",
        "Payout request approved",
        "Your request for {amount} was approved and will be paid soon.",
        True,
    ),
    (
        "payout_request_rejected",
        "Payout request declined",
        "Your request for {amount} was declined: {reason}",
        True,
    ),
    ("payout_request_disputed", "Payout on hold", "Your payout of {amount} is on hold: {reason}", True),
    (
        "payout_account_verified",
        "Payout details verified",
        "Your {method} payout details were checked. Payouts can now be sent.",
        True,
    ),
    (
        "commission_changed",
        "Your commission has changed",
        "From now on you keep {rate} of each marketplace sale. Past earnings don't change.",
        True,
    ),
    (
        "permissions_changed",
        "Your teaching permissions changed",
        "Staff updated what you can do in the studio. Open the studio to see the details.",
        True,
    ),
    (
        "instructor_suspended",
        "Your teaching account is suspended",
        "Studio access is paused: {reason}. Your courses stay available to learners.",
        True,
    ),
    (
        "instructor_reactivated",
        "Your teaching account is active again",
        "You can use the studio again.",
        True,
    ),
    ("company_created", "Welcome to {platform}, {company}", "Your company workspace is ready.", True),
    ("company_seats_changed", "Seats updated for {company}", "Your seat limit is now {seats}.", True),
    (
        "company_suspended",
        "{company} is suspended",
        "Your company workspace is suspended. Contact us for help.",
        True,
    ),
    ("company_reactivated", "{company} is active again", "Your company workspace is active.", True),
    ("addon_enabled", "{addon} switched on", "{addon} is now on for {company}.", True),
    ("addon_disabled", "{addon} switched off", "{addon} is now off for {company}.", True),
    (
        "company_payment_failed",
        "Payment failed for {company}",
        "We couldn't take the payment for your {plan}. Update the card in billing.",
        True,
    ),
    ("staff_instructor_application", "New instructor application", "{name} applied to teach.", False),
    (
        "staff_course_submitted",
        "Course submitted for review",
        '"{course}" by {name} is waiting for review.',
        False,
    ),
    (
        "staff_template_submitted",
        "Certificate template submitted",
        '"{template}" by {name} is waiting for approval.',
        False,
    ),
    ("staff_ticket_new", "New support request ({reference})", '{name}: "{subject}"', False),
    ("staff_ticket_reply", "Reply on {reference}", '{name} replied to "{subject}".', False),
    ("staff_content_reported", "Content reported", "A {kind} on {course} was reported: {reason}", False),
    ("staff_self_refund", "Learner refund", "{name} refunded {course} ({amount}).", False),
    ("staff_payout_request", "Payout request received", "{name} asked for {amount}.", False),
    ("staff_payout_due", "Payouts due", "{count} payouts are due on {date}.", True),
    ("staff_health_alert", "Health alert: {service}", "{service} needs attention: {detail}", True),
    ("staff_fx_failed", "Exchange rates not refreshed", "The daily rate refresh failed: {detail}", True),
]


def insert(apps, schema_editor):
    Template = apps.get_model("engagement", "NotificationTemplate")
    db = schema_editor.connection.alias
    for code, title, body, email in TEMPLATES:
        Template.objects.using(db).get_or_create(
            code=code, defaults={"title": title, "body": body, "email_enabled": email}
        )


class Migration(migrations.Migration):
    dependencies = [("engagement", "0006_console")]

    operations = [migrations.RunPython(insert, migrations.RunPython.noop)]
