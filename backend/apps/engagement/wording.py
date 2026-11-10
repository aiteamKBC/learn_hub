"""Every notification code: its default wording, who receives it and sample values.

Staff edit the wording in the console (Communications > Notification templates). The
placeholders in the default wording are the ones the code fills in, so an edit must keep
all of them and may not add unknown ones (`check`). `{platform}` is always available.
Migrations insert these defaults (insert only); this module is what the console checks
against and previews with.
"""

import re

from core.errors import ServiceError

PLACEHOLDER = re.compile(r"\{([a-z_]{1,40})\}")
ALWAYS = {"platform"}

# code: (audience, title, body, email by default, sample values for the preview)
DEFAULTS: dict[str, tuple[str, str, str, bool, dict]] = {
    # ------------------------------------------------ learners
    "question_posted": ("instructor", "New question in {course}", 'A learner asked: "{title}"', True,
                        {"course": "Python for Beginners", "title": "How do I install Python?"}),
    "answer_posted": ("learner", "New answer to your question", 'Someone answered "{title}" in {course}.', True,
                      {"course": "Python for Beginners", "title": "How do I install Python?"}),
    "review_reply": ("learner", "The instructor replied to your review", "Your review of {course} has a reply.", True,
                     {"course": "Python for Beginners"}),
    "announcement": ("learner", "{course}: {title}", "Your instructor posted an announcement.", True,
                     {"course": "Python for Beginners", "title": "New lesson added"}),
    "badge_awarded": ("learner", "You earned a badge: {badge}", "Well done! See all your achievements.", False,
                      {"badge": "First course"}),
    "ticket_reply": ("learner", "Support replied ({reference})", 'There is a new reply on "{subject}".', True,
                     {"reference": "LH-482913", "subject": "Can't open my course"}),
    "certificate_issued": ("learner", "Your certificate for {course}", "Congratulations on completing {course}.",
                           True, {"course": "Python for Beginners"}),
    "course_assigned": ("learner", "New training: {course}", "{company} has assigned you this course.", True,
                        {"course": "Fire safety", "company": "Acme Ltd"}),
    "work_marked": ("learner", "Your work has been marked", '"{title}" in {course} has a score and feedback.', True,
                    {"title": "Final project", "course": "Python for Beginners"}),
    "order_receipt": ("learner", "Receipt for your order", "Thanks for buying {items}. Total paid: {amount}.", True,
                      {"items": "Python for Beginners", "amount": "£44.99"}),
    "refund_issued": ("learner", "Refund issued", "We refunded {amount} for {course}. Your access to it has ended.",
                      True, {"amount": "£44.99", "course": "Python for Beginners"}),
    "subscription_started": ("learner", "Welcome to {plan}", "Your subscription has started.", True,
                             {"plan": "Personal plan"}),
    "subscription_renewed": ("learner", "{plan} renewed", "Your subscription renewed until {date}.", True,
                             {"plan": "Personal plan", "date": "7 Dec 2026"}),
    "subscription_cancelled": ("learner", "{plan} cancelled", "Your subscription won't renew. You keep access until {date}.",
                               True, {"plan": "Personal plan", "date": "7 Dec 2026"}),
    "subscription_payment_failed": ("learner", "Payment failed for {plan}",
                                    "We couldn't take your payment. Update your card to keep access.", True,
                                    {"plan": "Personal plan"}),
    "order_payment_failed": ("learner", "Payment didn't go through",
                             "Your payment for {items} failed, so the order wasn't completed. You can buy it again at any time.",
                             True, {"items": "Python for Beginners"}),
    "subscription_paused": ("learner", "{plan} paused",
                            "Your subscription is paused. Courses from it are locked until it resumes.", True,
                            {"plan": "Personal plan"}),
    "subscription_resumed": ("learner", "{plan} resumed", "Your subscription is active again.", True,
                             {"plan": "Personal plan"}),
    "subscription_trial_ending": ("learner", "Your {plan} trial ends soon",
                                  "Your free trial ends on {date}. Your subscription starts then unless you cancel.",
                                  True, {"plan": "Personal plan", "date": "7 Dec 2026"}),
    "ticket_opened": ("learner", "We've got your request ({reference})",
                      'Thanks for contacting us about "{subject}". We will reply soon.', True,
                      {"reference": "LH-482913", "subject": "Can't open my course"}),
    "ticket_resolved": ("learner", "Request resolved ({reference})",
                        'We marked "{subject}" as resolved. Reply if you still need help.', True,
                        {"reference": "LH-482913", "subject": "Can't open my course"}),
    "content_hidden": ("learner", "Your {kind} was hidden", "Our moderators hid your {kind} on {course}: {reason}", True,
                       {"kind": "review", "course": "Python for Beginners", "reason": "Personal details shared"}),
    "report_handled": ("learner", "Thanks for your report", "We looked at the {kind} you reported and {outcome}.", False,
                       {"kind": "review", "outcome": "hid it"}),
    "certificate_revoked": ("learner", "Certificate revoked: {course}", "Your certificate for {course} was revoked: {reason}",
                            True, {"course": "Fire safety", "reason": "Issued by mistake"}),
    "certificate_expiring": ("learner", "Certificate expiring soon: {course}",
                             "Your certificate for {course} expires on {date}.", True,
                             {"course": "Fire safety", "date": "7 Dec 2026"}),
    "account_suspended": ("learner", "Your account is suspended",
                          "Your {platform} account has been suspended. Contact support if you think this is a mistake.",
                          True, {}),
    "account_reactivated": ("learner", "Your account is active again", "You can sign in to {platform} again.", True, {}),
    "staff_access_granted": ("learner", "Security notice: staff access",
                             "Your account was given platform staff access. If you didn't expect this, contact support.",
                             True, {}),
    "mfa_enabled": ("learner", "2-step sign-in turned on", "2-step sign-in is now on for your account.", True, {}),
    "mfa_disabled": ("learner", "2-step sign-in turned off",
                     "2-step sign-in was turned off for your account. If this wasn't you, change your password.", True,
                     {}),
    "broadcast": ("learner", "{title}", "{body}", True, {"title": "New courses this week", "body": "Take a look."}),
    # ------------------------------------------------ instructors
    "instructor_approved": ("instructor", "You're approved to teach on {platform}",
                            "Your instructor application was approved. You can now create courses.", True, {}),
    "instructor_rejected": ("instructor", "Your instructor application",
                            "We couldn't approve your application this time: {reason}", True,
                            {"reason": "Please add more about your teaching experience."}),
    "course_approved": ("instructor", "{course} is live", "Your course was approved and is now on the marketplace.",
                        True, {"course": "Python for Beginners"}),
    "course_changes_requested": ("instructor", "Changes requested for {course}", "A reviewer asked for changes: {notes}",
                                 True, {"course": "Python for Beginners", "notes": "Add a quiz to section 2."}),
    "course_rejected": ("instructor", "{course} was not approved", "A reviewer did not approve the course: {reason}",
                        True, {"course": "Python for Beginners", "reason": "The content is copied."}),
    "course_unpublished": ("instructor", "{course} was unpublished",
                           "Staff took the course off the marketplace: {reason}. Learners who have it keep access.",
                           True, {"course": "Python for Beginners", "reason": "Out-of-date content"}),
    "course_relisted": ("instructor", "{course} is back on the marketplace", "Your course is listed again.", True,
                        {"course": "Python for Beginners"}),
    "new_sale": ("instructor", "New sale: {course}", "Someone bought {course}. You earned {amount}.", False,
                 {"course": "Python for Beginners", "amount": "£16.65"}),
    "new_review": ("instructor", "New review on {course}", "A learner rated {course} {rating} out of 5.", False,
                   {"course": "Python for Beginners", "rating": "5"}),
    "template_approved": ("instructor", "Certificate template approved", '"{template}" can now be used on your courses.',
                          True, {"template": "Modern blue"}),
    "template_rejected": ("instructor", "Certificate template not approved", '"{template}" was not approved: {reason}',
                          True, {"template": "Modern blue", "reason": "The logo is blurry."}),
    "payout_paid": ("instructor", "Payout sent", "Your payout of {amount} is on its way.", True, {"amount": "£420.00"}),
    "payout_request_approved": ("instructor", "Payout request approved",
                                "Your request for {amount} was approved and will be paid soon.", True,
                                {"amount": "£420.00"}),
    "payout_request_rejected": ("instructor", "Payout request declined", "Your request for {amount} was declined: {reason}",
                                True, {"amount": "£420.00", "reason": "Payout details missing"}),
    "payout_request_disputed": ("instructor", "Payout on hold", "Your payout of {amount} is on hold: {reason}", True,
                                {"amount": "£420.00", "reason": "We are checking a refund claim."}),
    "payout_account_verified": ("instructor", "Payout details verified",
                                "Your {method} payout details were checked. Payouts can now be sent.", True,
                                {"method": "PayPal"}),
    "commission_changed": ("instructor", "Your commission has changed",
                           "From now on you keep {rate} of each marketplace sale. Past earnings don't change.", True,
                           {"rate": "70%"}),
    "permissions_changed": ("instructor", "Your teaching permissions changed",
                            "Staff updated what you can do in the studio. Open the studio to see the details.", True, {}),
    "instructor_suspended": ("instructor", "Your teaching account is suspended",
                             "Studio access is paused: {reason}. Your courses stay available to learners.", True,
                             {"reason": "Unpaid refunds"}),
    "instructor_reactivated": ("instructor", "Your teaching account is active again", "You can use the studio again.",
                               True, {}),
    # ------------------------------------------------ company admins
    "company_created": ("company_admin", "Welcome to {platform}, {company}", "Your company workspace is ready.", True,
                        {"company": "Acme Ltd"}),
    "company_seats_changed": ("company_admin", "Seats updated for {company}", "Your seat limit is now {seats}.", True,
                              {"company": "Acme Ltd", "seats": "50"}),
    "company_suspended": ("company_admin", "{company} is suspended",
                          "Your company workspace is suspended. Contact us for help.", True, {"company": "Acme Ltd"}),
    "company_reactivated": ("company_admin", "{company} is active again", "Your company workspace is active.", True,
                            {"company": "Acme Ltd"}),
    "addon_enabled": ("company_admin", "{addon} switched on", "{addon} is now on for {company}.", True,
                      {"addon": "Content protection", "company": "Acme Ltd"}),
    "addon_disabled": ("company_admin", "{addon} switched off", "{addon} is now off for {company}.", True,
                       {"addon": "Content protection", "company": "Acme Ltd"}),
    "company_payment_failed": ("company_admin", "Payment failed for {company}",
                               "We couldn't take the payment for your {plan}. Update the card in billing.", True,
                               {"company": "Acme Ltd", "plan": "Team plan"}),
    # ------------------------------------------------ staff
    "staff_instructor_application": ("staff", "New instructor application", "{name} applied to teach.", False,
                                     {"name": "Sara Mahmoud"}),
    "staff_course_submitted": ("staff", "Course submitted for review", '"{course}" by {name} is waiting for review.',
                               False, {"course": "Python for Beginners", "name": "Sara Mahmoud"}),
    "staff_template_submitted": ("staff", "Certificate template submitted",
                                 '"{template}" by {name} is waiting for approval.', False,
                                 {"template": "Modern blue", "name": "Sara Mahmoud"}),
    "staff_ticket_new": ("staff", "New support request ({reference})", '{name}: "{subject}"', False,
                         {"reference": "LH-482913", "name": "Omar Khaled", "subject": "Can't open my course"}),
    "staff_ticket_reply": ("staff", "Reply on {reference}", '{name} replied to "{subject}".', False,
                           {"reference": "LH-482913", "name": "Omar Khaled", "subject": "Can't open my course"}),
    "staff_content_reported": ("staff", "Content reported", "A {kind} on {course} was reported: {reason}", False,
                               {"kind": "review", "course": "Python for Beginners", "reason": "Spam"}),
    "staff_self_refund": ("staff", "Learner refund", "{name} refunded {course} ({amount}).", False,
                          {"name": "Omar Khaled", "course": "Python for Beginners", "amount": "£44.99"}),
    "staff_payout_request": ("staff", "Payout request received", "{name} asked for {amount}.", False,
                             {"name": "Sara Mahmoud", "amount": "£420.00"}),
    "staff_payout_due": ("staff", "Payouts due", "{count} payouts are due on {date}.", True,
                         {"count": "4", "date": "5 Dec 2026"}),
    "staff_health_alert": ("staff", "Health alert: {service}", "{service} needs attention: {detail}", True,
                           {"service": "Queue", "detail": "3 jobs stuck for over 10 minutes"}),
    "staff_fx_failed": ("staff", "Exchange rates not refreshed", "The daily rate refresh failed: {detail}", True,
                        {"detail": "The ECB feed did not answer."}),
}  # fmt: skip


def placeholders(text: str) -> set[str]:
    return set(PLACEHOLDER.findall(text))


def needed(code: str) -> set[str]:
    """The placeholders this code fills in (from its default wording)."""
    d = DEFAULTS.get(code)
    return (placeholders(d[1]) | placeholders(d[2])) - ALWAYS if d else set()


def check(code: str, title: str, body: str) -> None:
    """Refuse wording that drops a placeholder the code needs or uses one it never fills."""
    if code not in DEFAULTS:
        return
    used = placeholders(title) | placeholders(body)
    unknown = sorted(used - needed(code) - ALWAYS)
    if unknown:
        raise ServiceError(
            "bad_placeholder",
            f"Unknown placeholder: {', '.join('{' + u + '}' for u in unknown)}.",
            details=unknown,
        )
    missing = sorted(needed(code) - used)
    if missing:
        raise ServiceError(
            "missing_placeholder",
            f"Keep {', '.join('{' + m + '}' for m in missing)} in the wording.",
            details=missing,
        )
    braces = re.sub(PLACEHOLDER, "", title + body)
    if "{" in braces or "}" in braces:
        raise ServiceError(
            "bad_placeholder", "A placeholder is misspelled: use {name} with lower-case letters."
        )
