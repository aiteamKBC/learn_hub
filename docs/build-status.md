# Build status

Maintained by Claude Code (`/status`) and read by the planner session. Newest milestone first.

## Site-wide dark-mode native-control fix (2026-11-12)

- Native form controls now inherit the active browser `color-scheme`; `select` option
  sheets have explicit surface/text colours, fixing white Windows/Chrome dropdowns with
  unreadable dark-mode text across every shared `NativeSelect` usage.
- Browser autofill, native popup scrollbars, the document/root canvas and the browser
  theme colour now follow light/dark mode without white flashes.
- Intentional white document surfaces (certificate previews and QR codes) are unchanged.
- Verification: TypeScript and the production build pass; focused lint is clean. A
  headless Chrome dark-mode capture confirmed the page canvas, loading state, header and
  footer remain dark. The live logged-in Chrome inspection was unavailable because its
  window was minimised; the compiled CSS contains the native option/autofill rules.

## B2C-FE PR1 — Learner wallet & monetization UI (2026-11-11, built, not yet router-wired)

Developer A (B2C), branch `feat/frontend-b2c-v2`. The learner-facing half of the B2C v2 frontend.
Owner decision (2026-11-11): build the learner surface first, admin console after.

**Shared baseline (integrator step, done first):** regenerated `frontend/src/api/schema.d.ts` from the
audited backend (`tools/dump_openapi.py` → `openapi-typescript`). The committed schema predated the
whole token backend; it now carries all 15 `/commerce/tokens/*` learner endpoints and the
`/console/pricing/token/*` + `/console/wallet/*` admin surface.

**New files**
- `frontend/src/features/b2c/api.ts` — typed query/mutation hooks for wallet, packs, rate, top-up
  limits, access resolver, unlock, cash packages, subscriptions. Every money/wallet call sends
  `X-Org-Id: ''` (personal). No amount is computed in the browser.
- `frontend/src/features/b2c/UnlockButton.tsx` — the single content gate. The server access resolver
  decides whether to show a purchase prompt at all, so a person with existing access (subscription,
  package, legacy, prior unlock) is never asked to pay again. Confirm-to-spend dialog; 409 treated as
  already-unlocked; insufficient balance routes to buy tokens. No optimistic unlock.
- `frontend/src/pages/b2c/WalletPage.tsx` — balance, expiring-soon (FEFO) warning, grants + ledger tabs.
- `frontend/src/pages/b2c/TokenBuyPage.tsx` — token packs + custom top-up (truthful "no rate configured"
  state when `/rate` is null; min/max from `/topup-limits`; token estimate is preview-only).
- `frontend/src/pages/b2c/TokenResultPage.tsx` — Stripe return for packs/top-ups. Polls the wallet
  balance against a pre-checkout baseline (sessionStorage); never grants from the URL; graceful timeout.
- `frontend/src/pages/b2c/SubscriptionPage.tsx` — unlimited personal plan: plans, checkout, active
  status (active/trialing/past_due), renewal/cancel state; manage/cancel via the Stripe billing portal.
- `frontend/src/pages/b2c/PackagesPage.tsx` — cash course bundles; success lands on My Learning (real
  server-granted enrolments).
- `docs/features/b2c-monetization-v2/frontend-b2c-route-manifest.md` — route/nav manifest for the integrator.

**Workaround (contained):** `frontend/src/features/commerce/api.ts` `useCheckout` now asserts the true
commerce checkout shape, because the B2B `apps/corporate/api.py` reuses the Ninja class names
`CheckoutIn`/`CheckoutOut` and corrupts the generated types. Runtime is unaffected. See NEEDS-USER item 0.

**Checks:** `tsc -b` clean, `oxlint` clean on the new files, `vite build` passes (main entry unchanged at
339 kB — the B2C pages aren't bundled until the integrator wires the router). No automated UI tests added
yet; no E2E yet; no browser screenshots yet.

## B2C-FE PR2 — CoursePage, catalogue exposure, admin console (2026-11-11, built, not router-wired)

Continues PR1 on the same branch.

**Backend (additive, typed):** `apps/catalog` now exposes the B2C token fields the learner UI needs.
`CourseDetail` gains `full_course_token_price`, `token_pricing_mode`, `in_subscription`; `LectureOut`
gains `id` (the unlock/access `target_id`), `token_price`, `is_free_preview`, `excluded_from_subscription`.
Populated in `apps/catalog/api.py::course_detail` (the curriculum selector already loads the rows; no
`.only()` to extend). Test added: `core/tests/test_m1_marketplace.py::…::test_course_detail_exposes_b2c_token_fields`.
`manage.py check` clean, `makemigrations --check` clean (no model/migration change). **The focused test
could not be run to green** — the shared Neon dev DB killed the connection mid-run ("terminating connection
due to administrator command" / deadlock), the documented shared-branch hazard; the change is verified by
`check`, the OpenAPI rebuild and `tsc`.

**Frontend added:**
- `pages/CoursePage.tsx` — resolver-gated: an already-entitled person (subscription/package/legacy/token)
  sees "Unlocked via …" and Start learning instead of any purchase prompt; a token full-course unlock path
  (`UnlockButton`) when `full_course_token_price` is set; per-lecture token badges in the curriculum; an
  "included in the Unlimited plan" cross-link.
- `features/b2c/console.ts` — admin hooks: price tiers, packs CRUD, rates, top-up policies, bonus campaigns,
  token audit, wallet detail/ledger/adjust, student search. Bodies typed straight from the schema.
- `pages/console/b2c/TokenPricingPage.tsx` — tabs: packs, exchange rate (handles `RATE_EFFECTIVE_FROM_PAST`),
  top-up limits, bonus campaigns (activation shown as blocked by F02), audit (paged).
- `pages/console/b2c/AdminWalletPage.tsx` — learner search → balance, grants, ledger, mandatory-reason adjust.

**Checks:** `tsc -b` clean, `oxlint` clean on all B2C files, `vite build` passes.

**Deferred (documented in NEEDS-USER 0b/0c):** player in-token-unlock (deliverable 7 — needs player-outline
exposure of lecture pk/token_price/lock-reason + the entitlement-vs-enrolment question); admin
per-course/-lecture price + distribution-preview UI (`__UNSET__` sentinels); per-material unlock (materials
not in the curriculum/player outline). **Deferred by boundary:** PlansPage team-subscription removal
(deliverable 10) — it is B2B company billing; left to B2B coordination per the owner's "don't touch B2B".

**Git writes (branch/commit) still not performed — awaiting owner authorization.**


## B2C-01 — Unified Content Access Engine (2026-11-10, landed)

Milestone brief: `docs/milestones/M9-b2c-token-unlock.md` (done section at the end).
The additive foundation for B2C content authorization. **No wallet spending, no Stripe
changes, no B2B logic changes.** New `platform.ContentEntitlement`, `platform.AccessAuditLog`
and `apps.platform.access.resolve()` wire into `learning._check_unlocked` for personal
enrolments. B2B assignments bypass the B2C resolver (`Enrollment.org_id IS NOT NULL`).

Migrations generated (NOT applied to Neon by this milestone):
- `platform 0004_accessauditlog_contententitlement` — the two new tables, all additive.
- `platform 0005_b2c_access_engine_rls_and_backfill` — user-scoped RLS on both tables
  plus idempotent `legacy_purchase` backfill (`ContentEntitlement` mirror for every
  non-expired personal `Enrollment`). Safe to re-run; the existing `Enrollment` row is
  never touched.

Unblocks: M-wallet / M10 (cash package fulfilment), M12 (course-outline bulk fast path,
Bunny/Azure/live-join gating), M16 (grandfathering completion).

## Where things stand (2026-11-08)
| Area | State |
|---|---|
| Backend | Complete for the demo: 191 tests in 42 files (counted 2026-11-08; the last full run was 103 at M3, the next is in the verification pass), ruff clean. All learner/business/studio/console APIs exist. |
| M0 foundation | Done: design system (`/design`), layouts, sign-in, workspace switcher, home, course page, My learning, HR compliance overview |
| M1 marketplace | Done |
| M2 learning | Done |
| M3 business | Done |
| M4 studio | Built (checkpoint, pushed). Its E2E, phone check and reviewer pass are moved to the final test round after M6 (user decision, 2026-11-07) |
| M5 console | Built: P1–P20 committed, every M5-gaps line ticked. Lean verification (section V); the full pass is deferred (below) |
| M6 polish | To do |
| Testing | **All browser testing happens after M6** (user decision): the E2E scripts for M4 to M6, the phone check, the reviewer and a full-site demo run. Backend tests are still written with each change |
| Deployment | To do: production migrate + seed, public webhooks (Stripe, Bunny), Azure CORS |

## M5 review fixes (2026-11-08, planner review; commit "M5 review fixes")
- **Stripe events added by the user (production endpoint `https://learnhub.abcsolutions.ai/api/v1/commerce/webhooks/stripe`):**
  `checkout.session.async_payment_failed` closes the pending order as failed and tells the buyer;
  `customer.subscription.paused / resumed / trial_will_end` tell the subscriber (access already follows the
  status); `pending_update_*` re-sync; `invoice_payment.paid` and `payout.paid` are stored and ignored on purpose.
  The handler also uses `invoice.payment_failed` and `charge.succeeded`: add them in Stripe. New wording:
  engagement **0008_payment_notices** (insert only), applied on dev and e2e; production runs it on deploy. Tested.
- **Forgot password (user request):** `/account/password/reset` (email → link, same answer for unknown addresses)
  and `/account/password/reset/key/:key` (link checked first; new password with show/hide, strength meter and
  confirm; expired or used links offer a new one). Uses allauth's headless reset endpoints; the email links to
  `FRONTEND_URL`. Backend test covers the whole flow, one-time links and unknown emails.
- **Bug (user): a fully watched video said parts were skipped.** The lecture was saved with length 0 (the video
  was attached before Bunny finished encoding it), and completion ignored lectures without a length. Completion
  now uses Bunny's length for the video when the lecture has none, and when Bunny reports a length, lectures
  still at 0 get it. Tested. Existing lectures already at 0 with a ready video keep showing 0 as their length
  (a one-off data fix on Neon needs the user's OK); they do complete now.
- **Bug (user): "Learning as" Personal / company did nothing.** Switching removed cached data but did not reload
  what was on screen. It now resets those queries (the page reloads for the new space) and confirms the switch.
- **Bug (user, 2026-11-08): "Lecture finished" but the lecture wasn't ticked.** With Redis on, watch time sits
  in Redis until the once-a-minute Celery flush, so the player's check 2.5 s after the end found nothing. The
  beat sent when a video ends (`heartbeat` with `ended: true`) is now written at once and returns
  `completed`; the player says "Lecture complete", or explains that skipped parts mean it isn't complete yet.
  The rule is unchanged (real watch time ≥ the lecture's minimum, 90% by default). Tests added.
- **Neon migrations and seeds (user said Claude Code runs them).** `showmigrations` was checked before each run;
  every pending migration was additive. **dev:** already migrated and seeded when checked (by the planner, 08:26 UTC);
  then identity **0003_instructor_invites** applied, and `seed_console_demo` re-run (added the instructor earnings
  and 25 certificates). **e2e:** the 11 pending migrations (engagement 0005, catalog 0005, identity 0002, the 9 M5
  ones) applied, then identity **0003_instructor_invites**; `seed_console_demo` ran. `seed_demo` on both: demo
  data already there, so it refused and changed nothing (never reset). e2e runs use `tools/harness/on_e2e.py`
  (loads `backend/.env.e2e` without printing it).
- **2-step sign-in QR code:** `GET /identity/mfa/totp-qr` draws the pending key's QR as SVG on the server with
  allauth's own `qrcode` (no new dependency); the set-up card shows it next to the key. Only signed-in users
  with a set-up in progress get one; the key is never in the response as text (tested).
- **Studio > course builder > Certificate tab (mockup 23):** pick the platform default, an approved platform
  template or an approved own design; design your own (style, colours, wording, what's shown, signatory) with
  the live preview. Own designs go to staff for approval (pending / not approved with the reason shown); editing
  an approved one sends it back for approval.
- **`seed_console_demo` earnings:** seeded paid orders get sale earnings and refunded items refund earnings,
  dated like the order, so commissions, balances and payouts match sales (adds rows only; tested).
- **Settings > default currency** now decides a new visitor's first currency (server: `?currency=` → saved
  preference → setting → GBP, active currencies only; the currency menu shows the same). Tested.
- **Pending instructor invitations (client question 22):** new table `identity.instructor_invites` (staff-only
  RLS). Console > Instructors > Invitations lists invitations not yet accepted or cancelled (expired ones too),
  with Resend (fresh 7 days, audited) and Cancel (every emailed link for it stops working, audited). Inviting the
  same email again reuses the pending row. Accepting closes it. Links sent before this change still work.
- Checks (lean, section V): ruff clean, `makemigrations --check` clean, `tsc -b` and `vite build` pass (main entry
  unchanged at 372 kB). Tests run: seed, MFA QR, default currency, console people (invites), API contract, RLS: all OK.
  The full suite is not run now (user, 2026-11-08): it belongs to the verification pass.

## M5 console (2026-11-08, built; verification pass pending)
Every control in mockups 26, 25, 45, 05, 22, 20, 13, 33, 30, 36, 18 and 02 is wired to the real API; no
`ComingSoon` page is left. Packages, one commit each: P1 contract/routes/nav/search, P2 `seed_console_demo`,
P3 dashboard, P4 approvals, P5 courses, P6 students and instructors, P7 sales, P8 subscriptions, P9 pricing,
P10 promotions, P11 commissions, P12 payouts (+ `/studio/payouts`), P13 certificates, P14 communications,
P15 moderation (+ learner Report), P16 companies, P17 reports, P18 settings (+ 2-step sign-in), P19 audit.
Built by four parallel helpers by area plus the coordinator; every helper's suites were re-run by the
coordinator before committing (B 36, D 31, A+C 69 tests: all OK).

**Checks run (lean, section V):** backend tests per area (above), ruff, `makemigrations --check` clean,
`tsc -b` and `vite build` pass. The main entry chunk grew 363 → 372 kB: the site-wide wrapper (`SiteRoot`:
banner, maintenance page, branding) and the 2-step sign-in hooks load on every page by design.

**Seeding:** `python manage.py seed_console_demo` after `seed_demo` (dev and e2e, after the migrations). Adds
only; every row has a fixed marker, a second run adds nothing (tested). Seeded learners have no password. Its
orders get instructor earnings through the real `record_sale` / `record_refund` path (review fix, below).

**Bugs found and fixed while integrating**
- Duplicate schema names across helpers (`ConsoleReportOut`, `ConsoleActivityOut`, `ConsoleCoursePriceIn`): renamed.
- Price rule "Apply" crashed (`select_for_update` over a nullable join): it now locks the rule row only.
- `/people/{user_id}` swallowed `/people/students` (405): account routes moved to `/people/accounts/…`.
- Maintenance mode and cached settings leaked between tests: the test base now clears the cache after each test.
- The seed duplicated rows on a re-run (shared random stream): each order now has its own stream.

**Known limits (not hidden in the UI)**
- The language setting sets `<html lang>` only (the UI is English).
- Subscription promotions are redeemed through Stripe coupons, so their per-person limit is not counted.
- `SchemaTransactionTestCase` does not restore the seeded `revenue_shares` rows; tests that change them reset them.

**Staff bell:** applications, course and template submissions, tickets and replies, reported content, learner
refunds, payout requests and due payouts, FX failures and red health tiles (once an hour per service).

**E2E:** `tools/harness/e2e_m5.js` (acceptance 1–17) and the fixture `tools/harness/e2e_staff.py` are written,
**not run**. Their labels come from the builders' reports; reconcile on the first red run. 2-step sign-in with a
real TOTP code is a manual step in that pass.

### Verification pass M4 + M5 (deferred by the user, run later)
Full backend suite, `e2e_m4.js`, `e2e_m5.js` (acceptance 1–17), M1–M3 E2E reruns, phone check on every console
route, light/dark screenshots vs mockups, reviewer agent.

## Migrations the user must run on Neon
- `python manage.py migrate --database owner`: engagement **0005** (M2): inserts the "work_marked" notification wording. Adds only.
- Same command, **on dev and on e2e**, for two new columns (2026-11-07). Both add a nullable column only; no existing data changes. The app's table grants already cover new columns:
  - catalog **0005** `lectures.prerequisite_key` (prerequisite lessons);
  - identity **0002** `instructor_profiles.platform_fee_bps` (each instructor's platform fee).
  Until they run, the studio, player and console pages that read these columns fail on Neon.
- **Done 2026-11-08 by Claude Code (user's answer): all of the above and the M5 set below ran on dev and e2e,
  plus identity 0003_instructor_invites (new table, staff-only RLS).** Nothing is pending.
- **M5 (dev and e2e, same command; adds tables, columns and rows only, checked with `sqlmigrate`):** catalog **0006_console**, learning **0004_console** and **0005_console_a_verify** (a new certificate-check function; the old one stays), commerce **0004_console**, payouts **0003_console**, engagement **0006_console** and **0007_console_templates** (inserts notification wording), payouts **0004_console_c_request_failed** (choices only, no SQL), platform **0003_console_settings** (inserts settings). The console fails on Neon until these run.

## Settings still needed
- **Production web server (LiteSpeed): app links opened directly return 404** (`/login`, email links such as
  `/account/password/reset/key/…`, any refresh). The site's `.htaccess` needs the single-page-app fallback below,
  added **after** any existing rules that send `/api` and `/_allauth` to Django (not shipped in the build, so it
  can't overwrite those rules):
  ```
  RewriteEngine On
  RewriteCond %{REQUEST_URI} !^/(api|_allauth|admin|static|media)(/|$)
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ /index.html [L]
  ```
- **Production: `FRONTEND_URL`** = the site's public https address (e.g. `https://learn.example.com`). Every link in emails (sign-up confirmation, notifications, reminders) and Stripe's return pages use it. Unset, it was `http://localhost:5173`; production now refuses to start without a public https value.
- Azure storage account → Resource sharing (CORS) → Blob service: allow the frontend origin, methods PUT/GET/HEAD, headers `*`. Without it, browser file uploads fail (assignment hand-ins, and later studio files).
- Google/Microsoft sign-in: app registrations (`MICROSOFT_LOGIN_*`, `GOOGLE_*`); the buttons appear automatically.

## Live service checks (all PASS; they never print secrets)
| Service | Check |
|---|---|
| Azure Blob (learnhubfilesdemo / lmsdemo-resources) | `python manage.py check_storage` |
| Stripe test sandbox "KBC sandbox" | `python manage.py stripe_setup` |
| Microsoft Graph email (MAIL_MODE console for now) | `python manage.py check_mail <address>` |
| Bunny Stream library 798627 | `python manage.py check_bunny` |

Local Stripe webhooks: `stripe listen --forward-to localhost:8000/api/v1/commerce/webhooks/stripe --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.expired,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid`

---

## Basic payouts with an admin-set fee (2026-11-07, user decision; closes NEEDS-USER 2)
The user asked for something simple and flexible for the demo:
- **Default fee for new instructors.** Staff set the platform's cut of a marketplace sale (for example 20%). `GET/PUT /console/platform-fee` stores it as the marketplace row of `payouts.revenue_shares` (`instructor_bps = 10000 - fee`), so there is one source of truth.
- **Kept on approval.** Approving an instructor (`POST /console/instructors/{id}/decision`) copies the default at that moment into `instructor_profiles.platform_fee_bps`. Changing the default later only affects instructors approved after the change (and anyone with no fee of their own).
- **Per-instructor fee.** `PUT /console/instructors/{id}/fee` with `{"fee_pct": 12.5}` sets a custom fee; `{"fee_pct": null}` returns them to the default. `GET /console/instructors` shows `platform_fee_pct` and `fee_is_custom`. Every change is audited.
- **Where it applies.** `payouts.services.record_sale` uses the instructor's own fee for marketplace sales. Sales through the instructor's own coupon (97%) and the subscription pool (25%) keep their channel rates. Each earning line stores the rate it was made at (`share_bps`), so changing a fee never rewrites past earnings.
- **Instructor view.** `GET /studio/revenue` returns `platform_fee_pct` and `fee_is_custom`. The Sales & earnings page says "You keep X% of each marketplace sale".
- The console screens for these settings are built in M5 (P4 Instructors, money settings). The API is ready and tested.
- Not built (out of scope by the user's choice): a payout request button, payout schedule settings, more than one payout method, and Stripe Connect onboarding. The monthly bundle, £25 minimum and 30-day hold stay as they are (client question 2).
- Tests: `apps/payouts/tests/test_payouts.py::test_instructor_fee_replaces_default_on_marketplace_only`, and the fee steps in `core/tests/test_api_console.py`.

## Prerequisite lessons (2026-11-07, user request; closes NEEDS-USER 3)
**What it does.** An instructor can make a lesson require another lesson first ("Require students to complete another lesson first" in mockup 12). The learner can't open the locked lesson until the earlier one is complete.

**Rules**
- Data: `catalog.lectures.prerequisite_key` (nullable UUID). It points to the other lesson's `lecture_key`, not its id, because keys stay the same across course versions (new drafts copy the field).
- When the instructor sets it (`PATCH /studio/lectures/{id}` with `prerequisite_key`, or `null` to remove it), `services._check_prerequisite` rejects:
  - the lesson itself;
  - a lesson from another course or version;
  - a lesson that comes later in the course order (module position, then lesson position).
  The error code is `bad_prerequisite`.
- Lessons can be moved or deleted after the prerequisite is set. If the prerequisite is then missing or comes after the lesson, the **publish checklist** shows "Lesson 'X' needs a prerequisite that comes before it." and blocks submitting.
- Learner side (`apps/learning/api.py::_check_unlocked`, run inside `_lecture`): the lesson content, heartbeat, mark complete, quiz start, assignment hand-in and upload, file downloads and new notes all answer **403 `locked`, "Finish “X” first."** until the prerequisite has a completed progress row. If the prerequisite is missing from the live version, nothing is locked (fail-open, so learners are never stuck).
- The player outline (`GET /learning/enrollments/{id}`) gives each lesson `locked`, `prerequisite_key` and `prerequisite_title`, using the same rule with no extra queries.

**UI**
- Studio, Lesson settings card: a "Prerequisite lesson" switch. When it's on, a list of the lessons before this one (numbered `1.2 Title`), with the previous lesson chosen by default. A broken prerequisite is shown as "Missing lesson" with an error.
- Player: a lock icon and "Finish “X” first" in the course outline. Opening a locked lesson shows a locked screen with a button to go to the prerequisite. The page never asks the server for a locked lesson. "Resume" skips locked lessons.

**Tests:** `core/tests/test_api_studio.py::PrerequisiteTest`, covering the studio rules, the checklist after a reorder, the 403 lock, unlocking after completion, and the outline flags.

## M4 change log (everything changed since M3, for the planner's review)
Checkpoint commit `bff6820`, then the payouts and prerequisite work above.
- **Studio screens:** teach/apply; dashboard; my courses; the course builder:
  - Details: outcomes, requirements, rich-text description;
  - Curriculum: the mockup-12 inline editor;
  - Pricing, Coupons and Publish (checklist, submit, versions).
  Also: students, marking (files, rubric scores, essay prompts), Q&A, reviews and announcements, revenue, payouts. New artwork: `storyboard` and `coins`.
- **Studio API (all typed, in `studio_schemas.py`):**
  - dashboard;
  - instructor status on `/identity/me`;
  - submission file download;
  - draft status on course rows;
  - video details, parts, key moments, thumbnail, subtitles and fetch-by-link;
  - the editor tree carries the video's file name and size, and `prerequisite_key`.
- **Bunny:**
  - connect timeout and one retry; network errors return 503 (they used to be 500s);
  - status poll fallback when webhooks can't reach a laptop;
  - the publish checklist refreshes unfinished videos;
  - reapplying after rejection resets the application to pending.
- **Stripe:** the thank-you page asks Stripe for the Checkout Session when the webhook hasn't arrived (rate-limited, same checks as the webhook). The page no longer waits for ever: it shows a slow state and a retry button.
- **Learner:**
  - video parts and key moments listed under the video, and clicking one seeks the player;
  - notes capture the current second, which can be edited (`PATCH /learning/notes/{id}`), and clicking the time seeks the video;
  - prerequisite locks.
- **Fixes:**
  - feedback showed `<p>` tags: the learner views now render rich text safely (`RichOrText`);
  - `core.html.plain` stored `&amp;`: it now unescapes. Old dev rows are left as they are;
  - learner answers were rendered as HTML on the marking screen (XSS risk): now plain text;
  - the Swagger docs page lacked CSRF;
  - sign-up with an existing email now shows a safe hint (no account probing);
  - the contract test reads files as UTF-8.
- **Payouts:** basic fee settings (see above).
- **Migrations to apply:** catalog 0005, identity 0002 (see the top of this file).

## Extra (agreed with the user, 2026-11-07): video parts, notes moments, thumbnails (built)
Built 2026-11-07, waiting for the user's manual test.
- API: `GET studio/media/{id}/details`, `PUT studio/media/{id}/parts`, `PUT studio/media/{id}/thumbnail`; learner lecture content has `parts` and `moments` (from Bunny, cached 10 min, refreshed on save); `PATCH learning/notes/{id}` (time, clear time, text). Tests in test_api_studio / test_api_learner.
- Bunny thumbnails: the API can't pick a frame by second, so the picker offers Bunny's 5 frames or an https image link (file upload would stream through Django). The pull zone blocks requests without a referrer: `<img>` tags send one; **the production domain must be in Bunny's allowed referrers**.
- Webhook fallbacks for laptops: the order poll asks Stripe for the Checkout Session, the video status poll asks Bunny (both rate-limited, same checks as the webhooks).
1. **Instructor, in the builder's video sheet (both saved to Bunny through its API, so they show in Bunny's own player):**
   - **Parts = Bunny chapters:** name + start time (pick from the preview or type `mm:ss`); each part runs to the next one's start.
   - **Key moments = Bunny moments:** a label at a single second (e.g. "Key formula", "Common mistake").
2. **Learner: the video's parts and key moments** in Bunny's player, and also listed under the video in our style (parts as a list, moments as chips); clicking one seeks the player there (player.js `setCurrentTime`, no reload).
3. **Learner notes moments** (our style, nothing drawn in the iframe): a new note gets the current second automatically; the time can be edited by hand (`mm:ss`) before or after saving; notes are listed under the video and clicking the time seeks the video instantly. Private to the learner (notes are already private rows; needs a note-update endpoint for the time).
4. **Thumbnail picker** in the video sheet: the frame at a given second, or an uploaded image, saved to Bunny.
Keep Bunny's player (no custom player, no hls.js).

## Curriculum redesign to mockup 12 (2026-11-07, user request)
- The drawer is replaced by an inline editor: course content tree on the right (modules, drag + menu reorder, Add module, Bulk upload, tips), lesson editor in the centre (type list, video source upload / external link, file row, processed versions, subtitles, parts/moments/thumbnail), Lesson settings card (free preview, duration hh:mm:ss, completion %, required, Cancel / Save lesson). `?lesson=<id>` in the URL; phones show the list first.
- API (typed, tested): `POST studio/media/videos/fetch` (Bunny fetches a direct file link; found again by a marker title, since Bunny's fetch returns no id), `POST/DELETE studio/media/{id}/captions` (.srt/.vtt up to 1 MB: **the one upload that passes through Django, approved by the user**, forwarded to Bunny, never stored), details add `resolutions` and `captions`, the editor tree's video adds `filename` and `size_bytes`.
- Prerequisite lesson: built later the same day (section above). No autosave claim.
- Also fixed today: learner feedback showed `<p>` tags; `core.html.plain` stored `&amp;` (now stores the text); learner answers were rendered as HTML on the marking screen (stored-XSS risk, now plain text); course description uses the rich-text editor.

## M3 business (done)
- **Screens (all `/business/*` placeholders replaced):**
  - training matrix: KPI strip, URL filters (`unit`, `role`, `status`, `req`, `q`), sticky header/column, keyset "Load more", legend; cell → side sheet with the person's requirement: Extend, Exempt / Revoke, Record completion, Void, Send reminder, history timeline; phone = list of people by worst status;
  - requirements: compliance ring, targets as chips, sheet form (Course, Schedule, Reminders, Who it applies to), archive with confirmation; read-only for managers;
  - reports: by requirement, by location, audit trail (admins), CSV export with unit filter;
  - people (KPIs, filters, keyset) and person page (Profile / Training tabs, role and unit edits, remove with confirmation);
  - locations & teams: tree with per-node actions, managers picker, job roles;
  - invitations (single or bulk) and the public `/invite/:token` page (expired/used, wrong account, sign up → confirm email → back to the invite → accept → company workspace);
  - course library (assigned/completed, progress sheet) and 3-step assign with an exact count;
  - billing (plan, seats, portal, buy seats via the M1 team-plan flow) and company settings with live branding preview.
- **Runtime branding:** company colours tint the sidebar's active item and the header (CSS variables on the layout root and the phone drawer only; tokens untouched; text colour picked for contrast). Logo shown when it is an https link.
- **Layout:** `lib/page-art.ts` lets any workspace route pick its artwork (`handle: { art }`); the header search is real (business → `/business/people?q=`) and hidden where an area has none. New artwork: `chartgrid` (reports), `orgchart` (people, invites), `floorplan` (units).
- **API (all additive, typed, tested; no migrations):**
  - every `/api/v1/org/` and `/api/v1/compliance/` endpoint is typed (both in `TYPED_PREFIXES`; `export.csv` in `NOT_JSON`);
  - person view: `units`, `job_roles`, `requirement_id` on records/exemptions, `void_reason`, revoked exemptions kept as history (`revoked_at`);
  - `org/invitations/{token}` returns `role`; units return `manager_ids`; dashboard returns `people_overdue`; `org/assign` accepts `dry_run`.
- **Bugs found and fixed:**
  - managers received the whole company's unit tree (now only their own units);
  - archived requirements' cells leaked into the matrix (status filter, phone worst status);
  - people and matrix lists were in UUID order (now alphabetical: keyset on name + id);
  - the header search box did nothing;
  - unit detail claimed "no training" for sites/teams (now per-unit summary);
  - removing a person flashed an error page; admins were offered "remove yourself";
  - role badges stayed stale after assigning managers; invite redirect used the invited role instead of the real one; a dead pending invite could be offered after email confirmation;
  - CSV download could be cancelled in Firefox/Safari; compliance actions waited for every list to refetch;
  - unit pickers indented by company depth for managers; custom radio groups had no arrow-key support;
  - `/business/units` overflowed on phones (implicit grid column);
  - `serve.py` never started the Celery worker when `REDIS_URL` lives in `backend/.env` (requirement statuses never computed in E2E);
  - a killed test run left rows in the reused test database (the test base now truncates once at the start of each run).
- **Verified:**
  - backend: full suite 103 tests OK (32 min on Neon), ruff clean, `makemigrations --check` clean, query budgets now cover the person view and assignments;
  - `tsc -b` and `vite build` pass; main chunk 384 KB (115 KB gzip), unchanged;
  - `tools/harness/e2e_m3.js`: 21 steps covering acceptance 1–10 (admin, manager and learner, invite sign-up with real email confirmation, CSV header, audit, billing, branding, phone); `e2e_m1.js` and `e2e_m2.js` re-run green;
  - phone overflow + light/dark screenshots on every business route and the invite page: `node tools/harness/phone_business.js shots/phone` (builds its own company, so no demo password is needed); screenshots checked against the specs and mockups 26/05/33.
- **Reviewer:** run on the whole M3 change; all 16 findings fixed (listed above).
- **Harness additions:** `e2e_org.py` (fresh company), `e2e_wsgi.py` records `email<TAB>token` in `invite.log` when the API enqueues an invite (the app never stores or logs the token), `e2e_verify_key.py` (allauth's HMAC confirmation key), `stop.py` (stops the harness processes), `phone_business.js`; `phone_check.js` can switch company (`E2E_DEMO_ORG`).
- **Type generation without a running server:** `tools/dump_openapi.py` writes `logs/openapi.json`; then `npx openapi-typescript ../logs/openapi.json -o src/api/schema.d.ts` in `frontend/`.
- **Lessons:** never run two Django test processes at once against Neon (shared `test_*` database: deadlocks, duplicate keys); Django 5.2 calls `_fixture_setup` at class level, so hook `setUpClass`.

## M2 learning (done)
- **Player** `/learn/:slug/lecture/:key`; `/learn/:slug` resumes; `/learn/:slug/qa/:id` and `/announcements/:id` are notification links.
  - Curriculum sidebar on desktop, drawer on phones; progress ring; prev/next.
  - Finishing the course shows a celebration dialog with the certificate.
- **Lecture kinds:**
  - video: Bunny iframe + player.js; resume, real watch time every 30 s and on leave; placeholder with manual complete when not uploaded;
  - reading, external link, download;
  - live session (countdown; join link from 15 min before);
  - quiz: 7 answer types, timer with auto-submit, drafts survive a reload, review after submitting;
  - assignment: text, https link, up to 5 files sent directly to Azure; rubric; feedback.
- **Tabs:** overview + files, notes (pinned to video time), Q&A, announcements, review.
- **Pages:**
  - certificates (PDF, verify link) and public `/verify/:code`;
  - achievements;
  - required training (per company);
  - notifications page and bell;
  - settings (profile, time zone, currency, password, notification preferences, companies);
  - support tickets.
- **Backend additions:**
  - typed responses for learning/engagement/identity;
  - reloadable quiz review;
  - `my/courses?slug=`;
  - `my-review`, `my/badges`;
  - assignment file uploads (`apps/learning/uploads.py` + purge job);
  - notifications for certificate issued and work marked;
  - badges for personal completions;
  - name sanitising;
  - free enrolment goes straight to the player;
  - order items carry the course slug.
- **Bugs fixed:**
  - the workspace bell was a fake dot;
  - the review-reply link 404'd;
  - badges could get the wrong name;
  - the file purge would have crashed on hand-ins;
  - the quiz result was lost after submit;
  - a stale-cache redirect after enrolling;
  - a self-vote error;
  - an 800 KB icon bundle.
- **Verified:** `tools/harness/e2e_m2.js` (18 steps, every lecture kind, desktop + phone), M1 E2E re-run, phone overflow check, light/dark screenshots.

## M1 marketplace (done)
- **Built:**
  - catalogue filters (sidebar + phone drawer), chips, sort, grid/list, infinite load;
  - course page buy modes;
  - cart with coupon + currency;
  - Stripe checkout + thank-you polling;
  - plans (personal trial, team seats, billing portal);
  - wishlist;
  - purchase history with refunds.
- **Verified:** `tools/harness/e2e_m1.js`.

## STANDING RULES (from the user; apply to every milestone)
1. **Artwork on every page** (no flat backgrounds): see `frontend/README.md` for the variant per area.
2. **Motion**:
   - View Transitions;
   - skeleton cross-fade;
   - stagger;
   - living numbers;
   - micro-interactions;
   - subtle (150-300 ms), reduced motion respected.
3. **Design**: the approved mockups, refined; light and dark mode.
4. **Security and data**:
   - secrets only in `.env`;
   - the app never uses `lms_owner`;
   - no `--fake`;
   - Neon only gains tables, columns and rows; anything touching existing data → ask the user.

## Working rules learned (bugs these prevent)
- Duplicate Ninja schema class names silently corrupt the OpenAPI types → the contract test.
- React Query mutation callbacks don't fire if the component unmounts → derive views from server state, not local flags set in `onSuccess`.
- Never decide a redirect from cached data while it's refetching.
- Grid children need `min-w-0`; tables with `sr-only` need a `relative` wrapper (phone overflow).
- Celery must run (with Redis) for badges and emails; tests run tasks eagerly.
- Import icons one by one (the whole lucide set is ~800 KB).

## Next
1. M5 console, starting fresh. It includes the console screens for the platform fee (default and per instructor).
2. M6 polish (check the main bundle size: ~520 KB minified / 160 KB gzipped).
3. **Final test round after M6** (user decision):
   - the full backend suite. The stopped run on 2026-11-07 had two unidentified errors, around tests #30 and #97: find them;
   - the E2E scripts for M4, M5, M6 and the demo, plus every earlier one;
   - the phone check on every route, in light and dark;
   - the reviewer over the whole branch;
   - a click-through of the whole demo.
4. Deployment.

## B2C-03 — PR 2 done (2026-11-11)

Admin monetization console endpoints + token-pricing contract wired in (PR 2 of 3).
Django-Ninja routes under `/api/v1/console/pricing/token/*`, mounted alongside the
existing cash pricing console via `apps/platform/console/__init__.py`. All endpoints
require `StaffSessionAuth` + `staff(request)`; mutations forward `actor`, `reason`,
and `request` to `apps.commerce.pricing_service`, which continues to own all state.

New files:
- `backend/apps/platform/console/token_pricing.py` — the whole token-pricing surface
  plus `Console…`-prefixed request/response schemas.
- `backend/apps/platform/tests/test_console_token_pricing.py` — 14 endpoint tests.

Modified:
- `backend/apps/platform/console/__init__.py` — registers the new module.
- `backend/apps/catalog/services.py` — `create_draft` now runs
  `pricing_service.migrate_token_pricing_on_republish` after `_copy_content`,
  wrapped in try/except so republish semantics never change on failure.

Endpoints: course list/detail/PATCH, `distribute-tokens` (server-authoritative,
Hamilton allocation; client-side amounts are ignored), per-lecture/per-material
PATCH, bulk course PATCH, token pack CRUD + soft delete, token rate list + create
(past `effective_from` → 400 `RATE_EFFECTIVE_FROM_PAST`), per-currency top-up policy
upsert, bonus campaign list/create/update (activation stays blocked → 409
`F02_BLOCKED`), audit page scoped to token-pricing targets.

UNSET vs null: PATCH bodies default each optional field to the string sentinel
`"__UNSET__"`. The endpoint reads `payload.dict(exclude_unset=True)`; missing →
UNSET (service leaves the column alone), explicit `null` → clears the column,
value → sets the column. `price_tier_id` is resolved to a `PriceTier` row (404 on
unknown id) before forwarding.

Contract test (`core/tests/test_api_contract.py`) still passes — the `Console`
schema-name prefix was already enforced for the console surface; every new schema
starts with `Console…` and every typed response declares its shape.

No new models or migrations. All BLOCKED items from PR 1 (C05, F02, T03, default
top-up bounds) remain BLOCKED.

## B2C-03 — PR 1 done (2026-11-10)

Admin monetization & token pricing — foundation layer (PR 1 of 3). Models, migrations,
service, and tests only. No API routes or UI yet (PR 2 / PR 3).

New tables (all additive):
- `commerce.token_packs`, `commerce.token_rates`, `commerce.topup_policies`,
  `commerce.bonus_campaigns`, `commerce.price_snapshots`.
- Partial unique index `uq_trate_one_open` — at most one open-ended `TokenRate` at a time.
- Partial unique index `uq_topup_active_cur` — at most one active `TopUpPolicy` per currency.

New columns (nullable / defaulted — existing rows unaffected):
- `catalog.courses`: `cash_price_tier_id`, `full_course_token_price`, `token_pricing_mode`.
- `catalog.lectures`: `token_price`, `is_free_preview`.
- `catalog.lecture_resources`: `token_price`, `is_free_preview`.

Service: `apps.commerce.pricing_service` (see M13 brief for signatures).
Audit reuses the existing `platform.audit_logs` partitioned table via
`apps.platform.services.audit()`.

Migrations the user must run (owner connection, Neon):
- `commerce.0005_tokenrate_pricesnapshot_topuppolicy_bonuscampaign_and_more`
- `commerce.0006_token_pricing_constraints`
- `catalog.0007_course_cash_price_tier_and_more`

BLOCKED items (still open — PR 2 cannot close):
- **C05** default auto-weights for token distribution.
- **T03** default grant expiry duration.
- **F02** bonus-campaign activation funding model.
- Default TopUp bounds per currency.
