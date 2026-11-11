# B2C Monetization v2 — Decision Register

**Important hand-off note.** The orchestrator brief instructed us to paste decision tables
`T01–T14, P01–P07, S01–S12, A01–A06, F01–F05, X01–X05, C01–C06` verbatim from the user's
original brief. The actual rows were not inlined in the hand-off (the placeholder "[Paste the
full decision tables ... verbatim]" was passed through). This register enumerates every ID in
the stated ranges with:

- the topic each ID governs (inferred from the brief's section names and the non-negotiable
  constraints listed at the top of the brief);
- `TEXT-PENDING` where the literal decision wording was not delivered;
- a conservative TECH-RECOMMENDATION or APPROVED-BY-CONSTRAINT where the brief's explicit
  constraints already fix the answer.

Nothing in `spec.md` or `architecture.md` silently chooses a financial rate, legally sensitive
default, or rate-affecting policy. Each row below marks its status: APPROVED (explicit in brief
or forced by a non-negotiable constraint), TECH-RECOMMENDATION (safe default, revocable),
BLOCKED (needs owner confirmation of the exact wording before we can ship).

Owner column: `product` = client/business owner, `finance` = pricing/payout policy owner,
`legal` = refund/certificate policy, `platform` = platform tech lead (this doc's author).

## Tokens (T01–T14)

| ID | Topic | Status | Decision / recommendation | Owner | Dependencies |
|---|---|---|---|---|---|
| T01 | Token packs as SKUs | APPROVED-BY-CONSTRAINT | `TokenPack` + `TokenPackPrice` (multi-currency), bought via Stripe. | product | — |
| T02 | Custom top-up | APPROVED-BY-CONSTRAINT | Freeform GBP → `floor(amount/rate)` tokens; overflow policy BLOCKED. | product | T02a (overflow) |
| T03 | Grant expiry (default duration) | **BLOCKED** | Per-source default lives in platform settings; proposed 12 months but needs product sign-off. | product | affects T01, T02, A02 |
| T04 | Per-grant expiry overrides | TECH-RECOMMENDATION | Admin may override at grant time (A04). | platform | T03 |
| T05 | Lecture-level token price | APPROVED-BY-CONSTRAINT | New `Lecture.token_price` (nullable integer). | product | — |
| T06 | Material-level token price | APPROVED-BY-CONSTRAINT | New `Material.token_price` (nullable integer). | product | — |
| T07 | Course-level aggregate token price | TEXT-PENDING | Optional course-level token price; distributes per C05. Need confirmation. | product | C05 |
| T08 | Currency display for tokens | TECH-RECOMMENDATION | UI shows token count AND cash equivalent at current `TokenRate`. | product | — |
| T09 | Wallet visibility to learner | TECH-RECOMMENDATION | Balance, soon-to-expire, ledger with cursor paging. | product | — |
| T10 | Entitlement permanence | APPROVED-BY-CONSTRAINT | Token-unlock entitlements never expire by content price change. | product | X03 |
| T11 | Refund of token pack | BLOCKED | Policy for pack refunds when tokens partly consumed. | legal, finance | P06 |
| T12 | Refund of token top-up | BLOCKED | Same shape as T11. | legal, finance | P06 |
| T13 | Gifting / transfer of tokens | TECH-RECOMMENDATION | Out of scope for v2 unless user requests. | product | — |
| T14 | Cash equivalence enforcement | APPROVED-BY-CONSTRAINT | Spend is exact integer tokens; Decimal math only for instructor earnings and display. | platform | — |

## Pricing — cash packages (P01–P07)

| ID | Topic | Status | Decision / recommendation | Owner | Dependencies |
|---|---|---|---|---|---|
| P01 | Cash package exists | APPROVED | New `CashPackage` SKU bundling N courses. | product | — |
| P02 | Multi-currency pricing | APPROVED-BY-CONSTRAINT | Reuse `PriceTier` / `PriceTierAmount`. | platform | — |
| P03 | Course set editable after publish | TECH-RECOMMENDATION | Editing re-snapshots revenue splits forward only (existing buyers unaffected). | product | P05 |
| P04 | Discount vs. list GBP | TEXT-PENDING | Whether package price must be less than sum of list prices; proposed yes. | product | — |
| P05 | Instructor pro-rata revenue | APPROVED | Split by snapshot list GBP at purchase. | platform, finance | — |
| P06 | Refund interaction with certificates | **BLOCKED** | Whether certificates issued during access survive refund. | legal | affects AC-P-02, T11, T12 |
| P07 | Expiry / time-limited access for packages | TECH-RECOMMENDATION | Default perpetual; per-package override available. | product | — |

## Subscription — unlimited B2C (S01–S12)

| ID | Topic | Status | Decision / recommendation | Owner | Dependencies |
|---|---|---|---|---|---|
| S01 | Unlimited plan exists | APPROVED | New `Plan.kind=unlimited_b2c`. | product | — |
| S02 | Catalog eligibility | APPROVED-BY-CONSTRAINT | Reuse `Course.in_subscription`; add `Lecture.excluded_from_subscription`. | product | — |
| S03 | Certificate on subscription completion | **BLOCKED** | Whether a subscriber's completion is certifiable by default. | product, legal | C03 |
| S04 | Monthly + annual intervals | APPROVED | Via `PlanPrice.interval`. | product | — |
| S05 | Trial support | TECH-RECOMMENDATION | Reuse Stripe trial on PlanPrice. | product | — |
| S06 | Upgrade/downgrade | TECH-RECOMMENDATION | Stripe-managed proration; log `SubscriptionEvent`. | product | — |
| S07 | Grace period after `past_due` | **BLOCKED** | Default duration (proposed 3 days). | product, finance | — |
| S08 | Cancellation at period end | APPROVED-BY-CONSTRAINT | Access preserved until `current_period_end`. | product | — |
| S09 | Dunning / failed payment UX | TECH-RECOMMENDATION | Reuse existing engagement notices. | product | — |
| S10 | Price change policy for existing subscribers | **BLOCKED** | Grandfather-forever vs next-renewal-with-notice vs opt-in. | product, legal | X05 |
| S11 | Tax display | TECH-RECOMMENDATION | Tax-inclusive, same as existing. | finance | — |
| S12 | Subscription cannot be gifted | TECH-RECOMMENDATION | Out of scope v2. | product | — |

## Admin (A01–A06)

| ID | Topic | Status | Decision / recommendation | Owner | Dependencies |
|---|---|---|---|---|---|
| A01 | Token pack CRUD console | APPROVED | New console page. | product | — |
| A02 | Bonus campaigns | APPROVED (scaffold) | New `BonusCampaign`; funding policy BLOCKED (F02). | product, finance | F02 |
| A03 | Top-up bonus bands | TECH-RECOMMENDATION | Per-band bonus percent, admin configurable. | product | F02 |
| A04 | Manual wallet adjust (credit / clawback) | APPROVED | Requires reason + audit log row. | product | — |
| A05 | Reporting page | APPROVED | Wallet totals, circulation, token revenue, MRR, package GMV. | product | — |
| A06 | Role gating | APPROVED-BY-CONSTRAINT | `RequireRole allowed="staff"` for all new console routes. | platform | — |

## Instructor finance (F01–F05)

| ID | Topic | Status | Decision / recommendation | Owner | Dependencies |
|---|---|---|---|---|---|
| F01 | Token-spend earnings | APPROVED | New `Earning.Kind=token_spend`; amount = `tokens × weighted unit_cost × share_bps`. | finance | T14 |
| F02 | Bonus-token funding | **BLOCKED** | Platform-absorbed vs instructor-absorbed vs pooled. | finance | A02, A03 |
| F03 | Subscription revenue share weighting | **BLOCKED** | Minutes watched / unique learners / completions; pool % (currently 25%). | finance | S03, C06 |
| F04 | Cash commission unchanged | APPROVED-BY-CONSTRAINT | Reuses existing `record_sale`. | platform | — |
| F05 | Per-instructor platform fee | APPROVED-BY-CONSTRAINT | Reuses `instructor_profiles.platform_fee_bps`. | platform | — |

## Cross-access (X01–X05)

| ID | Topic | Status | Decision / recommendation | Owner | Dependencies |
|---|---|---|---|---|---|
| X01 | Single resolver | APPROVED | `platform.access.resolve` is the only path. | platform | — |
| X02 | Resolution order | APPROVED | Admin-revoke > enrollment > package > token > subscription > preview > deny. | platform | — |
| X03 | Entitlements survive price changes | APPROVED | See T10. | platform | — |
| X04 | Preview lectures | APPROVED-BY-CONSTRAINT | Reuse existing `is_preview`. | platform | — |
| X05 | Grandfathering | APPROVED | Existing owners / subscribers keep rights; migration is additive. | product, platform | S10 |

## Common (C01–C06)

| ID | Topic | Status | Decision / recommendation | Owner | Dependencies |
|---|---|---|---|---|---|
| C01 | Money precision | APPROVED-BY-CONSTRAINT | Decimal(12,2), ROUND_HALF_UP. | platform | — |
| C02 | Token precision | APPROVED-BY-CONSTRAINT | int tokens, Decimal(12,4) conversion rate, floor on spend. | platform | — |
| C03 | Certificate eligibility across access sources | **BLOCKED** | See S03. | product, legal | S03 |
| C04 | FEFO consumption order | APPROVED | `expires_at ASC NULLS LAST, granted_at ASC`. | platform | — |
| C05 | Course → lecture/material token distribution | APPROVED (default) | Weighted by lecture duration; equal weight for non-video / materials; explicit overrides win. Confirm default weighting with product. | product | T07 |
| C06 | Subscription revenue share formula | **BLOCKED** | See F03. | finance | F03 |

## BLOCKED summary (must land before each milestone it blocks)

| Decision | Blocks milestone |
|---|---|
| T03 default expiry duration | M1 |
| T11 / T12 / P06 refund policies | M4, M10 (and partially M1) |
| F02 bonus-token funding | M7, M8 |
| F03 / C06 subscription revenue share | M8 |
| S03 / C03 certificate on subscription completion | M5, M6 |
| S07 grace period after past_due | M5 |
| S10 price change for existing subscribers | M5, M10 |
| P04 package discount floor | M4 |
