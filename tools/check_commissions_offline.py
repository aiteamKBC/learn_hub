"""Run only the scoped Commissions unit tests with database and network disabled."""

import os
import socket
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings.dev"
with (
    patch("dotenv.load_dotenv"),
    patch.dict(os.environ, {"DATABASE_URL": "postgresql://localhost/disabled", "DATABASE_URL_OWNER": "",
                            "DATABASE_URL_REPLICA": "", "REDIS_URL": ""}),
    patch.object(socket.socket, "connect", side_effect=AssertionError("Network disabled")),
):
    import django
    from django.conf import settings

    settings.DATABASES = {"default": {"ENGINE": "django.db.backends.dummy"}}
    settings.DATABASE_ROUTERS = []
    django.setup()
    suite = unittest.defaultTestLoader.loadTestsFromName("apps.commerce.tests.test_commission_guards")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(not result.wasSuccessful())
