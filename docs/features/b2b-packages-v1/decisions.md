# B2B Corporate Packages — Decision Register vs Code Audit

**Date:** 2026-11-11
**Scope:** Maps every approved product decision (Section A) to current code state.
**Convention:** *Verified* = confirmed by reading source. *Gap* = does not exist yet.

---

## Foundational

### F-01: B2B offers packages only (Recorded + Corporate Live)

| Aspect | Current state |
|--------|---------------|
| **Verified** | `Order` / `OrderItem` (`apps/commerce/models.py`) support one-off purchases with `org` FK (MixedTenantModel). Course pricing exists via `CoursePrice` / `PriceTier`. |
| **Gap** | No per-course per-delivery-type (recorded vs live) corporate pricing model. No `CorporateOffering`, `DeliveryVariant`, or per-seat pricing entity. |
| **Action** | B2B-01: Add `CorporateOffering` with delivery_type enum (recorded / live), per-seat pricing, course FK, and admin CRUD. |

### F-02: No B2B tokens, no personal unlimited subscription for B2B

| Aspect | Current state |
|--------|---------------|
| **Verified** | B2C token wallet (`apps/commerce/wallet.py`), unlimited subscription (`apps/commerce/subscriptions.py`), and token API (`apps/commerce/token_api.py`) are all personal-only (no org FK). `Plan.kind = "unlimited_b2c"` explicitly scoped. |
| **Compatibility** | No conflict. B2B packages are a completely separate purchase path. Token and subscription code does not need modification. |

### F-03: No new Team Subscription checkout; preserve historical team subscriptions

| Aspect | Current state |
|--------|---------------|
| **Verified** | `Plan.audience = "team"` with `min_seats` exists. `Subscription` has `org` FK and `seats` field. Webhook handler `_subscription_changed()` syncs status. `Entitlement` model (`apps/platform/models.py` line 41) grants org features like `"business"` via source `subscription`. |
| **Action** | Keep existing team subscription models and webhook handling intact. New B2B purchase path must NOT create `Subscription` rows — it creates `CorporateSeatInventory` / `SeatAllocation` instead. |
| **Risk** | If `start_subscription()` in `apps/commerce/services.py` is accidentally called for B2B, it would create a subscription. Guard with explicit checks. |

---

## Corporate Live — L01–L08

### L01: Multiple companies may share one corporate live cohort

| Aspect | Current state |
|--------|---------------|
| **Verified** | No cohort model exists. `Lecture.Kind.LIVE_SESSION` (`apps/catalog/models.py` line 267) is a single-lecture type with `live_starts_at`, `live_duration_min`, `live_join_url` — no multi-company grouping. |
| **Gap** | Need `LiveCohort` model (course FK, delivery_mode, status, min/max seats) with a join table allowing multiple orgs. RLS must prevent org A from seeing org B's employees while sharing the same cohort. |
| **RLS note** | `core.rls.company_only` won't work for cross-company tables. Need either `staff_only` for admin-managed cohort tables, or a new RLS policy that reveals only rows matching the requesting org's participation. |

### L02: Platform Admin defines min/max learners per live course

| Aspect | Current state |
|--------|---------------|
| **Verified** | No min/max headcount fields on any model. |
| **Gap** | Add `min_learners` / `max_learners` to `CorporateOffering` (delivery_type=live) or to `LiveCohort`. |

### L03: Three main annual intakes + optional ad hoc cohorts

| Aspect | Current state |
|--------|---------------|
| **Gap** | No intake/scheduling infrastructure. Need `Intake` reference model (name, year, start/end window) and `LiveCohort.intake` FK (nullable for ad hoc). Admin CRUD only. |

### L04: Company payment for Live is AFTER admin forms cohort and confirms schedule

| Aspect | Current state |
|--------|---------------|
| **Verified** | `gateway.create_checkout_session()` (`apps/commerce/gateway.py`) supports `mode="payment"` with org customer. |
| **Gap** | Live checkout must be gated on cohort status (confirmed schedule). Need state machine: request → proposed → approved → pending_payment → booked. Payment only available at pending_payment. |

### L05: Platform Admin coordinates tutors and participating companies

| Aspect | Current state |
|--------|---------------|
| **Verified** | `CourseInstructor` (`apps/catalog/models.py` line 193) links users to courses with `can_edit`, `is_visible`, `revenue_share_bps`. |
| **Gap** | Need `Tutor` model or role distinction (internal/external, approval status) and `CohortTutor` assignment. `CourseInstructor` is for marketplace courses — tutors for corporate live may not be the same people. |

### L06: Skills Radar SUSPENDED — no assessment engine in this release

| Aspect | Current state |
|--------|---------------|
| **Verified** | Quiz/Assignment models exist (`apps/catalog/models.py`) but these are course content, not skills assessment/placement. No Skills Radar, scoring, or placement models. |
| **Action** | Do NOT build any skills assessment tables, endpoints, or UI. Any level grouping is manual admin decision. |

### L07: If cohort doesn't form, admin extends or offers alternative

| Aspect | Current state |
|--------|---------------|
| **Gap** | Need cohort status transitions: `pending` (waiting for seats) → admin extends enrollment window or creates alternative cohort. No auto-cancellation timer — admin decides. |

### L08: Different learner levels — admin reviews manually

| Aspect | Current state |
|--------|---------------|
| **Verified** | `Course.level` field exists (beginner/intermediate/advanced/all). |
| **Action** | Display level in admin cohort formation UI. No automated placement. Admin sees requested courses + levels and manually assigns companies to cohorts. |

---

## Tutor & Scheduling — U01–U07

### U01: Internal/external tutors require Platform Admin approval

| Aspect | Current state |
|--------|---------------|
| **Gap** | No tutor approval workflow. Need `Tutor` model with `kind` (internal/external), `status` (pending/approved/rejected/suspended), approval timestamps, admin notes. |

### U02: Live delivery modes: Online, In-person, Hybrid

| Aspect | Current state |
|--------|---------------|
| **Gap** | No delivery mode field. Add `delivery_mode` enum (online/in_person/hybrid) to `LiveCohort`. Affects Zoom integration scope and attendance tracking. |

### U03: Only Platform Admin publishes schedules

| Aspect | Current state |
|--------|---------------|
| **Verified** | Console routes use `StaffSessionAuth` (`apps/platform/console/common.py`). All admin actions staff-only. |
| **Action** | All schedule CRUD endpoints go under `/api/v1/console/` with staff auth. No tutor or company self-service scheduling. |

### U04: Platform Admin approval confirms schedule

| Aspect | Current state |
|--------|---------------|
| **Action** | Schedule status: draft → published. Only staff can transition. `audit_request()` (`apps/platform/services.py`) for audit trail. |

### U05: Employee sees first session only until it ends; buyer sees enough for payment approval

| Aspect | Current state |
|--------|---------------|
| **Verified** | Learning API (`apps/learning/api.py` line 231) already hides join URLs until 15 min before start. |
| **Gap** | Need session-level visibility logic: employee sees session[0] details always + remaining sessions only after session[0].ends_at passes. Company buyer (owner/admin) sees all session dates/times (needed for L04 payment approval) but not join URLs. |
| **Complexity** | Requires two visibility tiers based on role + time. |

### U06: Store company live attendance in Neon

| Aspect | Current state |
|--------|---------------|
| **Verified** | `ProgressEvent` (`apps/learning/models.py`) stores video watch events. No live attendance model. |
| **Gap** | Need `SessionAttendance` model: session FK, user FK, org FK, join/leave intervals, total duration, source (zoom/manual/qr), verification status, evidence ref. |
| **Note** | Recorded progress stays in existing `LectureProgress` / `ProgressEvent`. Live attendance is a separate model. |

### U07: Admin may replace tutor or reschedule; notify and audit

| Aspect | Current state |
|--------|---------------|
| **Verified** | `audit_request()` and `audit()` exist in `apps/platform/services.py`. `notify()` in `apps/engagement/notify.py` supports bulk notification with deduplication. |
| **Action** | Tutor replacement and reschedule are admin console actions. Fire notifications to all enrolled employees and company admins. Audit every change. |

---

## Corporate Seats, Payment & Pricing — Q01–Q08

### Q01: Recorded purchase through existing Stripe infrastructure

| Aspect | Current state |
|--------|---------------|
| **Verified** | `gateway.create_checkout_session(mode="payment", ...)` works. `Order`/`OrderItem` support `org` FK. Webhook fulfillment is idempotent via `StripeEvent.event_id`. |
| **Action** | Extend existing checkout flow: company owner/admin creates order for N recorded seats → Stripe Checkout → webhook fulfils → credits seat inventory. Reuse `Order`/`OrderItem` with new item type for corporate seats. |

### Q02: Independent price per course per seat for recorded/live; custom quote optional

| Aspect | Current state |
|--------|---------------|
| **Verified** | `CoursePrice` is 1:1 per course (B2C). `PriceTier` + `PriceTierAmount` handle multi-currency. |
| **Gap** | Need `CorporateOffering` with own price_tier FK per delivery_type. One course can have different prices for recorded vs live, separate from B2C price. Custom quote is a separate admin-authored price. |

### Q03: Stripe is the ONLY payment provider

| Aspect | Current state |
|--------|---------------|
| **Verified** | `apps/commerce/gateway.py` is Stripe-only. No other payment provider code. |
| **Action** | Continue Stripe-only. Add Stripe Invoicing API calls for B2B invoice flow. |

### Q04: Company orders seat quantity now, names employees later

| Aspect | Current state |
|--------|---------------|
| **Gap** | No seat inventory model. Need: `PurchasedSeatInventory` (org, offering, quantity_purchased, quantity_allocated, order FK, stripe refs) and `SeatAllocation` (inventory FK, user FK, allocated_at, status). Purchase creates inventory; allocation assigns individual users later. |

### Q05: Seat reassignment requires Admin approval + immutable audit

| Aspect | Current state |
|--------|---------------|
| **Verified** | `OrgMember.removed_at` supports soft-delete. `audit()` exists. |
| **Gap** | Need seat reassignment workflow: old allocation revoked → new allocation created → enrollment transferred or new enrollment created. Admin approval gate. All state changes audited. Old allocation record preserved (never deleted). |

### Q06: Recorded access lifetime by default; admin may configure expiration

| Aspect | Current state |
|--------|---------------|
| **Verified** | `Enrollment.access_expires_at` exists (nullable = lifetime). `Course.access_days` exists (nullable = lifetime). |
| **Action** | When allocating a recorded seat, set `access_expires_at` based on admin-configured expiry on the offering (if set), else NULL (lifetime). |

### Q07: Live reservation has admin-configured payment deadline; unpaid holds release

| Aspect | Current state |
|--------|---------------|
| **Gap** | Need `ProvisionalSeatReservation` with `expires_at` (admin-set TTL). Background job releases expired unpaid holds, returning seats to cohort capacity. |

### Q08: Live refund/cancellation — admin case-by-case

| Aspect | Current state |
|--------|---------------|
| **Verified** | `gateway.refund()` exists. `Refund` model exists with status tracking. |
| **Action** | Admin-initiated refund creates `Refund` row, calls `gateway.refund()`, revokes seat allocations. No automated refund calculation — admin enters amount. Legal protections per G04. |

---

## Round 4 — P09–P11

### P09: Optional custom quote for both recorded and live

| Aspect | Current state |
|--------|---------------|
| **Gap** | No quote model. Need `CorporateQuote` (org, offering, quantity, unit_price_override, currency, valid_until, status: draft/sent/accepted/expired/rejected, created_by staff). When accepted, serves as price source for checkout. |

### P10: Only active Company Owner/Admin may purchase

| Aspect | Current state |
|--------|---------------|
| **Verified** | `require_org_role(request, OrgRole.ADMIN)` in `core/permissions.py` gates by role rank. Owner > Admin > Manager > Learner. Commerce API already uses `_billing_owner(request)` which requires ADMIN. |
| **Action** | All B2B checkout endpoints require `OrgRole.ADMIN` minimum. Existing pattern is sufficient. |

### P11: Support Stripe Checkout AND Stripe Invoicing

| Aspect | Current state |
|--------|---------------|
| **Verified** | `gateway.create_checkout_session()` handles Checkout. `Invoice` model stores invoice data from webhooks. |
| **Gap** | **No Stripe Invoicing API in gateway.** Need to add: `create_invoice(customer, items, metadata)`, `finalize_invoice(invoice_id)`, `send_invoice(invoice_id)`, `void_invoice(invoice_id)`. Webhook handlers for `invoice.paid`, `invoice.payment_failed`, `invoice.voided` need B2B-specific dispatch. |
| **Critical** | Never mark invoice paid on creation — only on verified `invoice.paid` webhook event. |

---

## Round 4 — S09–S11

### S09: Recorded seat = USED once ASSIGNED, not at first video play

| Aspect | Current state |
|--------|---------------|
| **Action** | `SeatAllocation.status = "allocated"` marks the seat as used. Decrement `quantity_available` on allocation, not on first enrollment activity. |

### S10: Unassigned recorded seats don't expire; allocated access is lifetime (default)

| Aspect | Current state |
|--------|---------------|
| **Action** | `PurchasedSeatInventory` has no expiry on unallocated seats (while course exists). `SeatAllocation` → `Enrollment.access_expires_at` = NULL by default, unless admin-configured Q06 expiry applies. |
| **Gate** | Course deletion/archiving effect on prepaid unused seats = G05. |

### S11: Splitting live seats across cohorts requires company approval

| Aspect | Current state |
|--------|---------------|
| **Action** | If admin wants to split company's N seats into cohort A (M seats) and cohort B (N-M seats), company owner/admin must approve. Implement as admin action that generates approval request visible to company. |

---

## Round 4 — D01–D03

### D01: Employer sees own employees' corporate learning activity only

| Aspect | Current state |
|--------|---------------|
| **Verified** | `apps/org/api.py` exposes `GET /assignments` scoped by `org_scope(request, OrgRole.MANAGER)`. `ProgressEvent` has `org_id` column. Enrollment is MixedTenantModel. RLS `company_only` on org tables. |
| **Action** | Extend employer dashboard with: lecture times, attendance, completion, certificates. All queries scoped by org_id RLS. Never expose personal B2C courses (org_id=NULL enrollments invisible to company). |

### D02: Tutor sees cohort-related reports (POLICY GATE G03)

| Aspect | Current state |
|--------|---------------|
| **Gap** | No tutor-scoped data access. Need `CohortTutor` join and a tutor API that filters by assigned cohort membership. |
| **Gate** | G03 — scope of tutor cross-company data. Safe default: learning/attendance reports for assigned cohort learners only, no HR/finance/personal B2C data. |

### D03: Learner leaving employer — configurable policy

| Aspect | Current state |
|--------|---------------|
| **Verified** | `OrgMember.removed_at` for soft-delete. `Enrollment.status` can be set to `revoked`. |
| **Gate** | G07 — exact departure policy options. Preserve historical evidence. Do not transfer company-paid entitlement to personal. |

---

## Round 4 — I01–I03

### I01: Zoom is the selected online meeting provider

| Aspect | Current state |
|--------|---------------|
| **Verified** | **No Zoom code exists in the repository.** Zero matches for "zoom" in all backend files. |
| **Gap** | Entirely greenfield. Need: Zoom OAuth app, API client, webhook receiver, meeting creation, participant identity matching. |

### I02: Automatic attendance via Zoom webhooks + identity matching

| Aspect | Current state |
|--------|---------------|
| **Gap** | Need: `ZoomMeeting` (cohort session FK, zoom_meeting_id, zoom_occurrence_id), `ZoomParticipant` (raw event data), `SessionAttendance` (normalized, verified). Identity matching by email with fallback to admin review for unmatched. |
| **Critical** | Zoom webhook participant emails not guaranteed for external accounts. Never infer identity from display name alone. Queue unresolved for admin. |

### I03: First session visible until it ends, then full schedule revealed

| Aspect | Current state |
|--------|---------------|
| **Note** | Same as U05. Implement as query filter: for learner role, return `sessions.filter(position=0)` until `session[0].actual_end_at` is set, then return all. |

---

## Deferred Items (explicitly NOT built)

| Item | Status |
|------|--------|
| Skills Radar (R01–R07) | WITHDRAWN — no tables, endpoints, scoring, or placement |
| Kent Business College live classes for corporate | NOT REVIVED — corporate cohorts are separate |
| B2B token wallet | NOT APPLICABLE — B2B is packages only |
| B2B personal unlimited subscription | NOT APPLICABLE — B2B is packages only |
| New team subscription checkout | NOT BUILT — preserve historical only |
