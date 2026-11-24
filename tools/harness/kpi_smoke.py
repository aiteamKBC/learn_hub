"""Local read-only UI smoke check for the fictional KPI demo workspace."""

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = "http://localhost:5173"
OWNER_EMAIL = "instalment.owner@learnhub.example"
OUT = Path(__file__).resolve().parents[2] / "shots"


def main():
    password = os.environ.get("DEMO_PASSWORD")
    if not password:
        raise SystemExit("Set DEMO_PASSWORD for the local demo owner.")
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1500, "height": 1000}, device_scale_factor=1)
        page.goto(f"{BASE}/login", wait_until="domcontentloaded")
        page.locator('input[type="email"]').fill(OWNER_EMAIL)
        page.locator('input[type="password"]').fill(password)
        page.locator('button[type="submit"]').click()
        try:
            page.wait_for_url(lambda url: "/login" not in url, timeout=20000)
        except Exception:
            print("Login remained at", page.url, page.locator("body").inner_text()[:900])
            page.screenshot(path=str(OUT / "kpi_login_debug.png"), full_page=True)
            raise
        for route, title, shot in (
            ("/business/pms/kpis", "Department KPIs", "kpi_department.png"),
            ("/business/pms/individual-kpis", "Individual KPIs", "kpi_individual.png"),
        ):
            page.goto(f"{BASE}{route}", wait_until="domcontentloaded")
            try:
                page.get_by_role("heading", name=title, exact=True).wait_for(timeout=30000)
            except Exception:
                print("PAGE DEBUG", page.url, page.locator("body").inner_text()[:900])
                page.screenshot(path=str(OUT / "kpi_page_debug.png"), full_page=True)
                raise
            page.get_by_text("Attainment vs target").wait_for(timeout=30000)
            rows = page.locator("tbody tr")
            rows.first.wait_for(timeout=30000)
            page.wait_for_timeout(1200)  # let the chart animation finish before the screenshot
            print(f"{title}: {rows.count()} KPI rows; URL={page.url}")
            assert rows.count() == 8, f"Expected eight demo KPI rows on {route}"
            page.screenshot(path=str(OUT / shot), full_page=True)
            page.get_by_role("button", name="Add KPI").click()
            dialog = page.get_by_role("dialog")
            dialog.get_by_text("KPI level").wait_for()
            if route.endswith("individual-kpis"):
                dialog.get_by_text("Linked department KPI").wait_for()
            page.keyboard.press("Escape")
            if route.endswith("individual-kpis"):
                page.get_by_role("combobox", name="Person").click()
                page.get_by_role("option", name="Liam Parker").click()
                assert rows.count() == 3, "Liam should have three weighted goals"
                assert "100%" in page.locator("body").inner_text()
        browser.close()


if __name__ == "__main__":
    main()
