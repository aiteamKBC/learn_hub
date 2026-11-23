"""Browser-only worker for workforce_live_e2e.py; accepts test context over stdin.

Run by the Django harness with system Python. Never imports Django or venv packages,
and refuses non-loopback URLs. Test session cookies are never printed or persisted.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest
from urllib.parse import urlsplit

try:
    from playwright.sync_api import expect, sync_playwright
except ImportError:
    raise SystemExit("Playwright missing from browser Python. Set WORKFORCE_BROWSER_PYTHON to the existing system interpreter.")


class WorkforceBrowser(unittest.TestCase):
    def __init__(self, payload):
        super().__init__()
        self.frontend_url = payload["frontend_url"]
        if urlsplit(self.frontend_url).hostname not in {"localhost", "127.0.0.1"}:
            raise ValueError("Browser worker only accepts a local test frontend URL.")
        self.org_id = payload["org_id"]
        self.policy_id = payload["policy_id"]
        self.session_cookie = payload["session_cookie"]
        self.session_cookie_name = payload["session_cookie_name"]
        self.shots = Path(payload["shots"])
        self.shots.mkdir(parents=True, exist_ok=True)

    def run_journeys(self):
        errors = []
        server_errors = []
        expect.set_options(timeout=30000)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 1100}, reduced_motion="reduce", color_scheme="light")
            context.add_cookies([{"name": self.session_cookie_name, "value": self.session_cookie, "url": self.frontend_url, "httpOnly": True, "sameSite": "Lax"}])
            context.add_init_script("localStorage.setItem('orgId', " + json.dumps(self.org_id) + ");")

            # Browser resources stay local. External Google Fonts CSS is empty in
            # this test; bundled fonts and application assets are served unchanged.
            def resources(route):
                if urlsplit(route.request.url).hostname in {"localhost", "127.0.0.1"}:
                    route.continue_()
                else:
                    route.fulfill(status=200, content_type="text/css" if route.request.resource_type == "stylesheet" else "text/plain", body="")

            context.route("**/*", resources)
            page = context.new_page()
            page.set_default_timeout(45000)
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
            page.on("response", lambda response: server_errors.append(f"{response.status} {urlsplit(response.url).path}") if response.status >= 500 else None)
            def browser_api(path):
                # Use actual HTTP for assertions too: avoid synchronous Django ORM
                # calls inside Playwright's running event loop.
                response = context.request.get(self.frontend_url + "/api/v1" + path, headers={"X-Org-Id": self.org_id})
                self.assertEqual(response.status, 200, f"GET {path}: {response.status}")
                return response.json()

            try:
                page.goto(self.frontend_url + "/learn/hr-profile")
                expect(page.get_by_role("heading", name="My HR profile", exact=True)).to_be_visible(timeout=30000)
                career = page.get_by_label("Where you want your career to go", exact=True)
                expect(career).to_be_visible(timeout=30000)
                career.fill("Lead a delivery team")
                page.get_by_role("button", name="Save changes", exact=True).click()
                expect(page.get_by_text("Your profile is saved", exact=True)).to_be_visible()
                self.assertEqual(browser_api("/hcm/me/profile")["aspiration"], "Lead a delivery team")
                self.capture(page, "01-hr-profile")

                page.goto(self.frontend_url + "/learn/wellbeing")
                page.get_by_role("button", name="Start a check-in", exact=True).click()
                page.get_by_label("Anything you want to add", exact=True).fill("Browser check-in")
                page.get_by_role("button", name="Submit check-in", exact=True).click()
                expect(page.get_by_text("Thank you. Your check-in is saved.", exact=True)).to_be_visible()
                wellbeing = browser_api("/hcm/me/wellbeing")[0]
                self.assertEqual(wellbeing["hope"], 50)
                self.assertEqual(float(wellbeing["stay_intent"]), 0.5)
                self.capture(page, "02-wellbeing")

                page.goto(self.frontend_url + "/learn/cpd")
                page.get_by_role("button", name="Log CPD", exact=True).first.click()
                dialog = page.get_by_role("dialog", name="Log CPD", exact=True)
                dialog.get_by_label("What did you do?", exact=True).fill("Browser accessibility learning")
                dialog.get_by_label("Hours", exact=True).fill("0.25")
                dialog.get_by_role("button", name="Add CPD", exact=True).click()
                expect(page.get_by_text("Browser accessibility learning", exact=True)).to_be_visible()
                self.assertEqual(float(browser_api("/hcm/me/cpd")[0]["hours"]), 0.25)
                self.capture(page, "03-cpd")

                page.goto(self.frontend_url + "/learn/policies")
                page.get_by_role("button", name="Open", exact=True).click()
                dialog = page.get_by_role("dialog", name="Browser safety policy", exact=True)
                expect(dialog.get_by_text("Stop work and tell your supervisor when a hazard is found.", exact=True)).to_be_visible()
                dialog.get_by_role("button", name="Mark as read", exact=True).click()
                expect(dialog.get_by_role("button", name="Read", exact=True)).to_be_disabled()
                dialog.get_by_role("button", name="I acknowledge", exact=True).click()
                expect(dialog.get_by_role("button", name="Acknowledged", exact=True)).to_be_disabled()
                dialog.get_by_label("Stop and report", exact=True).check()
                dialog.get_by_role("button", name="Submit answer", exact=True).click()
                expect(page.get_by_text("Correct — well done", exact=True)).to_be_visible()
                record = next(item for item in browser_api("/governance/me/policies") if item["doc_id"] == self.policy_id)
                self.assertEqual(record["adoption_label"], "Understands")
                self.assertEqual(record["check_score"], 100)
                dialog.get_by_role("button", name="Close", exact=True).click()
                self.capture(page, "04-policies")

                for path, title in [("/learn/hr-profile", "My HR profile"), ("/learn/wellbeing", "Wellbeing check-in"), ("/learn/cpd", "My CPD"), ("/learn/competence", "My competence"), ("/learn/reviews", "My reviews"), ("/learn/policies", "My policies")]:
                    page.goto(self.frontend_url + path)
                    expect(page.get_by_role("heading", name=title, exact=True)).to_be_visible()
                    self.capture(page, "mobile-" + path.rsplit("/", 1)[-1], mobile=True)
                self.assertEqual(server_errors, [], f"Server errors: {server_errors}")
                self.assertEqual(errors, [], f"Browser errors: {errors}")
                print("Workforce live E2E passed: profile, wellbeing, CPD, policy adoption; six mobile routes; no console errors or 5xx.")
            except Exception:
                page.screenshot(path=str(self.shots / "FAILED.png"), full_page=True)
                raise
            finally:
                context.close()
                browser.close()

    def capture(self, page, name, mobile=False):
        if mobile:
            page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_load_state("networkidle", timeout=60000)
        page.screenshot(path=str(self.shots / f"{name}-light.png"), full_page=True)
        overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
        self.assertFalse(overflow, f"Horizontal page overflow: {name}")
        page.evaluate("document.documentElement.classList.add('dark')")
        page.screenshot(path=str(self.shots / f"{name}-dark.png"), full_page=True)
        page.evaluate("document.documentElement.classList.remove('dark')")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    WorkforceBrowser(json.load(sys.stdin)).run_journeys()

