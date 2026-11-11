# B2C Monetization v2 — Functional Spec

**Scope.** B2C only. Does NOT touch B2B org/team plans, corporate assignments, compliance.
Introduces: Wallet + Tokens, Cash Course Packages, Unlimited Subscription, Lecture/Material-level
pricing, Cross-access resolver, Instructor finance extensions, Admin pricing console.

**Precision rules.**
- Money: `Decimal(12,2)` in service layer; `PositiveIntegerField(minor units)` at rest (reuse existing `*_minor` convention). Rounding: `ROUND_HALF_UP`.
- Tokens: integer only. No fractional tokens. Deduction of exact integer quantities; any token-to-money math uses `Decimal(12,4)` conversion rate, then `floor` to integer tokens on spend side and `ROUND_HALF_UP` on cash side.
- FX: reuse existing `commerce.FxRate` (currency-per-GBP).
- Time: UTC everywhere; expiries evaluated against `now()` in UTC.

**Source-of-truth note.** The `T## / P## / S## / A## / F## / X## / C##` decision IDs referenced here
are defined in `decision-register.md`. The orchestrator brief passed the table set by reference
("Paste the full decision tables … verbatim"), but the literal decision rows were not inlined in
the hand-off. Each clause below cites the decision ID it implements and, where the clause depends
on a sub-policy whose exact text was not delivered, the register marks that sub-policy BLOCKED.
Nothing in this spec silently chooses a financial rate or legally sensitive default.

---

## 1. Tokens & Wallet

### 1.1 Wallet model
- Every learner (identity user) has at most one wallet. Wallet is user-scoped, not org-scoped
  (B2C, per-user). B2B orgs do NOT get wallets in v2 — hard boundary.
- Wallet balance = sum of unexpired, unconsumed `TokenGrant` quantities.
- Grants carry: source (`pack_purchase | topup | admin_adjustment | bonus_campaign | refund_reversal`),
  granted_at, expires_at (nullable; null = non-expiring), unit_cost (Decimal, the GBP each token cost at
  grant time — used for instructor revenue weighting when the grant is a cash-backed one), remaining_qty.
- Every spend creates a `TokenLedgerEntry` referencing one or more grants (FEFO allocation, see C04).

### 1.2 Token Packs (catalog, T01)
- Admin-defined SKU with: name, token quantity (int), price in each active currency (reuse
  `PriceTier` + `PriceTierAmount` style via a new `TokenPackPrice`), optional bonus tokens, availability window.
- Bought through existing Stripe checkout flow. On fulfillment, a single `TokenGrant` row is written
  with `source=pack_purchase`, `unit_cost = pack_price_gbp / (quantity + bonus_qty)` (Decimal 12,4),
  and expires_at per T03.

### 1.3 Custom top-up (T02)
- Learner enters an arbitrary cash amount; server converts using the configured `token_rate_gbp`
  (Decimal(12,4) GBP per token) → integer tokens = `floor(amount_gbp / token_rate_gbp)`.
- Bonus bands optional (A03). A top-up creates one `TokenGrant`.

### 1.4 Expiry (T03) — BLOCKED default duration
- Each grant carries its own `expires_at`. Default duration per source lives in platform settings.
  **BLOCKED:** the actual default duration (e.g. 12 months) is a policy decision.
- Background job `tokens.expire_grants` runs daily: marks fully-expired grants' remaining_qty into a
  closing `TokenLedgerEntry(kind=expiry)`; writes an `engagement.notify` 7 days ahead and on expiry day.

### 1.5 FEFO consumption (C04)
- Spend selects grants ordered by `expires_at ASC NULLS LAST, granted_at ASC`.
- Atomic via `SELECT … FOR UPDATE` on the wallet row + candidate grants inside one transaction.
- Partial grants permitted; each `TokenLedgerEntry` row records `grant_id`, `qty`, `unit_cost_at_spend`.

### 1.6 Content pricing in tokens (T05–T09, T14)
- Lectures AND materials (course downloadable resources) can carry a token price.
- Default distribution rule (C05, T14): when a course sets an aggregate token price, the system
  distributes tokens across lectures/materials proportionally to duration (video lectures) and
  equal weight for other lecture types / materials. Explicit per-lecture override wins.
- Changing pricing never retroactively alters already-granted unlocks (see T10, X03).

### 1.7 Token unlock → Entitlement (T05, T06, T10, X01, X03)
- A spend writes a `ContentEntitlement(source=token_spend, owner=user, scope=lecture|material|course,
  target_id, granted_at, expires_at=NULL, revocable=false)`.
- Entitlements are permanent once written (except admin-adjudicated clawback, A04).
- Learning app's `_check_unlocked` consults the entitlement resolver before falling back to
  enrollment-based access (see X-series below).

### Acceptance scenarios (Given/When/Then)

**AC-T-01 FEFO**
- Given a user has grants G1(100 tokens, expires in 30d) and G2(100 tokens, expires in 90d).
- When they spend 150 tokens on a lecture.
- Then G1 is fully consumed (100), G2 is debited 50, remaining balance is 50, and a single
  `TokenLedgerEntry` set references both grants in FEFO order.

**AC-T-02 Custom top-up rounding**
- Given `token_rate_gbp = 0.1000` and no bonus.
- When the user tops up £5.03.
- Then they receive `floor(5.03 / 0.1000) = 50` tokens, remainder £0.03 is retained as top-up
  overflow and shown as "£0.03 unused" on the receipt. (BLOCKED: whether overflow is credited back,
  rolled into next top-up, or forfeited — policy call.)

**AC-T-03 Pack purchase idempotency**
- Given a Stripe `checkout.session.completed` webhook arrives twice for the same session_id.
- When processed.
- Then exactly one `TokenGrant` is written (dedupe key = stripe_session_id in
  `commerce.StripeEvent` inbox).

**AC-T-04 Lecture unlock persists through price change**
- Given a user has spent tokens to unlock lecture L.
- When the instructor changes L's token price.
- Then the user still has an active `ContentEntitlement` for L.

**AC-T-05 Material unlock**
- Given lecture L has token price 10 and material M (PDF) has token price 5.
- When the user unlocks M only.
- Then L remains locked; file download for M is authorized by the entitlement resolver.

---

## 2. Cash Course Package (P01–P07)

- Reuses existing `commerce.Plan` + `Order` + Stripe Checkout pipeline. A "cash package" is a
  plan-like SKU bundling a fixed set of courses for a one-off price. Not a subscription.
- New model `CashPackage(name, slug, price_tier, is_active, starts_at, ends_at)` +
  `CashPackageCourse(package, course)` association. Reuses `PriceTier`/`PriceTierAmount` for
  multi-currency.
- Purchase creates `Order` + per-course `OrderItem` rows AND a `ContentEntitlement(source=package)`
  per included course (owner = user, scope = course, granted_at = paid_at, expires_at = NULL).
- Refund (P06): refunds the Order via existing Stripe refund flow, flips entitlements to
  `revoked_at = now()`. **BLOCKED (P06):** certificate interaction — if a certificate was
  issued during access, policy decision whether to revoke it.
- Instructor revenue: each included course is credited pro-rata by its list GBP price at the
  moment of package purchase (snapshot stored on `CashPackageCourse.snapshot_gbp_minor`), using
  existing `payouts.record_sale` per-item path. Platform fee = each instructor's own
  `platform_fee_bps`.

**AC-P-01 Pro-rata revenue**
- Given a package of two courses with list prices £40 and £60, package price £80.
- When purchased.
- Then instructor A earns 80 × (40/100) = £32 worth of revenue applied to their configured
  commission; instructor B earns £48. Snapshots stored on the items.

**AC-P-02 Package refund revokes entitlements**
- Given a package has been purchased and both courses unlocked.
- When staff refund the order.
- Then both `ContentEntitlement(source=package)` rows get `revoked_at` set and `_check_unlocked`
  no longer returns the courses via the package. Pre-existing entitlements from other sources
  (token spend, direct purchase) are untouched.

---

## 3. Unlimited Subscription (S01–S12)

- Extends existing `commerce.Plan` (which already has `Subscription`). A new plan type
  `kind = unlimited_b2c` (choice added — additive).
- Monthly and annual price via existing `PlanPrice`. Trial supported.
- While `Subscription.status in (trialing, active, past_due_within_grace)` the entitlement
  resolver returns "subscription access" for every course flagged `in_subscription=true` (existing
  column) and for every lecture/material inside such a course.
- Catalog eligibility (S02): `Course.in_subscription` already exists; keep it. Additionally allow
  per-lecture exclusion via a new `Lecture.excluded_from_subscription` flag.
- Grace period on `past_due` (S07): BLOCKED on exact duration.
- Grandfathering (S10, X05): existing active subscribers are not re-priced on plan changes until
  renewal. Admin can mark a plan version as "legacy" to pin current subscribers; new subscribers
  use the new plan version. **BLOCKED (S10):** whether a price change applies at next renewal
  automatically with notice period, or requires opt-in.
- Cancellation at period end preserves access until `current_period_end`.
- Certificate eligibility (S03, C03): a subscriber who completes a course gets a certificate
  issued as normal; if the subscription later lapses the certificate remains valid (immutable
  record), but the user loses future course access unless they still have token/package/direct
  entitlement.

**AC-S-01 Active subscription grants access**
- Given user U has active unlimited subscription and course C has `in_subscription=true`.
- When U opens C's first lecture.
- Then `_check_unlocked` returns unlocked; a `SubscriptionAccessEvent` is logged with
  `(user, course, lecture, duration_seconds)` for the revenue pool (F03).

**AC-S-02 Grace period**
- Given subscription status became `past_due` at T0 and grace = G days (BLOCKED).
- When the user opens a subscription course at T0 + G - 1 day → unlocked; at T0 + G + 1 day → locked
  (fallback to other entitlement sources).

**AC-S-03 Grandfathered price**
- Given user U is subscribed at £9/mo. Admin raises price to £12/mo.
- When U renews next cycle.
- Then (BLOCKED default) U either stays at £9 or is moved to £12 with N days notice; the chosen
  policy must be captured in `PlanVersion` audit trail.

---

## 4. Cross-Access Resolver (X01–X05, C01–C03)

Single authoritative function `platform.access.resolve(user, scope, target_id) -> AccessDecision`.

Resolution order (first matching wins):
1. Admin revoke (A04).
2. Direct enrollment (existing `learning.Enrollment` — paid purchase of the course). Highest-trust.
3. `ContentEntitlement(source=package)` active, not revoked.
4. `ContentEntitlement(source=token_spend)` active, not revoked.
5. Active unlimited subscription AND course is `in_subscription=true` AND lecture is not
   `excluded_from_subscription` (X02).
6. Preview flag on the lecture (existing `is_preview`) (X04).
7. DENY.

`AccessDecision` carries: `granted: bool`, `reason: str` (one of the above codes),
`source_entitlement_id | null`, `expires_at | null`. Reason is returned to the frontend for
badge rendering ("Owned", "In your plan", "Unlocked with tokens", "Preview").

**Certificate eligibility (C03).** Certificates are issued by the learning app on completion
regardless of access source — token unlocks, package, subscription and direct purchase are all
equally valid paths to a certificate unless the course specifies `certificate_requires_purchase=
true` (new optional flag on `Course`, default false). **BLOCKED:** whether subscription-based
completions earn certificates by default is C03 and must be confirmed.

**AC-X-01 Overlapping sources**
- Given user has BOTH direct enrollment and token entitlement for the same course.
- When they access it.
- Then resolver returns `reason=enrollment`; token entitlement remains untouched (not consumed, not
  deleted).

**AC-X-02 Subscription lapse with past token unlock**
- Given subscription lapses but a past token unlock exists on lecture L.
- When user opens L.
- Then unlocked via token entitlement, reason=token_spend.

---

## 5. Admin Pricing Console (A01–A06)

- Extends `backend/apps/platform/console/` with new sub-modules `tokens.py`, `packages.py`,
  `subscription_plans.py`, `wallet_adjust.py`, `bonus_campaigns.py`.
- Token pack CRUD, token rate CRUD, bonus-band CRUD, campaign scheduling.
- Manual wallet adjust (A04): creates a `TokenGrant(source=admin_adjustment)` or negative
  `TokenLedgerEntry(kind=admin_clawback)`. Always requires `reason`, written to `audit_log`.
- Bonus campaigns (A02, F02): time-boxed grants that add bonus tokens on either pack purchase
  or top-up. **BLOCKED (F02):** how bonus tokens are funded for instructor revenue weighting —
  are they `unit_cost=0` (platform-funded) or do they dilute the per-token cash rate for
  instructor payout.
- Reporting (A05): new console page aggregating wallet-balance totals, token circulation, token
  revenue, subscription MRR, package GMV. Reuse existing `console/reports.py` pattern.

**AC-A-01 Audit trail on wallet adjust**
- Given admin credits user U with 500 tokens, reason "goodwill".
- When submitted.
- Then a `TokenGrant(source=admin_adjustment, qty=500, unit_cost=0, reason)` is written AND an
  `audit_log` row with actor, target user, amount, reason is written in the same transaction.

---

## 6. Instructor Finance (F01, F04, F05 — F02/F03/C06 BLOCKED)

- **F01 Token spend earnings.** When a lecture/material of instructor I is unlocked via tokens,
  a new `Earning(kind=token_spend, channel=token_spend, course, user=I)` row is written. Amount:
  `gross_gbp_minor = tokens_spent × grant.unit_cost × share_bps / 10000`. `unit_cost` is read
  from the specific `TokenGrant`(s) consumed; weighted average when a spend spans multiple grants.
- **F04 Cash commission.** Existing `payouts.record_sale` path, unchanged.
- **F05 Platform fee.** Reuse existing per-instructor `platform_fee_bps` from
  `identity.instructor_profiles`.
- **F02 Bonus-token funding — BLOCKED.** Must decide: platform-absorbed (instructor paid as if
  real cash) vs instructor-absorbed (unit_cost = 0, instructor earns 0 from bonus spend) vs
  pooled.
- **F03 / C06 Subscription weighted revenue share — BLOCKED.** The scaffolding ships: all
  subscription access events are logged with duration and course attribution into a new
  `SubscriptionAccessEvent` table, and a nightly job computes a per-instructor-per-month pool
  share. The *weights* (minutes watched, unique learners, completion events) and the pool % to
  distribute (currently 25% per existing `RevenueShare(subscription_pool)`) must be confirmed.

**AC-F-01 Token-spend earning**
- Given a learner spends 50 tokens on instructor I's lecture, FEFO consumes one grant with
  unit_cost £0.08 and the instructor's `platform_fee_bps` is 2000 (keeps 80%).
- When processed.
- Then `Earning(kind=token_spend, gross_gbp_minor = 50 × 0.08 × 100 = 400 minor,
  share_bps = 8000, amount_gbp_minor = 320)` is written, available_at = earned_at + hold_window.

---

## 7. Media authorization

- Lecture video play URLs and material download URLs are generated server-side; both now go
  through the cross-access resolver (section 4). Bunny signed tokens and Azure Blob SAS URLs
  only issued after resolver returns `granted=true`.
- Short TTL (reuse existing TTL).

---

## 8. Grandfathering (X05)

- Existing course owners (direct purchases, pre-v2 team-plan buyers in B2C scope) keep access —
  no data migration required because `learning.Enrollment` is already the source of truth for
  "owned".
- Existing subscribers keep their current price until renewal (see S10 BLOCKED).
- No existing B2B org data touched. Enforced by a release-gate test.
