"""Run Reports unit tests or generate OpenAPI with no secrets, sockets or databases.

This runner deliberately does not use manage.py or provision a test database.
Database integration tests must be run separately on an authorised isolated DB.
"""

import json
import os
import socket
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings.dev"
# Prevent dotenv reads and external connections even if the parent has credentials.
with (
    patch("dotenv.load_dotenv"),
    patch.dict(
        os.environ,
        {
            "DATABASE_URL": "postgresql://localhost/reports_disabled",
            "DATABASE_URL_OWNER": "postgresql://localhost/reports_disabled",
            "DATABASE_URL_REPLICA": "",
            "REDIS_URL": "",
        },
    ),
):
    import django
    from django.conf import settings

    settings.DATABASES = {"default": {"ENGINE": "django.db.backends.dummy"}}
    settings.DATABASE_ROUTERS = []
    with patch.object(
        socket.socket, "connect", side_effect=AssertionError("Network disabled")
    ):
        django.setup()
        if "--schema" in sys.argv:
            from core.api import api

            (ROOT / "logs" / "reports-openapi.json").write_text(
                json.dumps(api.get_openapi_schema(), default=str), encoding="utf-8"
            )
            print("Generated schema offline; database and network disabled.")
        else:
            suite = unittest.defaultTestLoader.loadTestsFromName(
                "core.tests.test_report_projections"
            )
            result = unittest.TextTestRunner(verbosity=2).run(suite)
            sys.exit(not result.wasSuccessful())
