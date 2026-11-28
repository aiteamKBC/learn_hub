# Admin Console / personal B2C completion

**Verdict: PARTIAL.** Branch `enhance_diaa`, resumed from `180527e`. This pass used the actual eight-page Khaled PDF in Downloads and the existing completion report. Khaled's rules are proposals, not blanket approval for changing K02, K04 or REFUND-1.

## Isolated acceptance environment

A disposable local PostgreSQL 18 container (`learnhub-codex-pg18`, `127.0.0.1:55433/lms`) was initialized with existing migrations only. The local acceptance backend used port 8011 and frontend port 5184. Both Django database aliases were asserted to target that local database before fixture or test execution. Shared Neon and the existing 8000/5173 development servers were untouched. Redis used the in-memory Celery broker; email used `SafeConsoleBackend`; Stripe keys were empty. Azure/Bunny credentials were removed from the disposable runner after a dashboard health check attempted an Azure token request and received 401. There were no real payments or Bunny configuration changes.

## Completed and observed

- **Certificate fixture:** `tools/harness/e2e_course.py` now finds staff and instructor under the staff tenant context and sets the free course price before submission, satisfying the existing publication checklist. The browser completed a real free enrollment, six required lectures including quiz and graded assignment, and reached 100% progress. Learner API showed one certificate; PDF download returned HTTP 200, `application/pdf` and a 3,986-byte PDF. Two repeated completion calls left the same single certificate ID (`01a2217d-6ac7-75ed-aafa-be662b93bdaf`). Evidence: `tmp/certificate-local-evidence/result.json` and `tmp/certificate-local-run.log` (local, untracked).
- **Home Layout:** Added typed, public platform settings for section order, hidden sections and default landing, using the existing settings table and admin save API. The admin page now saves these values. The Home page consumes them; the hero remains fixed. Local admin save returned 200, public settings returned the changed values, and Chrome showed Featured Courses before Categories with Offers hidden. Invalid hero hiding returned 400. Default layout was restored afterward. No schema migration.
- **Package price guard:** A priced package containing only free content now fails the same comparison as any other package. Local admin API returned HTTP 400 with `error.code=price_too_high` for a £14.99 tier against a free course.
- **Other scoped acceptance:** The focused local admin batch ran 43 cases: 38 passed, one skipped, four failed. A separate focused wallet/subscription batch ran 25 valid cases successfully; one requested test path was invalid. The remaining admin-page batch ran 54 cases: 49 passed and five errored. Passing cases exercised course pricing/access duration, package CRUD/deactivation, promotions, review moderation, subscriptions, certificate templates, dashboard, people, settings, communications, reports, audit, token pricing, wallet and subscription services. These are local database and mocked provider checks; they do not prove live Stripe, Bunny, payout or refund behavior.

## Five remaining errors in the final admin-page batch

1. `ConsoleDashboardTest.test_an_instructor_application_alerts_staff`: duplicate `staff@learnhub.example.com` during setup, indicating local test-data isolation/order interference.
2. `ConsolePeopleTest.test_instructors_permissions_enforced_and_suspension`: studio submit response lacks `status`; the fixture submits without the now-required price.
3. `ApprovalsTest.test_decisions_audit_and_notify`: same studio submit fixture error.
4. `ApprovalsTest.test_first_release_is_never_major`: same studio submit fixture error.
5. `ApprovalsTest.test_queue_tabs_search_and_major_change`: same studio submit fixture error.

The earlier 43-case batch also had four outstanding cases: a duplicate staff fixture collision; a package test reading legacy top-level `code` although the API returns `error.code`; and two old subscription assertions expecting a standard plan or a plan course list to grant unlimited course access despite the K02 `unlimited_b2c` guard. Assertions were not weakened and these cases remain unresolved.

## Acceptance limits

Publication/free enrollment, learner completion and certificate issuance were observed end to end. Course price/access-days, package activation, promotion rules, review moderation, subscription and wallet paths have focused local backend acceptance evidence, but not one continuous browser purchase journey. Real payments, external email, Bunny playback, refunds, payouts and shared-environment writes were excluded by instruction. K02 token content unlock restrictions, K04 live training ownership and REFUND-1 admin review remain preserved.

## Static checks

Frontend `npm run typecheck` and `git diff --check` were run. Ruff on the changed backend modules passed; the broader Ruff invocation reported existing harness import-order/`noqa` style issues in `tools/harness/e2e_course.py`. No additional test suites or audits were run after the stop instruction.
