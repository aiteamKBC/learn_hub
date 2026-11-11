# B2B Corporate Packages — State Machines

**Document:** B2B-00 Architecture Audit
**Status:** Design proposal — awaits owner review

---

## 1. SeatPurchase Lifecycle

A `SeatPurchase` represents a company buying N seats of a course (recorded or live).

```
                    ┌─────────────────┐
                    │ pending_payment  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │   paid   │  │  failed  │  │ expired  │
        └────┬─────┘  └──────────┘  └──────────┘
             │
     ┌───────┴────────┐
     ▼                ▼
┌────────────┐ ┌──────────────┐
│ partially  │ │    fully     │
│ allocated  │ │  allocated   │
└─────┬──────┘ └──────┬───────┘
      │                │
      ▼                ▼
┌─────────────────────────────┐
│  partially_refunded         │
│  fully_refunded             │
└─────────────────────────────┘
```

| Transition | Guard | Actor | Side effects |
|-----------|-------|-------|-------------|
| → `pending_payment` | Valid course, delivery type, quantity, buyer is CO/CA | CO/CA | Create Stripe Checkout Session or Stripe Invoice; snapshot price; `audit("seat_purchase_initiated")` |
| → `paid` | Stripe `checkout.session.completed` or `invoice.paid` with matching metadata | Stripe webhook | Credit seat inventory; `audit("seat_purchase_paid")`; notify buyer; create `Invoice` record |
| → `failed` | Stripe `checkout.session.async_payment_failed` or `invoice.payment_failed` | Stripe webhook | `audit("seat_purchase_failed")`; notify buyer |
| → `expired` | Stripe `checkout.session.expired` or invoice TTL exceeded | Stripe webhook / cron | `audit("seat_purchase_expired")` |
| `paid` → `partially_allocated` | At least 1 seat allocated, remaining > 0 | CO/CA/CM | See SeatAllocation lifecycle |
| `paid` → `fully_allocated` | All seats allocated (remaining = 0) | CO/CA/CM | `audit("purchase_fully_allocated")` |
| → `partially_refunded` | Admin approves partial refund; only unallocated seats refundable | PA | Stripe refund (partial); reduce seat count; `audit("seat_purchase_partial_refund")` |
| → `fully_refunded` | Admin approves full refund; all seats unallocated or revoked first | PA | Stripe full refund; revoke any active allocations; `audit("seat_purchase_full_refund")` |

**Concurrency:** Allocation count checked atomically with `SELECT ... FOR UPDATE` on the purchase row. Prevents over-allocation under concurrent requests.

**Idempotency:** Stripe session/invoice ID is unique key. Duplicate `paid` events are no-ops (existing `StripeEvent.event_id` dedup pattern).

---

## 2. SeatAllocation Lifecycle

A `SeatAllocation` tracks one employee's assignment to a purchased seat.

```
                ┌────────────┐
                │  allocated │ ──── seat claimed from inventory
                └─────┬──────┘
                      │
                      ▼
                ┌────────────┐
                │   active   │ ──── enrollment created
                └──┬─────┬───┘
                   │     │
                   ▼     ▼
            ┌──────────┐ ┌──────────┐
            │ revoked  │ │ released │
            └──────────┘ └──────────┘
```

### Recorded Delivery

| Transition | Guard | Actor | Side effects |
|-----------|-------|-------|-------------|
| → `allocated` | Purchase is paid; remaining seats > 0; employee is active OrgMember | CO/CA/CM¹ | Decrement remaining; `audit("seat_allocated")`; notify employee |
| → `active` | Immediate on allocation for recorded | System | Create `Enrollment(source="organization", org=org)`; set `access_expires_at` per Q06 config (NULL = lifetime) |
| → `revoked` | PA approves revocation (Q05 replacement) | PA | Revoke enrollment (status=revoked); increment remaining seats; `audit("seat_revoked")`; notify employee + buyer |
| → `released` | Seat unassigned before enrollment (rare edge) | CO/CA | Increment remaining; `audit("seat_released")` |

### Live Delivery

| Transition | Guard | Actor | Side effects |
|-----------|-------|-------|-------------|
| → `allocated` | Purchase paid; cohort has capacity; employee is active OrgMember | CO/CA | Decrement remaining + cohort capacity; `audit("live_seat_allocated")` |
| → `active` | Cohort status = `in_progress` and employee enrolled | System | Create `Enrollment(source="organization", org=org)` |
| → `revoked` | PA approves; cohort not yet completed | PA | Revoke enrollment; adjust cohort count; `audit("live_seat_revoked")` |

> ¹ Manager allocation is scoped to managed units via `org_scope()`.

**Recorded seat lifetime (S10):** Unallocated recorded seats remain available indefinitely while the course exists. Allocated learner access is lifetime by default, configurable via Q06 admin expiry. These are two separate clocks (G06).

**Live seat lifetime:** Live rights end when the cohort completes. Live is NOT a subscription.

---

## 3. TrainingRequest Lifecycle

A company requests live training for a course/quantity. Admin aggregates demand privately.

```
┌───────────┐     ┌───────────────┐     ┌─────────────┐
│ submitted │────▶│ under_review  │────▶│ scheduling  │
└───────────┘     └───────────────┘     └──────┬──────┘
                                               │
                          ┌────────────────────┼────────────────┐
                          ▼                    ▼                ▼
                   ┌────────────┐       ┌──────────┐    ┌───────────┐
                   │  offered   │       │ declined │    │ cancelled │
                   └─────┬──────┘       └──────────┘    └───────────┘
                         │
                  ┌──────┴──────┐
                  ▼             ▼
           ┌───────────┐ ┌──────────┐
           │ accepted  │ │ expired  │
           └─────┬─────┘ └──────────┘
                 │
                 ▼
          ┌────────────────┐
          │ pending_payment│───▶ (see SeatPurchase)
          └────────────────┘
```

| Transition | Guard | Actor | Side effects |
|-----------|-------|-------|-------------|
| → `submitted` | Valid course, delivery=live, quantity, company has active status | CO/CA | `audit("training_request_submitted")`; `notify_staff("new_training_request")` |
| → `under_review` | PA acknowledges | PA | `audit("training_request_reviewing")` |
| → `scheduling` | PA begins cohort formation; may combine with other company requests (L01) | PA | Link to forming cohort; `audit("training_request_scheduling")` |
| → `offered` | Cohort confirmed, schedule set, price set | PA | Notify buyer with schedule + price + payment deadline; `audit("training_request_offered")` |
| → `accepted` | Buyer approves offer within deadline | CO/CA | `audit("training_request_accepted")` |
| → `pending_payment` | Checkout/invoice created | CO/CA | Link to SeatPurchase; `audit("training_request_awaiting_payment")` |
| → `declined` | Buyer rejects offer | CO/CA | `audit("training_request_declined")`; notify PA |
| → `expired` | Offer deadline passed without acceptance | Cron | `audit("training_request_expired")`; notify buyer + PA |
| → `cancelled` | Company or PA cancels at any pre-payment stage | CO/CA/PA | `audit("training_request_cancelled")`; release any provisional reservation |

**Employer-facing status (L07):** Learner NEVER sees "waiting for enough people." Employer sees:
- `submitted` / `under_review` → **"Under Review"**
- `scheduling` → **"Scheduling"**
- `offered` / `accepted` / `pending_payment` → **"Offer Pending"** / **"Payment Required"**

---

## 4. LiveCohort Lifecycle

A cohort groups learners from one or more companies for a live course.

```
┌──────────┐     ┌────────────┐     ┌──────────────┐
│ forming  │────▶│ confirmed  │────▶│ in_progress  │
└──────────┘     └─────┬──────┘     └──────┬───────┘
     │                 │                    │
     ▼                 ▼                    ▼
┌────────────┐  ┌──────────────┐    ┌────────────┐
│ cancelled  │  │ cancelled    │    │ completed  │
└────────────┘  └──────────────┘    └────────────┘
```

| Transition | Guard | Actor | Side effects |
|-----------|-------|-------|-------------|
| → `forming` | PA creates cohort; links course, delivery mode, min/max seats | PA | `audit("cohort_created")` |
| `forming` → `confirmed` | Enrolled seats >= min; schedule set; tutor assigned | PA | Lock schedule; notify participating companies; `audit("cohort_confirmed")` |
| `confirmed` → `in_progress` | First session start time reached | System/cron | `audit("cohort_started")` |
| `in_progress` → `completed` | Last session completed or PA marks complete | PA/system | Finalize attendance; trigger certificate eligibility check (GATED G01); `audit("cohort_completed")` |
| → `cancelled` | Insufficient demand (L07) or admin decision; must be before `in_progress` | PA | Release all seat allocations; trigger refund workflow; notify companies + tutor; `audit("cohort_cancelled")` |

**Cross-company isolation (L01):** Multiple companies may share a cohort. Each company's participant list is isolated by RLS `org_id`. Tutor sees all participants across companies (within G03 policy scope).

**Min/max headcount (L02):** `min_seats` / `max_seats` per live course offering. Cohort cannot be confirmed below min. Allocations blocked above max.

**Ad hoc cohorts (L03):** Three annual intake references exist as date anchors. PA can create additional cohorts at any time.

---

## 5. Session Lifecycle

Individual sessions within a cohort.

```
┌────────────┐     ┌──────────────┐     ┌────────────┐
│ scheduled  │────▶│ in_progress  │────▶│ completed  │
└─────┬──────┘     └──────────────┘     └────────────┘
      │
      ├─────────────────────────────┐
      ▼                             ▼
┌────────────┐              ┌──────────────┐
│ cancelled  │              │ rescheduled  │───▶ new scheduled
└────────────┘              └──────────────┘
```

| Transition | Guard | Actor | Side effects |
|-----------|-------|-------|-------------|
| → `scheduled` | Cohort is confirmed; valid datetime, duration, Zoom meeting | PA | Create Zoom meeting (if online/hybrid); `audit("session_scheduled")` |
| → `in_progress` | Current time >= start_time | System | `audit("session_started")` |
| → `completed` | Current time >= end_time or PA marks complete | System/PA | Process Zoom attendance webhooks; `audit("session_completed")`; **unlock full schedule visibility for employees (U05/I03)** |
| → `cancelled` | PA cancels before start | PA | Notify companies + tutor; `audit("session_cancelled")` |
| → `rescheduled` | PA reschedules before start (U07) | PA | Create replacement session; notify companies + tutor; `audit("session_rescheduled")` |

**First-session schedule rule (U05/I03):**
- Before first session ENDS: employee sees first session details only
- After first session ENDS: employee sees remaining full schedule
- Buyer sees sufficient schedule details BEFORE payment (L04)
- Implementation: query `sessions WHERE cohort=X ORDER BY start_at` → if first session `status != completed`, return only first session for learner role; return all for buyer/admin.

---

## 6. CorporateQuote Lifecycle

Optional custom pricing for recorded or live packages (P09).

```
┌─────────┐     ┌────────┐     ┌───────────┐
│  draft  │────▶│  sent  │────▶│ accepted  │───▶ fulfilled (SeatPurchase created)
└─────────┘     └───┬────┘     └───────────┘
                    │
              ┌─────┼──────┐
              ▼     ▼      ▼
        ┌─────────┐ ┌──────────┐ ┌────────┐
        │ expired │ │ declined │ │ voided │
        └─────────┘ └──────────┘ └────────┘
```

| Transition | Guard | Actor | Side effects |
|-----------|-------|-------|-------------|
| → `draft` | PA creates quote with custom unit price, quantity, validity period | PA | `audit("quote_created")` |
| `draft` → `sent` | PA sends to company | PA | Notify buyer (CO/CA); `audit("quote_sent")`; start validity countdown |
| `sent` → `accepted` | Buyer accepts within validity period | CO/CA | `audit("quote_accepted")` |
| `accepted` → `fulfilled` | Stripe Checkout/Invoice created and paid | CO/CA + Stripe | Create SeatPurchase at quoted price; `audit("quote_fulfilled")` |
| `sent` → `expired` | Validity period elapsed | Cron | `audit("quote_expired")`; notify buyer + PA |
| `sent` → `declined` | Buyer rejects | CO/CA | `audit("quote_declined")`; notify PA |
| `draft`/`sent` → `voided` | PA withdraws quote | PA | `audit("quote_voided")`; notify buyer if was sent |

**Price snapshot:** Quote captures unit_price, currency, fx_rate, quantity, total at creation time. Accepted quote locks these values regardless of later catalog price changes.

**Stripe flow:** Accepted quote → `gateway.create_checkout_session(mode="payment", line_items=[quoted_items], metadata={kind:"b2b_recorded"/"b2b_live", quote_id:...})` or `gateway.create_invoice(...)` (new, to be built).

---

## 7. Attendance Verification Lifecycle

Per-learner per-session attendance record.

```
┌────────────────────┐        ┌────────────┐
│ recorded_unverified│───────▶│  verified  │
└────────┬───────────┘        └────────────┘
         │
         ▼
    ┌───────────┐        ┌────────────┐
    │ disputed  │───────▶│  resolved  │
    └───────────┘        └────────────┘
```

| Transition | Guard | Actor | Side effects |
|-----------|-------|-------|-------------|
| → `recorded_unverified` | Zoom webhook `meeting.participant_joined` / `meeting.participant_left` received | Zoom webhook | Store join/leave intervals, participant identity, duration; `audit("attendance_recorded")` |
| → `verified` | Identity confidently matched to enrolled learner (email match or PA confirms) | System/PA | Set `verified_at`; `audit("attendance_verified")` |
| `recorded_unverified` → `disputed` | Identity cannot be matched; queued for admin review (I02) | System | `audit("attendance_disputed")`; notify PA |
| `disputed` → `resolved` | PA manually matches or rejects identity | PA | Set resolved status + resolution note; `audit("attendance_resolved")` |

**Identity matching rules (I02):**
1. Zoom participant email matches enrolled learner's email → auto-verify
2. Zoom participant email is missing/different → queue as `disputed` for PA review
3. Display name alone is NEVER sufficient for auto-verification
4. Multiple join/leave events for same participant are aggregated into total duration

**Physical attendance (POLICY GATE G02):**
- In-person/Hybrid physical presence CANNOT be inferred from Zoom
- Extension point: `AttendanceSource` enum (zoom_online, manual_admin, manual_tutor, future_qr, future_checkin)
- Until G02 is resolved: only `zoom_online` source is implemented; physical attendance rows can be manually created by PA with source `manual_admin`

---

## Cross-Reference: Existing State Patterns Reused

| Existing pattern | Reused in B2B |
|-----------------|---------------|
| `Order.status` (pending/paid/failed/expired/refunded) | SeatPurchase follows same Stripe lifecycle |
| `Subscription` status (Stripe-mirrored) | NOT reused — B2B has no subscriptions |
| `CourseVersion.status` (draft→published) | CorporateQuote follows similar approval flow |
| `StripeEvent.event_id` dedup | All B2B Stripe webhook handlers |
| `ContentEntitlement` idempotency | NOT used — B2B access via Enrollment, not ContentEntitlement |
| `Enrollment.source="organization"` | SeatAllocation creates enrollment with this source |
| `OrgMember.removed_at` soft delete | SeatAllocation.revoked_at follows same pattern |

---

## Concurrency & Atomicity Summary

| Operation | Concurrency guard |
|-----------|------------------|
| Allocate seat | `SELECT ... FOR UPDATE` on SeatPurchase; atomic decrement remaining |
| Reserve live seat | `SELECT ... FOR UPDATE` on LiveCohort capacity; atomic decrement |
| Fulfill Stripe payment | `StripeEvent.event_id` unique + idempotent handler |
| Reassign seat | Transaction: revoke old + allocate new; requires PA approval |
| Expire payment hold | Cron with `status=pending AND created_at < cutoff`; skip if already transitioned |
| Process refund | `SELECT ... FOR UPDATE` on SeatPurchase; verify allocation state |
