# Questions for the user

K02-1. **[blocker] Token entitlements never become enrolments, so unlocked content cannot be opened.**
   `apps/commerce/unlock.py` — `unlock_lecture` and `unlock_course` both spend tokens and create a
   `ContentEntitlement` (LECTURE- or COURSE-scoped), but neither creates an `Enrollment`.
   `pages/learn/PlayerPage.tsx` redirects any viewer without an enrolment back to the course page, and
   `Enrollment.Source` has no token-unlock value. A learner who pays tokens therefore gets a valid
   entitlement and **nothing they can open**.
   This is the operation Khaled's technical table already calls for: *"إضافة عملية بدء تعلّم تتحقق من
   الصلاحية وتُنشئ أو تعيد سجل المتابعة"* — a start-learning endpoint that checks the entitlement and
   creates or returns the progress record. It needs a new `Enrollment.Source` value, a migration and an
   endpoint, and it must keep lecture scope intact (unlocking one lecture must not open the course,
   per Khaled's rule 3).
   **Interim measure taken:** token *spending* is disabled in the learner UI via `TOKEN_SPENDING_READY`
   and at `POST /api/v1/commerce/tokens/unlock` by the secure-default
   `PERSONAL_TOKEN_CONTENT_UNLOCKS_ENABLED` setting. The API refuses course, lecture and material
   unlocks before a debit or entitlement grant. Prices still show, marked "coming soon", and anyone
   who already holds an entitlement keeps that access. Re-enable the setting only after K02-1 is
   delivered and manually accepted end-to-end.
   **Owner:** K02 backend.

K02-2. **[blocker] Access expiry is not applied to token entitlements.**
   `Course.access_days` is admin-configured and now surfaces on the course page (B2C-01), and
   `ContentEntitlement` has an `expires_at` column that the access resolver already honours — but
   `unlock_lecture` / `unlock_course` always create entitlements with `expires_at` unset, i.e. permanent.
   That conflicts with Khaled's rule 4 (replay follows the configured access period). It also means the
   course page can advertise a replay window that token-unlocked content does not actually obey.
   Decide whether `access_days` applies to token unlocks as well as cash purchases; if it does, set
   `expires_at` at unlock time. **Historical entitlements must not be retro-expired** (rule 8).
   **Owner:** K02 backend, alongside K02-1.

REFUND-1. **[blocker] Learner refunds moved real money with no admin approval.**
   `apps/commerce/services.py` — `request_refund` is named like a request but **issues the refund
   immediately**: it calls `gateway.refund(...)` (real Stripe money movement), sets the `Refund` row to
   `SUCCEEDED` and revokes the enrolment, in one learner-triggered call. `pages/shop/OrdersPage.tsx`
   exposed this as a self-service "Refund" button with an "Refund issued" toast. That contradicts
   Khaled's rule 7 (*"مراجعة الأدمين قبل الاسترداد"* — admin review **before** the refund).
   **Interim measure taken:** the learner-facing button now reads "Ask about a refund" and links to
   `/contact`; the page reports refund status only. `POST /api/v1/commerce/orders/items/{item_id}/refund`
   now refuses learner self-service before creating a refund, contacting Stripe or revoking access.
   Staff can still refund through console > Sales exactly as before.
   **What a proper fix needs** (not done here — admin workflow, out of the current B2C scope):
   `Refund.Status.PENDING` already exists and is the model default, and `GET /console/refunds` already
   lists pending rows — but there is **no console endpoint to approve one**. `console/sales.py:417`
   calls the same `request_refund`, which would hit the `OneToOneField` on `OrderItem` if a pending
   refund already existed. So making the learner path create a pending row today would strand the
   request with no way for staff to process it. Needs an approve/reject endpoint plus a status field on
   the learner's order item so the learner can see where their request stands.
   **Owner:** admin/console workstream.

ENV-1. **[action] Add `STRIPE_PUBLISHABLE_KEY` to `backend/.env`.**
   The new embedded checkout page (`/checkout/pay/:slug`, Stripe Payment Element) needs the
   publishable key in the browser. It is the public `pk_…` key from the *same* Stripe sandbox
   whose secret key is already configured (Stripe dashboard → Developers → API keys). It is safe
   to expose. Until it is set, "Buy now" falls back to Stripe's hosted checkout page (still works).
   Nothing to run — just add the line and restart the backend.

UI-1. **[UI] Home hero now uses a stock photograph — deviates from the "no stock photos" rule.**
   Per an explicit user instruction (2026-11-14), the home hero (`pages/HomePage.tsx`, `Hero`) was rebuilt to
   match the Evidrise/Readdy reference exactly, including its full-bleed laptop photograph
   (`HERO_SRC`, hosted on `public.readdy.ai`). This knowingly breaks the CLAUDE.md/design rule that every screen
   uses custom artwork and no stock photos. The "Featured courses" section (section 3, `FeaturedCourses`) likewise
   uses warm editorial cover photos (`FEATURED_PHOTOS`, readdy.ai) as the card covers when a course has no uploaded
   thumbnail — same deviation, same user sign-off.
   Two further home sections carry PLACEHOLDER business numbers at the user's request (to be replaced when the
   project is wired to real data): the **Offers/bundles** section (`BUNDLES` — fake prices £179/£238 and "Save 25%"
   discounts; "See the bundle" links to /courses, no real bundle exists) and the **Why LearnHub** section
   (`COHORT_STATS` — fake 12,400 learners / 38 countries / 94% / 4.8/5; `TEAMS` — placeholder client logos). These
   break the "no hard-coded business numbers" rule knowingly. **Planner/client:** replace with real figures or remove. The user signed off and supplied the image URL. Also part of this
   UI pass: brand `--primary` switched from purple to Evidrise orange (OKLCH) sitewide, body font set to Poppins,
   and the public navbar made transparent-overlay on the home hero (solid once scrolled / on other pages).
   **Planner:** confirm you want to keep the stock photo, or ask for a custom-artwork hero instead.

UI-2. **[UI] "Get started" auth dialog has a role chooser the backend does not support.**
   Per an explicit user instruction (2026-11-14/15), the public navbar now has a single **"Get started"** button
   (shown when logged out) that opens a dialog with a real log-in / create-account card (`AuthTabs` in
   `components/home/GetStarted.tsx`), built on the existing auth hooks (`useLogin`, `useSignup`,
   `useMfaAuthenticate`) — the e-mail/password flow, MFA step and forgot-password link all work end to end with
   **no backend change**. (It replaced the separate Log in / Sign up navbar buttons; the home hero's primary
   button also opens the same dialog.) At the top it has a **role chooser (Student / Company / Coach / Admin)**
   shared by both the log-in and sign-up tabs. This control is **VISUAL ONLY**: log in (e-mail + password) and
   sign up (create account) are real, but the selected role is **not sent anywhere** — the backend assigns the
   default role and has no `coach`/`admin`-at-signup concept. (Paying for a course and the admin's view of an
   order's customer + payment + course details already exist — checkout at /cart→/checkout and
   console → Sales & orders → Orders detail — so they were not rebuilt.) This knowingly breaks the "nothing fake ships" rule, kept at
   the user's explicit request for the demo. **Planner/backend:** to make it real, the sign-up endpoint needs to
   accept the intended account type. Until then the toggle is cosmetic.

UI-3. **[UI] Two new admin-console screens are VISUAL ONLY (no backend).**
   Built at the user's explicit request (2026-11-15) as placeholders:
   - **Home page layout** (`/console/home-layout`, `pages/console/HomeLayoutPage.tsx`, nav: Platform → "Home layout"):
     reorder / show-hide the marketing home sections and pick the default landing page. Nothing is persisted — there
     is no layout-settings API, so changes reset on reload and do **not** affect the live home page.
   - **Course payments** (`/console/course-payments`, `pages/console/CoursePaymentsPage.tsx`, nav: Money →
     "Course payments"): a view of the checkout steps, payment methods and money rules with toggles. Not persisted;
     the real payment config stays in Settings → Payment / Stripe.
   Both carry a visible "preview only" banner. **Planner/backend:** expose a home-layout settings API and a
   payment-config API to make these real, or remove them. The user also asked which sidebar items were redundant;
   after review none were removed (all are distinct destinations), per the user's decision.

0b. **[B2C-FE] Backend exposure needed to finish the in-player token unlock (deliverable 7).**
   The player outline (`PlayerOut.PlayerLecture`) exposes `key, title, kind, duration_sec, completed,
   position_sec, locked, prerequisite_key, prerequisite_title`. To offer per-lecture / per-material token
   unlock **inside the player**, it needs to additionally expose, per lecture (and per resource):
   the lecture **pk** (the `target_id` the unlock/access endpoints use — the outline only carries
   `lecture_key`), the **`token_price`**, and a lock **reason** that distinguishes a prerequisite lock from
   an entitlement lock. There is also an architectural question to confirm: how does access gained by a
   **token course-unlock or subscription** (a `ContentEntitlement`, not an `Enrollment`) reach the player,
   which currently loads from an `enrollment_id`? This was NOT guessed. The learner course page already does
   resolver-based gating and course/lecture token unlock from the catalogue detail (now exposing the prices).
   **Recommended:** add the additive player-outline fields (mirrors the catalogue change already made) and
   confirm the enrollment-on-entitlement behaviour; then wire `UnlockButton` into the player's locked screen.
   `frontend/src/features/b2c/UnlockButton.tsx` is ready to drop in.

0c. **[B2C-FE] DONE (2026-11-12): admin per-course/-lecture token prices + automatic distribution.**
   Built as the "Course pricing" tab in `pages/console/b2c/TokenPricingPage.tsx`: a searchable course list,
   per-course whole-course unlock price, pricing mode (manual / auto_weighted), the auto-distribution tool
   (total tokens → preview allocation → apply, optional weight-by-duration), and per-lecture price editing.
   Hooks: `useTokenCourses/useTokenCourse/usePatchTokenCourse/usePatchLecture/usePatchMaterial/useDistributeTokens`.
   **Still not surfaced:** per-material price inputs (the material PATCH endpoint and the material rows exist in
   the detail payload, but the editor only renders lecture rows) — add material inputs if the client needs them.

0. **[B2C-FE / B2B] Duplicate Ninja schema class names corrupt the generated API types.**
   `apps/corporate/api.py` defines `CheckoutIn` and `CheckoutOut`, names that already belong to
   `apps/commerce/schemas.py`. The runtime is fine (each router uses its own imported class), but the
   OpenAPI generator keys `components.schemas` by title, so the corporate shapes
   (`{quantity}` / `{purchase_id, checkout_url}`) silently overwrite the commerce ones
   (`{course_ids, currency, coupon}` / `{order_id, status, checkout_url, total_minor, currency}`).
   This breaks the typed frontend for **both** `/commerce/checkout` and the corporate checkout.
   It is the exact failure documented in build-status.md ("Duplicate Ninja schema class names
   silently corrupt the OpenAPI types"); `core/tests/test_api_contract.py` did not catch it, so that
   check has a gap too.
   **Owner decision (user, 2026-11-11):** do not touch the B2B backend from the B2C-FE branch. A localized,
   documented frontend workaround now asserts the true commerce checkout shape in
   `frontend/src/features/commerce/api.ts` (`useCheckout`).
   **Recommended real fix (for the B2B developer):** rename the corporate classes to
   `CorporateCheckoutIn` / `CorporateCheckoutOut` (same JSON, runtime-safe), close the contract-test gap,
   then the integrator regenerates `schema.d.ts` and the frontend workaround is removed.


1. **Course language (M4 Details tab).** The brief asks for a "language" field, but `catalog.courses` has no language column. Adding one is an additive migration (a new column with default `'en'`), so it needs `migrate --database owner` on dev and e2e.
   **Recommended:** yes, add `language` (ISO code, default `en`) in M6 or after the planner's review. Until then the Details tab leaves it out.

2. **Run two new migrations on Neon (dev and e2e).** Both only add a nullable column:
   - catalog 0005: `lectures.prerequisite_key`;
   - identity 0002: `instructor_profiles.platform_fee_bps`.
   Command: `cd backend; python manage.py migrate --database owner`, against dev and then e2e.
   **Recommended:** yes. The studio, player and console fail on Neon until they run.

(Closed 2026-11-07: money screens became a basic admin-set fee, now built; prerequisite lesson, now built. See build-status.)

---
## Answers from the user (2026-11-07, via the planner)
1. **Course language:** yes. Added in the M5 migration set (`courses.language`, default `en`).
2. **Money screens (mockups 01, 31):** build them now, in M5, as configurable data with defaults from
   `client-questions.md` (#2, #12-#14). See M5 P11/P12.
3. **Prerequisite lesson:** `lectures.prerequisite_key` already exists (catalog 0005). If the player rule is
   not wired yet, wire it in M5 (no new migration).

## Answers from the user (2026-11-08, via the planner)
- **Question 1 (course language):** already answered and built in M5 (`courses.language`). Closed.
- **Question 2 + the M5 migrations:** **yes, Claude Code runs them.** Run
  `python manage.py migrate --database owner` on **dev**, then on **e2e** (all pending migrations: engagement 0005,
  catalog 0005, identity 0002 and the 9 M5 migrations). Then `seed_demo` and `seed_console_demo` on both.
  Before each run, show `showmigrations` for the pending list; stop and ask if anything is not additive.
  Report what ran (never print connection strings).
- **2-step sign-in QR code:** yes. `qrcode` is already installed with `django-allauth[mfa]`, so it is **not** a
  new dependency. Render the QR server-side as SVG next to the key.
- **Client question 22 (pending instructor invitations):** yes, build the list with resend and cancel
  (additive table if needed; list the migration and run it as above).
- **Client question 21 (payout hold vs refund window):** keep them linked for the demo. Leave the question
  open for the client.

**Done 2026-11-08 (Claude Code):** migrations and seeds ran on dev and e2e as above (plus the new identity
0003_instructor_invites table); QR code built; pending invitations built. All questions here are closed;
client question 21 stays open in `client-questions.md`. This file can be deleted.

