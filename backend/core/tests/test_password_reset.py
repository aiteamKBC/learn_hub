"""Forgot password: the email links to our reset page, the link is checked, the new
password works, and a used link is refused. Unknown addresses get the same answer."""

import re

from allauth.account.models import EmailAddress
from django.conf import settings
from django.core import mail
from django.core.cache import cache

from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

AUTH = "/_allauth/browser/v1/auth"


class PasswordResetTest(SchemaTransactionTestCase):
    def test_reset_from_the_emailed_link(self):
        cache.clear()  # allauth's rate limits
        _, _, sara, _ = f.users()
        EmailAddress.objects.create(user=sara, email=sara.email, verified=True, primary=True)

        r = self.client.post(
            f"{AUTH}/password/request", {"email": "nobody@x.test"}, content_type="application/json"
        )
        self.assertEqual(r.status_code, 200)  # same answer: no account probing

        mail.outbox.clear()
        r = self.client.post(
            f"{AUTH}/password/request", {"email": sara.email}, content_type="application/json"
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        link = re.search(
            rf"{re.escape(settings.FRONTEND_URL)}/account/password/reset/key/(\S+)", mail.outbox[0].body
        )
        self.assertIsNotNone(link, "the email links to the frontend reset page")
        key = link.group(1)

        check = self.client.get(f"{AUTH}/password/reset", HTTP_X_PASSWORD_RESET_KEY=key)
        self.assertEqual(check.status_code, 200)
        bad = self.client.get(f"{AUTH}/password/reset", HTTP_X_PASSWORD_RESET_KEY=key + "x")
        self.assertEqual(bad.status_code, 400)

        new = "Correct-horse-battery-9"
        r = self.client.post(
            f"{AUTH}/password/reset", {"key": key, "password": new}, content_type="application/json"
        )
        self.assertIn(r.status_code, (200, 401))  # changed; 401 = log in with it now
        sara.refresh_from_db()
        self.assertTrue(sara.check_password(new))

        again = self.client.post(f"{AUTH}/password/reset", {"key": key, "password": "Another-pass-77"},
                                 content_type="application/json")  # fmt: skip
        self.assertEqual(again.status_code, 400)  # the link works once
        sara.refresh_from_db()
        self.assertTrue(sara.check_password(new))
