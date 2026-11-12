# Questions for the user

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

