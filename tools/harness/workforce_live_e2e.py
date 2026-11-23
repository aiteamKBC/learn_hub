"""Real-browser workforce smoke journeys against Django's isolated test database.

Run with the backend venv Python (Django); the browser uses system Python:
    backend\\venv\\Scripts\\python.exe tools/harness/workforce_live_e2e.py

Build frontend/dist first. Do not run concurrently with another Django test process
using the same test database. Nothing here targets a running dev server. Django's
DiscoverRunner prepares test_*; SchemaTransactionTestCase cleans only that database.
The browser uses real APIs through a local reverse proxy, never canned responses.
"""

from __future__ import annotations

import http.client
import json
import os
import shutil
import subprocess
from pathlib import Path
import sys
import threading
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
DIST = ROOT / "frontend" / "dist"
SHOTS = ROOT / "shots" / "workforce-live"

sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

import django  # noqa: E402

django.setup()

from allauth.account.models import EmailAddress  # noqa: E402
from django.conf import settings  # noqa: E402
from django.db import connections  # noqa: E402
from django.test import LiveServerTestCase, override_settings  # noqa: E402
from django.test.runner import DiscoverRunner  # noqa: E402
from django.utils import timezone  # noqa: E402

from apps.identity.models import User  # noqa: E402
from apps.org import services as org_services  # noqa: E402
from apps.org.models import OrgMember  # noqa: E402
from core.tenancy import tenant_context  # noqa: E402
from core.tests.base import SchemaTransactionTestCase  # noqa: E402


class WorkforceProxy(SimpleHTTPRequestHandler):
    """Static SPA and actual HTTP reverse proxy; no response data is substituted."""

    protocol_version = "HTTP/1.1"
    backend_url = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def log_message(self, *_args):
        pass

    def _forward(self):
        upstream = urlsplit(self.backend_url)
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else None
        excluded = {"host", "connection", "content-length", "accept-encoding", "origin", "referer"}
        headers = {key: value for key, value in self.headers.items() if key.lower() not in excluded}
        headers["Host"] = upstream.netloc
        headers["Origin"] = self.backend_url
        headers["Referer"] = self.backend_url + "/"
        connection = http.client.HTTPConnection(upstream.hostname, upstream.port, timeout=60)
        try:
            connection.request(self.command, self.path, body=body, headers=headers)
            response = connection.getresponse()
            data = response.read()
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in {"connection", "transfer-encoding", "content-length", "server", "date"}:
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)
        finally:
            connection.close()

    def do_GET(self):
        if self.path.startswith(("/api/", "/_allauth/", "/accounts/")):
            return self._forward()
        target = Path(self.translate_path(urlsplit(self.path).path))
        if not target.is_file() and not Path(urlsplit(self.path).path).suffix:
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        self._forward()

    do_PATCH = do_POST
    do_PUT = do_POST
    do_DELETE = do_POST


class WorkforceHTTPServer(ThreadingHTTPServer):
    request_queue_size = 128


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    SESSION_ENGINE="django.contrib.sessions.backends.db",
    SESSION_COOKIE_SECURE=False,
    CSRF_COOKIE_SECURE=False,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    CELERY_TASK_ALWAYS_EAGER=True,
    CELERY_BROKER_URL="memory://",
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class WorkforceLiveE2E(SchemaTransactionTestCase, LiveServerTestCase):
    databases = {"default", "owner"}
    host = "localhost"

    @classmethod
    def setUpClass(cls):
        # Must precede SchemaTransactionTestCase's TRUNCATE, even on an accidental
        # invocation through a different runner.
        for alias in cls.databases:
            if not str(connections[alias].settings_dict["NAME"]).startswith("test_"):
                raise RuntimeError("Refusing browser test outside a test_* database.")
        if not (DIST / "index.html").is_file():
            raise RuntimeError("frontend/dist is missing. Run the frontend production build first.")
        super().setUpClass()
        SHOTS.mkdir(parents=True, exist_ok=True)
        handler = type("BoundWorkforceProxy", (WorkforceProxy,), {"backend_url": cls.live_server_url})
        cls.frontend_server = WorkforceHTTPServer(("localhost", 0), handler)
        cls.frontend_server.daemon_threads = True
        cls.frontend_thread = threading.Thread(target=cls.frontend_server.serve_forever, daemon=True)
        cls.frontend_thread.start()
        cls.addClassCleanup(cls.stop_frontend)
        cls.frontend_url = f"http://localhost:{cls.frontend_server.server_port}"

    @classmethod
    def stop_frontend(cls):
        cls.frontend_server.shutdown()
        cls.frontend_server.server_close()
        cls.frontend_thread.join(timeout=5)

    def setUp(self):
        suffix = uuid.uuid4().hex[:8]
        self.owner = User.objects.create_user(f"owner-{suffix}@example.test", "test-only", full_name="Workforce Owner")
        self.employee = User.objects.create_user(f"member-{suffix}@example.test", "test-only", full_name="Workforce Employee")
        for user in (self.owner, self.employee):
            EmailAddress.objects.create(user=user, email=user.email, verified=True, primary=True)
        self.org = org_services.create_organization(name="Workforce Browser Test", slug=f"workforce-{suffix}", owner=self.owner)
        with tenant_context(org_id=self.org.id, user_id=self.owner.id):
            self.member = OrgMember.objects.create(org=self.org, user=self.employee, joined_at=timezone.now())
        self.headers = {"HTTP_X_ORG_ID": str(self.org.id)}
        # Deliberately no MemberProfile backfill: the real GET must handle a newly
        # added member. Policy setup uses the production API and legacy tuple shape.
        self.client.force_login(self.owner)
        policy = self.api("post", "/governance/policies", {"code": "LIVE-SAFE", "title": "Browser safety policy", "doc_type": "policy"})
        self.policy_id = policy["id"]
        version = self.api("get", f"/governance/policies/{self.policy_id}/versions")[0]
        self.api("patch", f"/governance/policy-versions/{version['id']}", {
            "summary": "A real policy prepared for isolated browser verification.",
            "sections": [["Safe working", ["Stop work and tell your supervisor when a hazard is found."]]],
            "understanding_check": {"q": "What should you do when you find a hazard?", "options": ["Continue working", "Stop and report"], "answer": 1},
        })
        self.api("post", f"/governance/policy-versions/{version['id']}/approve")
        self.api("put", f"/governance/policies/{self.policy_id}/allocation", {"scope": "org", "require_reack": True})
        self.client.force_login(self.employee)
        self.session_cookie = self.client.cookies[settings.SESSION_COOKIE_NAME].value

    def api(self, method, path, data=None):
        kwargs = dict(self.headers)
        if method != "get":
            kwargs.update(data=json.dumps(data or {}), content_type="application/json")
        response = getattr(self.client, method)("/api/v1" + path, **kwargs)
        self.assertEqual(response.status_code, 200, f"{method.upper()} {path}: {response.status_code}")
        return response.json()

    def test_employee_workforce_journeys(self):
        browser_python = os.environ.get("WORKFORCE_BROWSER_PYTHON") or shutil.which("python")
        if not browser_python:
            self.fail("System Python with Playwright was not found. Set WORKFORCE_BROWSER_PYTHON.")
        payload = {
            "frontend_url": self.frontend_url,
            "org_id": str(self.org.id),
            "policy_id": self.policy_id,
            "session_cookie": self.session_cookie,
            "session_cookie_name": settings.SESSION_COOKIE_NAME,
            "shots": str(SHOTS),
        }
        # Ephemeral test session travels through stdin only; no token is logged or saved.
        subprocess.run(
            [browser_python, str(ROOT / "tools" / "harness" / "workforce_live_browser.py")],
            input=json.dumps(payload), text=True, check=True, timeout=300, cwd=ROOT,
        )


def main():
    # Keep the project's configured app-role/default -> owner test mirror intact.
    test_name = connections["owner"].creation._get_test_db_name()
    if not str(test_name).startswith("test_"):
        raise SystemExit("Refusing unsafe test database name; it must start with test_.")
    runner = DiscoverRunner(verbosity=1, interactive=False, keepdb=True)
    return runner.run_tests(["__main__.WorkforceLiveE2E"])


if __name__ == "__main__":
    raise SystemExit(main())
