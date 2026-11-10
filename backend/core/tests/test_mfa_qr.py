"""2-step sign-in set-up: the QR code for the pending key, drawn on the server as SVG."""

import base64

from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

QR = "/api/v1/identity/mfa/totp-qr"
TOTP = "/_allauth/browser/v1/account/authenticators/totp"


class TotpQrTest(SchemaTransactionTestCase):
    def test_qr_for_the_pending_key_only(self):
        _, _, sara, _ = f.users()
        self.assertEqual(self.client.get(QR).status_code, 401)
        self.client.force_login(sara)
        self.assertEqual(self.client.get(QR).status_code, 404)  # set-up not started: no key yet
        offer = self.client.get(TOTP).json()  # allauth offers a key and keeps it in the session
        secret = offer["meta"]["secret"]
        r = self.client.get(QR)
        self.assertEqual(r.status_code, 200)
        image = r.json()["image"]
        self.assertTrue(image.startswith("data:image/svg+xml;base64,"))
        svg = base64.b64decode(image.split(",", 1)[1]).decode()
        self.assertIn("<svg", svg)
        self.assertNotIn(secret, r.content.decode())  # only the picture, never the key as text
