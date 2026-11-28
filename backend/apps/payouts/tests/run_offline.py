"""Run from backend: python -m apps.payouts.tests.run_offline.

No project settings/.env, database, Redis or app-ready integrations are loaded.
This verifies service behavior with mocks, not PostgreSQL/RLS or HTTP integration.
"""

import ast
import importlib
import unittest
from pathlib import Path

import django
from django.apps import AppConfig
from django.conf import settings


def main():
    source = Path(__file__).resolve().parents[3] / "config" / "settings" / "base.py"
    module = ast.parse(source.read_text(encoding="utf-8"))
    domains = next(ast.literal_eval(node.value) for node in module.body if isinstance(node, ast.Assign)
                   and any(isinstance(target, ast.Name) and target.id == "DOMAIN_APPS" for target in node.targets))
    names = ["django.contrib.auth", "django.contrib.contenttypes", "core", *domains]
    settings.configure(
        INSTALLED_APPS=[AppConfig(name, importlib.import_module(name)) for name in names],
        AUTH_USER_MODEL="identity.User", SECRET_KEY="offline-unit-tests", USE_TZ=True,
        DATABASES={"default": {"ENGINE": "django.db.backends.dummy"}},
        CACHES={"default": {"BACKEND": "django.core.cache.backends.dummy.DummyCache"}},
    )
    django.setup()
    suite = unittest.defaultTestLoader.loadTestsFromName("apps.payouts.tests.test_payout_safety")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())


if __name__ == "__main__":
    main()
