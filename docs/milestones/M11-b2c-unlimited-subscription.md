# M11 — Unlimited Subscription (monthly / annual) (S01–S12)

**Goal.** A new `Plan.kind = unlimited_b2c` that grants access to every `in_subscription=true`
course, Stripe-managed, with grace, trials, and grandfathering scaffolding.

## Scope
1. Additive choice: `Plan.kind` gains `unlimited_b2c`.
2. New `platform.SubscriptionAccessEvent` (user, course, lecture, seconds_consumed,
   subscription_id, session_date). Written by learning progress heartbeats when the resolved
   access reason is `subscription`.
3. Additive learning columns: `Lecture.excluded_from_subscription` (bool),
   `Course.certificate_requires_purchase` (bool) — reserved for C03.
4. Resolver (`platform.access.resolve`) gains the `subscription` branch, honouring status
   (trialing/active/past_due within grace) and the exclusion flag.
5. Checkout: `POST /api/v1/subscriptions/checkout` (unlimited_b2c kind), reuse existing Stripe
   subscription pipeline.
6. Webhook: existing handlers continue; add branch to record `SubscriptionEvent` kinds for
   unlimited plans.
7. Grace period service (BLOCKED S07 for duration).
8. Frontend: subscription landing + manage; "In your plan" badge on course cards and lecture
   outlines, driven by resolver reason code.

## Acceptance
1. Active subscriber sees course outline with every eligible lecture unlocked; excluded
   lectures stay locked unless another source grants them.
2. Cancelled-at-period-end subscriber keeps access until `current_period_end`.
3. Completing a subscribed course issues a certificate (C03 default) — this is explicitly
   BLOCKED pending confirmation; ship behind feature flag `b2c.sub_certificates`.
4. Subscription access during a lecture writes exactly one `SubscriptionAccessEvent` per
   heartbeat batch (scaffolding for F03).

## BLOCKED (would prevent GA)
- **S03 / C03** certificate on subscription completion.
- **S07** grace period duration.
- **S10** price change policy for existing subscribers (X05 grandfathering).

## Dependencies
M9 (resolver).
