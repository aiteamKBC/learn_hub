"""Browser UI contract smoke, NOT live-backend E2E.

Run with a Python installation containing Playwright after `npm run build` and
`tools/dump_openapi.py`. Serves only frontend/dist on loopback; every API response
is a deterministic test fixture generated from the actual OpenAPI response schema.
No application data, authentication session or database is accessed or modified.
Microsoft Edge's installed browser is used; no browser/package install is needed.
"""

from __future__ import annotations

import argparse
import functools
import json
import re
import threading
from datetime import UTC, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
ID = "00000000-0000-4000-8000-000000000001"
NOW = datetime.now(UTC)
STAMP = NOW.isoformat()
ROUTES = [
    "/console/workforce",
    "/business/hcm/people",
    f"/business/hcm/people/{ID}",
    "/business/hcm/qualifications",
    "/business/frameworks/competencies",
    "/business/frameworks/roles",
    f"/business/frameworks/roles/{ID}",
    f"/business/frameworks/versions/{ID}",
    "/business/frameworks/maturity",
    "/business/pms/kpis",
    "/business/pms/proposals",
    "/business/pms/cycles",
    f"/business/pms/cycles/{ID}",
    f"/business/pms/reviews/{ID}",
    "/business/governance/strategies",
    f"/business/governance/strategies/{ID}",
    "/business/governance/policies",
    f"/business/governance/policies/{ID}",
    "/business/governance/questions",
    "/learn/hr-profile",
    "/learn/wellbeing",
    "/learn/cpd",
    "/learn/competence",
    "/learn/reviews",
    "/learn/policies",
]


class StaticApp(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if not Path(self.translate_path(urlsplit(self.path).path)).is_file():
            self.path = "/index.html"
        super().do_GET()


class StaticServer(ThreadingHTTPServer):
    # Browser reloads request many lazy chunks concurrently. Windows can reject
    # connections beyond HTTPServer's default backlog of five during a sweep.
    request_queue_size = 128
    daemon_threads = True


class Fixtures:
    """Schema-shaped examples, deliberately confined to this test-only harness."""

    def __init__(self, schema):
        self.schema = schema
        self.requests = []
        self.platform_access_requests = []
        self.missing = []
        self.role = "owner"
        self.memberships = 1
        self.policy_read = False
        self.policy_ack = False
        self.policy_score = None
        self.course_level = 3
        self.cpd_hours = "12.50"

    def sample(self, node, name="", depth=0):
        if depth > 9:
            return None
        if "$ref" in node:
            ref = node["$ref"].rsplit("/", 1)[-1]
            value = self.sample(
                self.schema["components"]["schemas"][ref], ref, depth + 1
            )
            return self.custom(ref, value)
        for branch in ("anyOf", "oneOf", "allOf"):
            if branch in node:
                choices = [item for item in node[branch] if item.get("type") != "null"]
                return self.sample(choices[0], name, depth + 1) if choices else None
        kind = node.get("type")
        if kind == "object" or "properties" in node:
            return {
                key: self.sample(value, key, depth + 1)
                for key, value in node.get("properties", {}).items()
            }
        if kind == "array":
            if (
                name
                in (
                    "items",
                    "memberships",
                    "dimensions",
                    "criteria",
                    "requirements",
                    "objectives",
                )
                or depth == 0
            ):
                return [self.sample(node.get("items", {}), "item", depth + 1)]
            return []
        if node.get("enum"):
            return node["enum"][0]
        if "default" in node and node["default"] is not None:
            return node["default"]
        if kind == "boolean":
            return False
        if kind in ("number", "integer"):
            return max(node.get("minimum", 1), 1)
        if kind == "null":
            return None
        if node.get("format") == "uuid" or name.endswith("_id") or name == "id":
            return ID
        if node.get("format") == "date-time" or name.endswith("_at"):
            return STAMP
        if node.get("format") == "date" or name.endswith(("_date", "_on")):
            return NOW.date().isoformat()
        if kind == "string":
            return {
                "email": "fixture.employee@example.test",
                "full_name": "Fixture Employee",
                "name": "Fixture example",
                "title": "Fixture example",
                "code": "FIX-01",
                "timezone": "Europe/London",
                "country": "GB",
                "currency": "GBP",
                "preferred_currency": "GBP",
                "status": "draft",
                "kind": "S",
                "cadence": "monthly",
                "priority": "essential",
                "track": "ic",
            }.get(name, "")
        return {}

    def custom(self, ref, value):
        if not isinstance(value, dict):
            return value
        if ref == "MembershipOut":
            value.update(org_id=ID, name="Fixture Company", role=self.role)
        elif ref == "MeOut":
            memberships = []
            for index in range(self.memberships):
                membership = self.custom(
                    "MembershipOut", {"slug": f"fixture-company-{index + 1}"}
                )
                membership["org_id"] = (
                    ID if index == 0 else "00000000-0000-4000-8000-000000000002"
                )
                membership["name"] = f"Fixture Company {index + 1}"
                memberships.append(membership)
            value.update(
                full_name="Fixture Employee",
                is_staff=True,
                is_instructor=False,
                memberships=memberships,
            )
        elif ref == "ConsoleCompanyOut":
            value.update(
                id=ID,
                name="Fixture Company",
                slug="fixture-company",
                status="active",
                members=42,
                admins=2,
            )
        elif ref == "OrgOut":
            value.update(
                name="Fixture Company", primary_color="", accent_color="", logo_url=""
            )
        elif ref in ("PersonOut", "PersonRow", "PersonSummary"):
            value.update(
                member_id=ID,
                name="Fixture Employee",
                email="fixture.employee@example.test",
                role=self.role,
                units=["Operations"],
            )
        elif ref == "PersonPage":
            value["next_cursor"] = None
        elif ref == "ProfileOut":
            value.update(
                member_id=ID,
                full_name="Fixture Employee",
                email="fixture.employee@example.test",
                role=self.role,
                level=2,
                cpd_hours_cached=self.cpd_hours,
                stay_intent="0.75",
                satisfaction="0.75",
                line_manager_id=None,
                line_manager_name=None,
                termination_date=None,
            )
        elif ref == "CpdOut":
            value.update(
                title="Short professional development activity",
                provider="Fixture provider",
                kind="external",
                hours=self.cpd_hours,
                verified=False,
                verified_at=None,
            )
        elif ref == "WellbeingOut":
            value.update(
                hope=75,
                efficacy=75,
                resilience=50,
                optimism=75,
                overall=75,
                stay_intent="0.75",
                satisfaction="0.75",
            )
        elif ref == "FwCompetencyOut":
            value.update(
                name="Safe working",
                code="SAFE",
                kind="S",
                is_platform=False,
                archived=False,
            )
        elif ref == "FwCourseTagOut":
            value.update(
                competency_code="SAFE",
                competency_name="Safe working",
                target_level=self.course_level,
                weight=5,
            )
        elif ref == "FwRoleOut":
            value.update(
                title="Site supervisor",
                level=2,
                approved_version_number=1,
                latest_version_number=1,
                approved_version_id=ID,
                latest_version_id=ID,
            )
        elif ref == "FwVersionOut":
            value.update(
                status="draft", number=1, required_hours=10, recommended_hours=15
            )
        elif ref == "FwRequirementOut":
            value.update(
                kind="skill", text="Work safely", level=3, priority="essential"
            )
        elif ref == "FwMaturityFrameworkOut":
            value.update(
                title="Operations maturity",
                published_version_id=ID,
                dept="Operations",
                kind="maturity",
            )
        elif ref == "FwMaturityVersionOut":
            value.update(status="published", title="Operations maturity", number=1)
        elif ref == "FwMaturityCriterionOut":
            value.update(
                question="How consistently is work inspected?",
                practice="Inspection",
                anchors=["Never", "Rarely", "Sometimes", "Usually", "Always"],
            )
        elif ref == "FwCampaignOut":
            value.update(
                dept="Operations",
                starts_at=(NOW - timedelta(days=1)).isoformat(),
                ends_at=(NOW + timedelta(days=7)).isoformat(),
                closed_at=None,
                quarter=4,
                quarter_year=2026,
            )
        elif ref == "FwReadinessOut":
            value.update(competence_score=65, qualifications_met=False, ready=False)
        elif ref == "PmsKpiOut":
            value.update(
                name="Safe inspections",
                status="active",
                attainment=75,
                target="100",
                baseline="0",
                latest_value="75",
                cadence="monthly",
            )
        elif ref == "PmsProposalOut":
            value.update(
                name="Safety proposal",
                stage="draft",
                cadence="monthly",
                version=1,
                baseline="0",
                target="100",
            )
        elif ref == "PmsCycleOut":
            value.update(
                name="Quarterly reviews",
                status="open",
                quarter=4,
                year=2026,
                closed_at=None,
            )
        elif ref == "PmsReviewOut":
            value.update(
                status="submitted",
                overall_rating=4,
                acknowledged_at=None,
                manager_summary="Consistent quality and safe working.",
                competence_score="75",
                kpi_score="80",
                wellbeing_score="75",
            )
        elif ref == "PmsAnalysisOut":
            value.update(
                status="ok",
                model_id="heuristic",
                summary="Fixture analysis for browser layout verification.",
                strengths=["Safe working"],
                development=["Documentation"],
                suggested_actions=["Practise inspection records"],
            )
        elif ref == "GovStrategyOut":
            value.update(
                name="Company strategy", archived=False, latest_version_number=1
            )
        elif ref == "GovStrategyVersionOut":
            value.update(
                number=1,
                status="draft",
                vision="Deliver safe and effective work.",
                mission="Develop capable teams.",
                values=["Quality", "Care"],
            )
        elif ref == "GovPolicyOut":
            value.update(
                title="Safety policy",
                code="SAFE-01",
                doc_type="policy",
                status="approved",
                current_version=1,
                archived=False,
            )
        elif ref == "GovPolicyVersionOut":
            value.update(
                number=1,
                status="approved",
                summary="Published safety guidance",
                sections=[["Procedure", ["Stop and report hazards."]]],
                understanding_check={
                    "q": "What should you do?",
                    "options": ["Continue", "Stop and report"],
                },
            )
        elif ref == "GovPolicyContentOut":
            value.update(
                code="SAFE-01",
                title="Safety policy",
                doc_type="policy",
                current_version=1,
                require_reack=True,
            )
        elif ref == "GovRecordOut":
            value.update(
                policy_title="Safety policy",
                policy_code="SAFE-01",
                current_version=1,
                version=1,
                read_at=STAMP if self.policy_read else None,
                ack_at=STAMP if self.policy_ack else None,
                check_at=STAMP if self.policy_score is not None else None,
                check_score=self.policy_score,
                adoption_stage=2
                if self.policy_score == 100 and self.policy_ack
                else 1
                if self.policy_ack
                else 0,
                adoption_label="Understands"
                if self.policy_score == 100
                else "Not started",
                needs_reack=False,
            )
        elif ref == "GovAllocationOut":
            value.update(scope="org", require_reack=True, published_version=1)
        elif ref == "GovQuestionOut":
            value.update(
                q_type="mcq",
                prompt="How do you work safely?",
                options=["Ignore", "Report"],
                answer_index=1,
                level=2,
                mark=1,
                archived=False,
            )
        elif ref == "CurrencyOut":
            value.update(code="GBP", symbol="£", name="British pound", decimals=2)
        return value

    def handle(self, route):
        request = route.request
        path = urlsplit(request.url).path
        if request.headers.get("x-platform-org-access") == "on":
            self.platform_access_requests.append(path)
        if path.startswith("/_allauth/"):
            return route.fulfill(
                json={"status": 200, "data": {}, "meta": {"is_authenticated": True}}
            )
        if path == "/api/v1/platform/settings":
            return route.fulfill(json={})
        if path == "/api/v1/platform/banner":
            return route.fulfill(json=None)
        if request.method != "GET":
            body = request.post_data_json or {}
            if "/frameworks/courses/" in path and path.endswith("/competencies"):
                self.course_level = body.get("target_level", self.course_level)
            self.requests.append(
                {
                    "method": request.method,
                    "path": path,
                    "body": body,
                    "org": request.headers.get("x-org-id"),
                }
            )
            if path.endswith("/read"):
                self.policy_read = True
            if path.endswith("/acknowledge"):
                self.policy_ack = True
            if path.endswith("/check"):
                self.policy_score = 100 if body.get("answer_index") == 1 else 0
        for template, operations in self.schema["paths"].items():
            if not re.fullmatch(re.sub(r"\{[^}]+\}", "[^/]+", template), path):
                continue
            operation = operations.get(request.method.lower())
            if not operation:
                continue
            shape = (
                operation.get("responses", {})
                .get("200", {})
                .get("content", {})
                .get("application/json", {})
                .get("schema", {})
            )
            value = self.sample(shape)
            if request.method != "GET" and isinstance(value, dict):
                value.update(
                    {
                        k: v
                        for k, v in (request.post_data_json or {}).items()
                        if k in value
                    }
                )
            return route.fulfill(json=value)
        self.missing.append({"method": request.method, "path": path})
        return route.fulfill(
            status=501,
            json={
                "error": {"message": "Missing test fixture", "code": "fixture_missing"}
            },
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="shots/workforce-ui")
    parser.add_argument(
        "--interactions-only",
        action="store_true",
        help="Repeat focused checks without recapturing 96 pages",
    )
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    schema = json.loads((ROOT / "logs/openapi.json").read_text(encoding="utf-8"))
    fixtures = Fixtures(schema)
    handler = functools.partial(StaticApp, directory=str(ROOT / "frontend/dist"))
    server = StaticServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    report = {
        "kind": "UI contract smoke with deterministic test fixtures; NOT live E2E",
        "pages": [],
        "interactions": [],
        "errors": [],
        "failed_requests": [],
    }
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            context = browser.new_context(
                viewport={"width": 1440, "height": 1000}, reduced_motion="reduce"
            )
            context.add_init_script(
                f"localStorage.setItem('theme','light');localStorage.setItem('orgId',{json.dumps(ID)});"
            )
            context.route("**/api/**", fixtures.handle)
            context.route("**/_allauth/**", fixtures.handle)
            context.route(
                re.compile(r"^https://"),
                lambda route: route.fulfill(status=200, body=""),
            )
            page = context.new_page()
            page.on("pageerror", lambda error: report["errors"].append(str(error)))
            page.on(
                "requestfailed",
                lambda request: report["failed_requests"].append(
                    {"url": request.url, "failure": request.failure, "page": page.url}
                ),
            )
            page.on(
                "console",
                lambda message: (
                    report["errors"].append(message.text)
                    if message.type == "error"
                    else None
                ),
            )
            for theme in () if args.interactions_only else ("light", "dark"):
                for width in (1440, 375):
                    page.set_viewport_size(
                        {"width": width, "height": 1000 if width == 1440 else 812}
                    )
                    context.add_init_script(
                        f"localStorage.setItem('theme',{json.dumps(theme)});localStorage.setItem('orgId',{json.dumps(ID)});"
                    )
                    for path in ROUTES:
                        label = path.replace("/", "_") + f"-{theme}-{width}"
                        try:
                            page.goto(origin + path, wait_until="networkidle")
                            expect(page.locator("h1").first).to_be_visible(
                                timeout=15000
                            )
                            expect(page.locator("html")).to_have_class(
                                re.compile("dark")
                                if theme == "dark"
                                else re.compile(r"^(?!.*dark).*$")
                            )
                            overflow = page.evaluate(
                                "document.documentElement.scrollWidth > innerWidth + 1"
                            )
                            if overflow:
                                report["errors"].append(
                                    f"OVERFLOW {path} {theme} {width}"
                                )
                            page.screenshot(
                                path=str(output / f"{label}.png"), full_page=True
                            )
                            report["pages"].append(
                                {
                                    "path": path,
                                    "theme": theme,
                                    "width": width,
                                    "overflow": overflow,
                                }
                            )
                        except Exception as error:  # noqa: BLE001 - collect every independent browser case
                            report["errors"].append(f"{label}: {error}")

            # Focused form and navigation checks use test fixtures only.
            page.set_viewport_size({"width": 1440, "height": 1000})

            def interaction(name, action):
                try:
                    action()
                    report["interactions"].append({"name": name, "passed": True})
                except Exception as error:  # noqa: BLE001 - keep reporting subsequent independent checks
                    report["errors"].append(f"{name}: {error}")
                    report["interactions"].append({"name": name, "passed": False})

            def wellbeing():
                page.goto(origin + "/learn/wellbeing", wait_until="networkidle")
                page.get_by_role("button", name="Start a check-in").click()
                page.get_by_label("Hope", exact=True).click()
                page.get_by_role("option", name="5 — High", exact=True).click()
                page.get_by_role("button", name="Submit check-in").click()
                expect(
                    page.get_by_text("Thank you. Your check-in is saved.", exact=True)
                ).to_be_visible()
                request = next(
                    r
                    for r in reversed(fixtures.requests)
                    if r["path"].endswith("/hcm/me/wellbeing")
                )
                assert (
                    request["body"]["hope"] == 100
                    and request["body"]["stay_intent"] == 0.5
                ), request
                assert request["org"] == ID, request

            interaction("Wellbeing converted payload and company context", wellbeing)

            def policy():
                page.goto(origin + "/learn/policies", wait_until="networkidle")
                page.get_by_role("button", name="Open", exact=True).click()
                dialog = page.get_by_role("dialog")
                expect(
                    dialog.get_by_text("Stop and report hazards.", exact=True)
                ).to_be_visible()
                dialog.get_by_role("button", name="Mark as read", exact=True).click()
                dialog.get_by_role("button", name="I acknowledge", exact=True).click()
                dialog.get_by_role("radio", name="Stop and report", exact=True).check()
                dialog.get_by_role("button", name="Submit answer", exact=True).click()
                expect(
                    page.get_by_text("Correct — well done", exact=True)
                ).to_be_visible()
                assert (
                    fixtures.policy_read
                    and fixtures.policy_ack
                    and fixtures.policy_score == 100
                )

            interaction(
                "Policy current content, read, acknowledgement and check", policy
            )

            def proposal():
                page.goto(origin + "/business/pms/proposals", wait_until="networkidle")
                page.get_by_role("button", name="New proposal", exact=True).click()
                dialog = page.get_by_role("dialog")
                dialog.get_by_label("Name", exact=True).fill("Fixture inspection KPI")
                dialog.get_by_label("Cadence", exact=True).click()
                page.get_by_role("option", name="Weekly", exact=True).click()
                dialog.get_by_role("button", name="Create draft", exact=True).click()
                expect(
                    page.get_by_text("Proposal created as a draft", exact=True)
                ).to_be_visible()
                request = next(
                    r
                    for r in reversed(fixtures.requests)
                    if r["path"].endswith("/pms/kpis/proposals")
                )
                assert request["body"]["cadence"] == "weekly", request

            interaction("KPI proposal valid weekly cadence", proposal)

            def course_mapping():
                page.goto(origin + "/business/library", wait_until="networkidle")
                page.get_by_role("button", name="Progress", exact=True).first.click()
                dialog = page.get_by_role("dialog")
                expect(
                    dialog.get_by_role(
                        "heading", name="Competency evidence", exact=True
                    )
                ).to_be_visible()
                dialog.get_by_role("button", name="Edit", exact=True).click()
                dialog.get_by_label("Evidenced level (1–5)", exact=True).fill("4")
                dialog.get_by_role("button", name="Save competency", exact=True).click()
                expect(
                    page.get_by_text("Course competency saved", exact=True)
                ).to_be_visible()
                expect(dialog.get_by_text("Level 4", exact=True)).to_be_visible()
                request = next(
                    item
                    for item in reversed(fixtures.requests)
                    if "/frameworks/courses/" in item["path"]
                )
                assert request["body"]["target_level"] == 4, request
                for width in (1440, 375):
                    page.set_viewport_size(
                        {"width": width, "height": 1000 if width == 1440 else 812}
                    )
                    for theme in ("light", "dark"):
                        page.evaluate(
                            "document.documentElement.classList.toggle('dark', "
                            + json.dumps(theme == "dark")
                            + ")"
                        )
                        page.screenshot(
                            path=str(
                                output / f"library-course-mapping-{theme}-{width}.png"
                            ),
                            full_page=True,
                        )
                        assert not page.evaluate(
                            "document.documentElement.scrollWidth > innerWidth + 1"
                        ), "Course mapping page overflows"
                page.set_viewport_size({"width": 1440, "height": 1000})

            interaction("Company library course competency mapping", course_mapping)

            def platform_workforce_entry():
                page.goto(origin + "/console/workforce", wait_until="networkidle")
                expect(page.get_by_role("heading", name="Workforce", exact=True)).to_be_visible()
                page.get_by_role("button", name="Open workforce workspace", exact=True).click()
                page.wait_for_url(origin + "/business")
                expect(page.get_by_text("Admin · Workforce", exact=True)).to_be_visible()
                selected = page.evaluate("JSON.parse(localStorage.getItem('staffOrgWorkspace'))")
                assert selected["org_id"] == ID, selected
                assert "/api/v1/org/company" in fixtures.platform_access_requests

            interaction(
                "Platform admin chooses company and enters workforce workspace",
                platform_workforce_entry,
            )

            def fractional_cpd():
                fixtures.cpd_hours = "0.25"
                page.goto(origin + "/learn/cpd", wait_until="networkidle")
                card = page.get_by_text("Hours logged", exact=True).locator("../..")
                expect(card.locator("p.tabular span[aria-hidden]")).to_have_text("0.25")
                expect(card.locator("p.tabular .sr-only")).to_have_text("0.25")
                for width in (1440, 375):
                    page.set_viewport_size(
                        {"width": width, "height": 1000 if width == 1440 else 812}
                    )
                    for theme in ("light", "dark"):
                        page.evaluate(
                            "document.documentElement.classList.toggle('dark', "
                            + json.dumps(theme == "dark")
                            + ")"
                        )
                        expect(card.locator("p.tabular span[aria-hidden]")).to_have_text("0.25")
                        assert not page.evaluate(
                            "document.documentElement.scrollWidth > innerWidth + 1"
                        ), "Fractional CPD page overflows"
                        page.screenshot(
                            path=str(output / f"fractional-cpd-{theme}-{width}.png"),
                            full_page=True,
                        )
                fixtures.cpd_hours = "12.50"

            interaction(
                "Fractional CPD hours display without rounding to zero", fractional_cpd
            )

            def personal_mobile():
                fixtures.role = "learner"
                context.add_init_script("localStorage.removeItem('orgId');")
                page.set_viewport_size({"width": 375, "height": 812})
                page.goto(origin + "/learn/hr-profile", wait_until="networkidle")
                expect(
                    page.get_by_role("heading", name="My HR profile", exact=True)
                ).to_be_visible()
                assert page.evaluate("localStorage.getItem('orgId')") == ID
                page.get_by_text("Learning & work menu", exact=True).click()
                for label in (
                    "My HR profile",
                    "Wellbeing",
                    "CPD log",
                    "My competence",
                    "My reviews",
                    "My policies",
                ):
                    expect(
                        page.get_by_role(
                            "navigation", name="Learning and work", exact=True
                        ).get_by_role("link", name=label, exact=True)
                    ).to_be_visible()

            interaction(
                "Personal-workspace learner auto-select and mobile work links",
                personal_mobile,
            )

            def company_choice():
                fixtures.memberships = 2
                page.goto(origin + "/learn/hr-profile", wait_until="networkidle")
                expect(
                    page.get_by_text("Choose your company", exact=True)
                ).to_be_visible()
                assert page.evaluate("localStorage.getItem('orgId')") is None
                page.get_by_label("Company workspace", exact=True).click()
                page.get_by_role("option", name="Fixture Company 1", exact=True).click()
                expect(
                    page.get_by_role("heading", name="My HR profile", exact=True)
                ).to_be_visible()

            interaction(
                "Multiple company memberships require explicit selection",
                company_choice,
            )

            def manager_permissions():
                fixtures.role = "manager"
                fixtures.memberships = 1
                page.set_viewport_size({"width": 1440, "height": 1000})
                context.add_init_script(
                    f"localStorage.setItem('orgId',{json.dumps(ID)});"
                )
                page.goto(origin + "/business/hcm/people", wait_until="networkidle")
                expect(
                    page.get_by_text("Company admin access required", exact=True)
                ).to_be_visible()
                page.goto(origin + "/business/pms/proposals", wait_until="networkidle")
                expect(
                    page.get_by_role("heading", name="KPI proposals", exact=True)
                ).to_be_visible()
                expect(
                    page.get_by_role("button", name="New proposal", exact=True)
                ).to_have_count(0)
                expect(
                    page.get_by_role("button", name="Submit for review", exact=True)
                ).to_have_count(0)
                page.goto(
                    origin + "/business/governance/questions", wait_until="networkidle"
                )
                expect(
                    page.get_by_text("Company admin access required", exact=True)
                ).to_be_visible()

            interaction(
                "Manager sees read-only actions and HR/bank access states",
                manager_permissions,
            )
            report["fixture_missing"] = fixtures.missing
            report["requests"] = fixtures.requests
            if fixtures.missing:
                report["errors"].append(
                    "Some API requests had no matching OpenAPI fixture"
                )
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        (output / "report.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
    print(
        f"UI CONTRACT SMOKE: {len(report['pages'])}/{len(ROUTES) * 4} pages, {sum(x['passed'] for x in report['interactions'])}/{len(report['interactions'])} interactions, {len(report['errors'])} errors. Report: {output / 'report.json'}"
    )
    raise SystemExit(1 if report["errors"] else 0)


if __name__ == "__main__":
    main()
