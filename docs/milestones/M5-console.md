# M5 - Admin console (`/console`, platform staff), complete

**Goal.** Platform staff run the whole marketplace from `/console`. **Every control in the
twelve approved console mockups works for real.** Nothing is left for M6, nothing is hidden,
and there are no `ComingSoon` pages. Where a mockup control has no backend yet, build the
backend (API + services + tests). The control-by-control map is in
**`docs/milestones/M5-gaps.md`**: treat it as part of this brief and tick it off as you go.

Decided by the user on 2026-11-07:
- the full scope below (nothing removed, Reports included, no M5a/M5b split);
- one **additive** migration set (listed below), which the user will run with `migrate --database owner`;
- 2-step sign-in is built now with `allauth.mfa` (already installed: no new library);
- a much wider set of notifications (section N);
- **lean verification** for this milestone (section V).

**Already there:**
- the `/console` layout (`circuit` artwork, `consoleNav`) and `RequireRole allowed="staff"`;
- `/api/v1/console/` in `apps/platform/console.py` (untyped, except `platform-fee` and instructor fee);
- tables that already support much of the gap list: `CertificateTemplate`, `Certificate.revoked_at/revoke_reason`,
  `Category`, `Course.in_subscription/deleted_at/certificate_template`, `TicketMessage.is_internal`, `Invoice`,
  `RevenueShare` (3 channels), `PayoutAccount`, `Payout`, `Earning`, `Entitlement`, allauth MFA tables.

**Mockups:** `docs/design/mockups/` 26, 25, 45, 05, 22, 20, 13, 33, 30, 36, 18, 02 (and 15 for the sitemap).
Follow `docs/design/README.md` (our artwork, dark mode, motion, tokens, no stock photos, no hard-coded numbers).

**Demo login:** the seeded staff admin (ask the user; never write the password anywhere).

---

## Navigation (match mockup 15/26 order)
Dashboard · Courses · Instructors · Students · Sales & orders · Subscriptions · Pricing · Promotions ·
Commissions · Payouts · Reports · Approvals (live count badge) · Reviews · Communications · Certificates ·
Companies · Settings · Audit log.
- Currencies & FX live inside **Pricing** (tab "Currencies & rates"), as in mockup 13.
- Notification templates live inside **Communications** (tab), as in mockup 36.
- Phone: hamburger drawer (nav decision 10/16).
- **Global admin search** in the console header: users, instructors, courses, orders, tickets, certificates
  (one `console/search?q=` endpoint, grouped results, keyboard navigable).

## Migration set (additive only; one migration per app, insert-only data migrations)
Nothing existing is altered, renamed or dropped. Choice lists that only gain values are fine.
List every migration in build-status for the user.
1. **catalog:** `courses.language` (ISO code, default `en`); `course_versions.is_major_change` (bool, default false);
   `instructor_permissions` (user, can_publish_without_review, can_create_coupons, can_use_drm, can_issue_certificates, max_courses null);
   `plan_courses` handled in commerce (below).
2. **learning:** `certificates.expires_at` (null).
3. **commerce:**
   - `plan_courses` (plan, course): courses included in each plan; an empty list = falls back to `Course.in_subscription` (current behaviour).
   - `plans.renewal` (`automatic` | `manual`, default automatic); `plans.description`.
   - `regional_prices` (course or tier, country code, currency, amount_minor, is_active).
   - `pricing_rules` (name, scope: category/instructor/all, action: set tier / percent change, rounding, is_active, applied_at).
   - promotion targeting: `promotions` gains `kind` (`promo_code`|`campaign`|`subscription`|`first_purchase`), `status`
     (`draft`|`scheduled`|`active`|`ended`, derived where possible), `max_redemptions`, `per_user_limit`, `min_order_minor`;
     `promotion_targets` (promotion, target_type `all`|`course`|`category`|`plan`|`user_segment`, target_id);
     `promotion_redemptions` (promotion, order, user, discount_minor).
   - `subscription_events` (subscription, kind `created|upgraded|downgraded|seats_changed|renewed|cancelled|payment_failed`, from/to, at), written by the Stripe webhook handler from now on.
   - `orders` / `payments`: `card_brand`, `card_last4`, `payment_method_type` (filled by the webhook from the PaymentIntent; null for older rows).
4. **payouts:**
   - `commission_rules` (scope `instructor`|`course`|`category`|`price_band`, target, instructor_bps, priority, is_active, starts_at, ends_at);
   - `payout_requests` (instructor, amount_minor, status `pending|approved|paid|rejected|disputed`, method, note, decided_by, decided_at, reason);
   - `PayoutAccount.Method` gains `wise`, `bank`; account fields `wise_email`, `bank_account_name`, `bank_sort_code_last2`
     (**never store full bank numbers**, only a masked hint; the real transfer happens outside the app);
   - `Payout.Status` gains `disputed`.
5. **engagement:** `content_reports` (reporter, target_type review|question|answer, target_id, reason, status open|actioned|dismissed, handled_by, handled_at);
   `broadcasts` (title, body, audience, org_id null, sent_by, sent_at, recipient_count); platform announcements reuse `broadcasts` with `show_as_banner`.
6. **platform:** settings keys inserted with defaults (data migration, insert only, `get_or_create`).
7. **engagement data migration:** the new notification wordings (section N), insert only.

If any of this turns out to need altering existing data: stop and ask the user.

---

## Work packages (build in this order; commit after each)

**P1 Contract, routes, nav, search.**
Type every `/console/` and `/platform/` endpoint (`Console…` schema names), add both to `TYPED_PREFIXES`,
`/sync-types`. New routes for every nav item. Global search.

**P2 Demo data.** `python manage.py seed_console_demo` (idempotent, adds rows only, dev + e2e branches):
90 days of orders (several currencies, some refunded), learners, enrolments, subscriptions with events,
tickets, reviews (some reported), payout requests, certificates (some expiring, one revoked), broadcasts.
Mark seeded rows so the seed never duplicates. It makes every chart and KPI meaningful.

**P3 Dashboard (26).** Date range (7/30/90 days, custom) with "vs previous period" on every KPI
(students, instructors, courses, enrolments, revenue, sales, subscription revenue). Sales chart. Pending approvals
(courses, certificate templates, major changes). Payout requests (count + total). **Needs attention**
(reported content, disputed payouts, failed payments, stuck jobs). **Recent activity** (from audit + events, linked).
**Health tiles:** database, cache, queue, storage, Bunny, email, Stripe: cheap checks (DB `SELECT 1`, Redis ping,
cached 60 s external checks with 3 s timeouts), green/amber/red, never printing secrets.

**P4 Approvals (25).** Queue with tabs All / New courses / Course changes (major) / Certificate templates, search.
Review page: course preview (reuse M2 player components read-only), content & checklist, instructor details,
**approval history** (all versions and decisions). Decisions: **Approve**, **Request changes** (notes required),
**Reject** (reason required; new endpoint + status), notes up to 1,000 characters. Instructors flag a submission as a
major change in the studio submit step (small M4 addition). Certificate templates submitted by instructors appear here.

**P5 Courses (45).** Tabs All / Company / Instructor / Categories / Archived; KPIs; search and filters;
**bulk** publish, unpublish (reason), archive, duplicate, change category, delete (= soft delete via `deleted_at`;
never remove rows). Side panel tabs: overview, content, pricing & access (price tier, subscription inclusion per plan,
access duration, language, status), performance (enrolments, completion, rating, revenue), versions.
**Create company course** (platform-owned; opens the studio builder in staff mode). **Relist** an unpublished course.
Categories: create, edit, reorder, hide.

**P6 Students and instructors (05).** Two tabs with KPIs, search, filters, CSV export.
Student detail: overview, enrolments, progress, activity; edit account, suspend/reactivate, delete (= anonymise:
typed confirmation phrase, irreversible warning; never a seeded demo user, never yourself).
Instructor detail: overview, courses, **permissions** (`instructor_permissions`, enforced in the studio/API),
earnings, payouts, commission; **add instructor** (invite by email → becomes instructor on accept);
approve/reject applications with a reason; suspend instructor (courses stay, studio access off).

**P7 Sales & orders (22).** Tabs overview / all orders / refunds / invoices. KPIs incl. refunds and average order value,
trend, sales by product type. Filters: status, product, payment method, currency, date. Order detail: items,
discount, VAT, total, payment information (card brand/last4, Stripe reference), refund (reason, confirmation),
download invoice (Stripe hosted PDF), view customer orders. Export.

**P8 Subscriptions (20).** Overview KPIs and charts; plans: create (creates Stripe test prices), edit, duplicate,
deactivate, **included courses per plan**, renewal type, prices per currency; subscribers (search, detail, cancel at
period end); payments (invoices); plan changes (`subscription_events`); revenue.

**P9 Pricing (13, top).** Course pricing grid (base GBP + every active currency, pricing type standard/custom,
regional overrides), subscription pricing, **currencies & rates** (enable/disable, manual FX, refresh),
**regional pricing** (overrides by country; checkout picks the buyer's country price), **bulk price update** and
**pricing rules** (preview the affected courses before applying), pricing settings. Export.
Money is always minor units with `money()`; never floats.

**P10 Promotions (13, bottom).** Tabs promo codes / campaigns / discount rules / first-purchase offers /
eligibility & limits / settings. Create, edit, duplicate, deactivate; targets; limits; schedule; status;
usage and revenue generated. **Checkout honours all of it** (M1 change: tests for every rule; promotions never
stack unless a setting allows it; instructor coupons keep working).

**P11 Commissions (33, top).** Default commission, subscription revenue pool %, instructor commission list,
course commissions, **commission rules** (priority: course > instructor > category > price band > default),
discount impact setting. Earnings use the matching rule at sale time; changing a rule never rewrites past earnings.

**P12 Payouts (33, bottom; also mockup 31 for the instructor side).** Overview, payout requests (approve, reject,
mark paid with a reference, mark disputed / failed with a reason), balances, **payout schedule & minimum & hold**
(settings, defaults from `client-questions.md` #2), payout methods (Stripe Connect automatic; PayPal, Wise, bank
recorded and paid manually), history, settings, next payout date. Instructor side in `/studio/payouts`:
**request payout** (available balance only: past the hold and above the minimum), choose method, history.
Verify payout accounts.

**P13 Certificates (30).** Templates: create, edit (layout, colours, signatory, signature image, QR on/off), duplicate,
preview with sample data, approve instructors' templates, set default; **the chosen template really drives the PDF**.
Issued certificates: search, filter, export, verify box, revoke (reason; learner notified; `/verify` shows revoked),
set expiry (`expires_at`; `/verify` shows expired), download PDF. KPIs incl. expiring in 30 days.

**P14 Communications (36).** Tabs:
- **Support tickets:** KPIs (open, in progress, resolved this month, average first response time), queue, thread with
  **reply** and **internal note**, assign, status, priority, **create ticket for a user**;
- **Notifications:** log of sent notifications (filters) and the **broadcast composer** (audience: everyone, learners,
  instructors, company admins, one company; in-app and/or email; preview; confirmation with recipient count);
- **Announcements:** platform announcements (optional site banner with dates);
- **Notification templates:** every code, placeholder hints, preview with sample values, enable email / active;
  saving refuses a template that drops or misspells a placeholder the code needs.

**P15 Moderation (Reviews).** Reviews, questions and answers with hide/show (reason) and the **reported** queue
(`content_reports`). Learners get a **Report** action (reason) on reviews, questions and answers (player + course page).

**P16 Companies.** List, create, edit (name, seats, status), entitlements (DRM add-on etc.), company admins,
linked subscription.

**P17 Reports (02).** Tabs overview / sales / students / courses / subscriptions. Filters: date range, report types,
category, instructor. KPIs vs previous period, revenue trend, enrolments by type, top courses, sales by product,
recent sales. **Export CSV** and "Generate report" (applies filters). Reads only; keep query budgets.

**P18 Settings (18).** Six tabs, typed editors, Save / Discard, live platform preview:
- **General:** name, tagline, logo & favicon upload (Azure, public read via signed or public container as already
  configured), default language, default currency, time zone, date format. **The site header, emails, PDFs and
  `document.title` use them.**
- **Switches enforced by the backend (staff always bypass):** registration enabled, instructor applications,
  guest browsing (off → catalogue needs sign-in), maintenance mode (non-staff see a maintenance page; API returns 503 to non-staff).
- **Payment, learning, notification, instructor** settings (refund window, review required, certificate defaults,
  default commission link, digest options…).
- **Security:** password minimum length, session length, require email verification, **2-step sign-in** (allauth MFA:
  users can enable TOTP + recovery codes in their account settings; staff can be required to use it).

**P19 Audit log.** Filters (actor, company, action, date), keyset, expandable JSON. Every action in this brief writes one.

**P20 Status.** Update `docs/build-status.md`, `frontend/README.md` (new artwork), `docs/client-questions.md`.

---

## N. Notifications (all through `notify(...)`, editable wording, respect preferences, real `url=`)
Staff recipients = every active staff user (respect their preferences).
- **Instructor:** application approved / rejected (reason); course approved & live; changes requested (notes);
  course rejected (reason); course unpublished (reason) / relisted; new sale; new review; certificate template
  approved / rejected; payout request approved / paid / rejected / disputed (reason); payout account verified;
  commission changed; permissions changed; instructor suspended / reactivated.
- **Learner:** order receipt; refund issued; subscription started / renewed / cancelled / payment failed;
  ticket opened (confirmation) / replied (exists) / resolved; your content was hidden (reason); report handled;
  certificate revoked (reason); certificate expiring in 30 days (daily job); account suspended / reactivated
  (email only when suspended); staff access granted (security notice); 2-step sign-in turned on/off (security);
  broadcasts.
- **Company admins:** company created (welcome); seats changed; company suspended / reactivated;
  add-on switched on / off; subscription payment failed.
- **Staff:** new instructor application; course submitted for review; certificate template submitted;
  new ticket / user replied; content reported; learner self-refund; payout request received; payout due;
  health alert (a service red, or jobs stuck > 10 min, deduped hourly); FX refresh failed.

## Rules specific to M5
- Staff only: a company admin or instructor must be refused (test it). `_staff()` on every endpoint.
- Every destructive or money action: a confirmation, a reason field where it applies, an audit entry visible in
  `/console/audit`, and a notification where section N lists one.
- Client decisions are data with defaults (`docs/client-questions.md`), never hard-coded: commission rates and rules,
  revenue pool, payout schedule/minimum/hold, refund policy, prices, regional prices, VAT, promotion stacking.
  Add new decisions there (#12 onwards).
- Neon: additive only (see the migration set). Seed scripts add rows only. E2E never on `dev`.
- Changes to working flows (checkout + promotions, earnings + commission rules, settings switches) must keep the
  M1–M4 behaviour when the new features are not used. Write tests for that.
- New artwork: approvals **stamp / approval seal**; money pages **coin stacks** (from M4); support **bubbles**;
  system **circuit**; certificates **guilloche** (from M2); reports **chartgrid** (from M3); people **orgchart** (from M3).

## V. Verification (user decision 2026-11-07: lean now, full pass later)
- **Now, per package:** `npx tsc -b`, `npx vite build`, backend tests for the apps touched
  (`--keepdb --noinput`, through `tools/run_check.py`), ruff, `makemigrations --check` (or list the new migrations).
  Still **write** the tests: staff-only refusal, audits, money maths, promotion rules, commission rules, settings switches.
- **Deferred to one "Verification pass M4 + M5"** (list it under that heading in build-status, do not run now):
  full backend suite, `e2e_m4.js`, `e2e_m5.js` (write it now, run later; acceptance below), M1–M3 E2E re-runs,
  phone check on every studio and console route, light/dark screenshots next to the mockups, `reviewer` on the diff.
- This section overrides CLAUDE.md's definition of done for M5 only, by the user's decision.

## Acceptance (`tools/harness/e2e_m5.js`, written now, run in the verification pass)
1. Staff signs in → dashboard KPIs (with the date range), needs-attention, activity and health tiles render.
2. Approve an instructor application; add an instructor by invite; set a permission and see it enforced in the studio.
3. Course review: request changes (instructor sees notes) → re-submit → approve → live. Reject another with a reason.
4. Courses: bulk change category; unpublish with a reason, relist; soft-delete a draft.
5. Refund an order item: the learner loses access; the order shows refunded; the learner gets the notification.
6. Approve a payout request; mark another disputed with a reason; the instructor requests a payout from the studio.
7. Change a price tier amount and add a regional override: the catalogue/checkout shows the new prices.
8. Create a targeted promotion: checkout applies it only to the targeted course; usage counts go up.
9. Change a commission rule: a new sale's earning uses it; an older earning is unchanged.
10. Create a plan with included courses; a subscriber gets those courses only.
11. Certificates: switch template → the PDF changes; revoke one → `/verify` shows revoked.
12. Hide a reported review; it disappears from the course page; reporter and author are notified.
13. Answer a ticket and add an internal note (learner sees the reply, not the note); send a broadcast to learners.
14. Edit a notification template: the next notification uses it; a broken placeholder is refused.
15. Settings: maintenance mode blocks a learner but not staff; guest browsing off sends visitors to sign-in;
    turn on 2-step sign-in for a user and sign in with a TOTP code.
16. Reports render with filters and export a CSV.
17. Audit log lists all the above. Non-staff refused on every console route. Phone check on every console route.
