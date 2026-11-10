"""HARNESS ONLY: the real allauth email-confirmation key for an address that has just
signed up through the UI.

    python e2e_verify_key.py <email>   -> prints the key used in /account/verify-email/<key>

`core.mail.SafeConsoleBackend` never logs email bodies (see e2e_wsgi.py), so the E2E
cannot read the confirmation link out of a log. It does not need to: with the default
ACCOUNT_EMAIL_CONFIRMATION_HMAC=True, allauth never stores the key either - it is
`django.core.signing.dumps(email_address.pk, salt=...)`, reproducible from the database
row alone. This recomputes the exact key the real email would have carried; it does not
confirm the address itself (the E2E still does that through the real endpoint)."""

import os
import sys

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
import django  # noqa: E402

django.setup()
from allauth.account.models import EmailAddress, EmailConfirmationHMAC  # noqa: E402

email = sys.argv[1]
addr = EmailAddress.objects.get(email__iexact=email)
print(EmailConfirmationHMAC(addr).key)
