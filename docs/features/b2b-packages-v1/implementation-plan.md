# B2B Corporate Packages — Staged Implementation Plan

**Date:** 2026-11-11
**Scope:** Corporate recorded packages + corporate live cohorts (no B2B tokens, no B2B subscriptions).
**Stack:** Django + Django Ninja, React + TypeScript + Vite, Neon PostgreSQL (RLS), Stripe, Zoom.

---

## Architecture Overview

### New Django App: `corporate`

All B2B-specific models live in a new `backend/apps/corporate/` app with schema `corporate`.
Reuse existing apps for cross-cutting concerns:
- `commerce` — Stripe gateway, webhook dispatch, Order/Invoice models
- `org` — Organization, OrgMember, roles, unit tree
- `learning` — Enrollment, progress, certificates
- `catalog` — Course, Lecture, CourseVersion
- `platform` — audit, console framework, entitlements
- `engagement` — notifications

### New Database Schema

```
corporate"."offerings           — per-course/delivery pricing (admin-managed)
corporate"."seat_purchases      — paid seat inventory (linked to Stripe)
corporate"."seat_allocations    — employee ↔ seat assignment
corporate"."quotes              — custom quote / proforma invoice
corporate"."training_requests   — company interest in live training
corporate"."live_course_configs — min/max seats, delivery mode per course
corporate"."intakes             — annual intake windows
corporate"."cohorts             — formed live cohort
corporate"."cohort_companies    — which companies participate
corporate"."sessions            — individual meeting/class within a cohort
corporate"."tutors              — approved tutor registry
corporate"."tutor_assignments   — tutor ↔ cohort
corporate"."session_attendance  — normalized attendance records
corporate"."zoom_events         — raw Zoom webhook store
```

### RLS Strategy

| Table | Policy | Rationale |
|-------|--------|-----------|
| offerings | `reference` | Everyone reads; staff writes |
| seat_purchases | `company_only` | Strict org isolation |
| seat_allocations | `company_only` | Strict org isolation |
| quotes | `company_only` | Strict org isolation |
| training_requests | `company_only` | Strict org isolation |
| live_course_configs | `reference` | Admin-managed, read by all |
| intakes | `reference` | Admin-managed, read by all |
| cohorts | `staff_only` | Admin forms cohorts; companies see via cohort_companies |
| cohort_companies | `company_only` | Company sees only own participation |
| sessions | custom | Staff + enrolled companies + assigned tutor |
| tutors | `staff_only` | Admin-managed tutor registry |
| tutor_assignments | `staff_only` | Admin assigns tutors |
| session_attendance | custom | Learner sees own; employer sees own employees; tutor sees cohort |
| zoom_events | `staff_only` | Raw provider data |

---

## Milestone Breakdown

### B2B-01: Corporate Package Offerings & Seat Ledger

**Complexity:** L | **Dependencies:** None (B2B-00 approved)

**Scope:**
- New app `backend/apps/corporate/` with `__init__.py`, `models.py`, `services.py`, `selectors.py`
- Models: `CorporateOffering`, `SeatPurchase`, `SeatAllocation`, `AllocationEvent`
- Console endpoints: CRUD offerings, view seat inventory per company
- Services: `allocate_seat()`, `release_seat()`, `reassign_seat()` — all atomic + audited
- Migration 0001: create corporate schema + tables + RLS

**New Files:**
- `backend/apps/corporate/__init__.py`
- `backend/apps/corporate/models.py`
- `backend/apps/corporate/services.py`
- `backend/apps/corporate/selectors.py`
- `backend/apps/corporate/migrations/0001_initial.py`
- `backend/apps/corporate/migrations/0002_rls.py`
- `backend/apps/platform/console/corporate_offerings.py`
- `backend/apps/corporate/tests/__init__.py`
- `backend/apps/corporate/tests/test_seat_ledger.py`

**Modified Files:**
- `backend/core/api.py` — add `corporate` to DOMAIN_APPS
- `backend/apps/platform/console/__init__.py` — register corporate_offerings module
- `backend/settings.py` — add `apps.corporate` to INSTALLED_APPS

**Models:**

```
CorporateOffering
  course FK, delivery_type (recorded/live), currency, unit_price_minor,
  is_active, min_quantity, max_quantity, description, created_by FK

SeatPurchase (TenantModel: org_id)
  offering FK, quantity, unit_price_snapshot_minor, currency,
  total_minor, gbp_total_minor, fx_rate, stripe_session_id,
  stripe_invoice_id, status (pending/paid/refunded/voided),
  purchased_by FK, allocated_count (denormalized), paid_at

SeatAllocation (TenantModel: org_id)
  seat_purchase FK, user FK (nullable until assigned),
  status (available/allocated/revoked/expired/reassigned),
  allocated_at, allocated_by FK, revoked_at, revoked_by FK,
  access_expires_at, enrollment FK (nullable),
  previous_allocation FK (self, for reassignment chain)

AllocationEvent (TenantModel: org_id)
  allocation FK, kind (allocated/revoked/reassigned/expired),
  actor FK, old_user FK, new_user FK, reason, ip
```

**Console API Endpoints:**
- `GET /console/corporate/offerings` — list with filters
- `POST /console/corporate/offerings` — create offering
- `PATCH /console/corporate/offerings/{id}` — update offering
- `GET /console/corporate/companies/{org_id}/seats` — seat inventory for company
- `GET /console/corporate/companies/{org_id}/allocations` — allocation detail

**Test Criteria:**
1. Allocate seat → status=allocated, enrollment created, allocated_count incremented
2. Concurrent allocation of last seat → exactly one succeeds (SELECT FOR UPDATE)
3. Over-allocation prevented (allocated_count >= quantity → error)
4. Company A cannot see Company B's purchases or allocations (RLS)
5. Release seat → status=revoked, enrollment revoked, AllocationEvent logged
6. Reassign seat → old allocation revoked, new allocation created, admin approval required
7. Allocation before payment → rejected (status != paid)
8. Historical purchases preserved (no cascading delete on course archive)
9. Only owner/admin roles can allocate; manager cannot
10. Unallocated recorded seats remain available indefinitely (S10)

**Policy Gates:** None blocking

**Rollback:** Drop `corporate` schema (additive only, no changes to existing tables)

---

### B2B-02: Recorded Package Checkout + Stripe Invoicing

**Complexity:** L | **Dependencies:** B2B-01 approved

**Scope:**
- Extend `gateway.py` with Stripe Invoicing API (create, send, finalize, void)
- Company recorded checkout: Stripe Checkout for N seats
- Custom quote: `CorporateQuote` model, admin creates → Stripe Invoice sent to company
- Webhook handling: `kind="corporate_recorded"` and `invoice.paid` fulfillment
- Idempotent seat credit on payment confirmation

**New Files:**
- `backend/apps/corporate/checkout.py` — recorded checkout service
- `backend/apps/corporate/quotes.py` — quote lifecycle service
- `backend/apps/corporate/tests/test_recorded_checkout.py`
- `backend/apps/corporate/tests/test_quotes.py`
- `backend/apps/corporate/migrations/0003_quotes.py`
- `backend/apps/platform/console/corporate_quotes.py`

**Modified Files:**
- `backend/apps/commerce/gateway.py` — add `create_invoice()`, `send_invoice()`, `finalize_invoice()`, `void_invoice()`
- `backend/apps/commerce/webhooks.py` — add `kind="corporate_recorded"` dispatch + `invoice.paid` for B2B invoices
- `backend/apps/corporate/models.py` — add `CorporateQuote` model

**Models:**

```
CorporateQuote (TenantModel: org_id)
  offering FK, quantity, unit_price_minor, currency, total_minor,
  discount_minor, notes, status (draft/sent/accepted/expired/voided),
  valid_until, stripe_invoice_id, created_by FK (admin),
  accepted_at, seat_purchase FK (nullable, linked after payment)
```

**API Endpoints:**

Company-facing (`/api/v1/business/`):
- `GET /packages` — available recorded offerings for company's courses
- `POST /packages/{offering_id}/checkout` — Stripe Checkout for N seats
- `GET /packages/purchases` — purchase history
- `GET /quotes` — quotes sent to this company
- `POST /quotes/{id}/accept` — accept quote (redirects to Stripe Invoice payment)

Console (`/api/v1/console/`):
- `POST /corporate/quotes` — create quote for company
- `PATCH /corporate/quotes/{id}` — update draft quote
- `POST /corporate/quotes/{id}/send` — send via Stripe Invoice
- `POST /corporate/quotes/{id}/void` — void quote

**Test Criteria:**
1. Checkout N seats → SeatPurchase(status=pending) → webhook → status=paid, N available allocations
2. Duplicate Stripe event → idempotent (no double seat credit)
3. Failed invoice → SeatPurchase stays pending, no allocations created
4. Stale quote (past valid_until) → reject acceptance
5. Buyer must be company owner/admin (P10)
6. Currency snapshot matches offering price at checkout time
7. Multiple concurrent buyers for same offering → each gets own SeatPurchase
8. Revoked payment → seats voided, any allocations revoked
9. B2C purchase flow unaffected (regression)
10. Stripe Invoice sent → company receives hosted payment link

**Policy Gates:** None blocking

**Rollback:** Remove quote model migration; gateway additions are backward-compatible

---

### B2B-03: Live Request Pool, Intakes, Cohorts & Scheduling

**Complexity:** L | **Dependencies:** B2B-01 approved

**Scope:**
- Live training request flow (company submits interest)
- Admin request pool with aggregation (private)
- Cohort formation: group companies, set min/max, assign course
- Session scheduling: tutor assignment, dates, delivery mode
- First-session visibility rule (U05, I03)

**New Files:**
- `backend/apps/corporate/live.py` — live request + cohort services
- `backend/apps/corporate/scheduling.py` — session + tutor services
- `backend/apps/corporate/tests/test_live_requests.py`
- `backend/apps/corporate/tests/test_cohorts.py`
- `backend/apps/corporate/tests/test_scheduling.py`
- `backend/apps/corporate/migrations/0004_live_training.py`
- `backend/apps/corporate/migrations/0005_live_rls.py`
- `backend/apps/platform/console/corporate_live.py`

**Modified Files:**
- `backend/apps/corporate/models.py` — add live training models
- `backend/apps/org/api.py` — add company-facing live request endpoints
- `backend/apps/platform/console/__init__.py` — register corporate_live

**Models:**

```
LiveCourseConfig (reference)
  course FK (unique), min_learners, max_learners,
  delivery_modes (jsonb: ["online","in_person","hybrid"]),
  is_accepting_requests

TrainingRequest (TenantModel: org_id)
  course FK, requested_seats, delivery_preference,
  requested_by FK, status (submitted/under_review/
    scheduled/rejected/withdrawn/expired),
  admin_notes, submitted_at

Intake (reference)
  name, year, start_date, end_date, is_active

LiveCohort (staff_only)
  course FK, intake FK (nullable), delivery_mode,
  status (forming/confirmed/in_progress/completed/cancelled),
  min_learners, max_learners, current_capacity,
  start_date, end_date, notes

CohortCompany (TenantModel: org_id)
  cohort FK, seats_reserved, seats_confirmed,
  status (invited/accepted/paid/withdrawn),
  seat_purchase FK (nullable)

Session (custom RLS)
  cohort FK, sequence_number, title, scheduled_at,
  duration_minutes, delivery_mode, location,
  zoom_meeting_id, zoom_join_url, zoom_start_url,
  status (scheduled/in_progress/completed/cancelled/postponed),
  tutor FK (nullable)

Tutor (staff_only)
  user FK (unique), kind (internal/external),
  status (pending/approved/suspended),
  bio, specializations (jsonb), approved_by FK, approved_at

TutorAssignment (staff_only)
  tutor FK, cohort FK, role (lead/assistant),
  assigned_at, assigned_by FK
```

**Test Criteria:**
1. Company submits training request → status=submitted, admin sees in pool
2. Learner does NOT see "waiting for enough people" — only "Under Review"
3. Admin forms cohort from requests → CohortCompany rows created
4. Cross-company cohort: Company A + B in same cohort, each sees only own data
5. Split seats across cohorts requires company consent (S11) — cannot auto-split
6. Before first session ends: employee sees Session #1 only
7. After first session ends: employee sees full schedule
8. Company buyer sees sufficient schedule details before payment (L04)
9. Tutor internal/external approval flow
10. Admin can extend enrollment window or offer alternative date (L07)
11. Min/max learner enforcement on cohort
12. Manager role cannot submit training requests (owner/admin only)

**Policy Gates:**
- **G08** — Level compatibility without Skills Radar: admin decides manually

**Rollback:** Drop live training tables (additive only)

---

### B2B-04: Live Payment / Time-Bound Seat Reservations

**Complexity:** M | **Dependencies:** B2B-03 approved

**Scope:**
- Payment for confirmed live cohort seats (Stripe Checkout or Invoice)
- Reservation TTL with atomic capacity checks
- Expired hold cleanup (Celery periodic task)
- Custom quote support for live seats

**New Files:**
- `backend/apps/corporate/live_checkout.py` — live payment service
- `backend/apps/corporate/tasks.py` — Celery tasks (reservation cleanup)
- `backend/apps/corporate/tests/test_live_payment.py`
- `backend/apps/corporate/migrations/0006_live_payment.py`

**Modified Files:**
- `backend/apps/corporate/models.py` — add `LiveReservation` model
- `backend/apps/commerce/webhooks.py` — add `kind="corporate_live"` dispatch
- `backend/apps/org/api.py` — add live checkout endpoints

**Models:**

```
LiveReservation (TenantModel: org_id)
  cohort_company FK, quantity, stripe_session_id,
  stripe_invoice_id, status (held/paid/expired/cancelled),
  held_at, expires_at, paid_at, payment_deadline
```

**Test Criteria:**
1. Company pays for N live seats → CohortCompany.status=paid, seats_confirmed=N
2. Racing payments: two companies for last seats → one succeeds, one fails gracefully
3. Expired hold → seats released back to cohort capacity
4. Duplicate invoice.paid → idempotent fulfillment
5. Refund flow: admin-reviewed, manual Stripe refund (no auto-calculation)
6. Cohort cancellation → all reservations cancelled, refund path initiated
7. Payment after deadline → reservation expired, cannot pay
8. Live access ends at cohort end (not a subscription)
9. Never oversell: atomic capacity check with SELECT FOR UPDATE

**Policy Gates:**
- **G04** — Partial attendance refund/cancellation details (admin case-by-case approved)

**Rollback:** Drop LiveReservation; webhook branch is conditional

---

### B2B-05: Zoom + Live Attendance in Neon

**Complexity:** L | **Dependencies:** B2B-03 and B2B-04 approved

**Scope:**
- Zoom OAuth integration (least-privilege)
- Webhook endpoint with signature verification
- Meeting↔Session correlation
- Attendee identity matching (email-based, queue unresolved)
- Normalized attendance records in Neon
- Physical attendance: extension point only (GATE G02)

**New Files:**
- `backend/apps/corporate/zoom.py` — Zoom webhook handler + identity matching
- `backend/apps/corporate/attendance.py` — attendance normalization service
- `backend/apps/corporate/tests/test_zoom_webhooks.py`
- `backend/apps/corporate/tests/test_attendance.py`
- `backend/apps/corporate/migrations/0007_attendance.py`

**Modified Files:**
- `backend/apps/corporate/models.py` — add `ZoomEvent`, `SessionAttendance`, `AttendanceReview`
- `backend/core/api.py` — mount Zoom webhook endpoint

**Models:**

```
ZoomEvent (staff_only)
  event_id (unique), event_type, meeting_id,
  payload (jsonb), received_at, processed_at

SessionAttendance (custom RLS)
  session FK, user FK (nullable until matched),
  zoom_participant_id, zoom_email, zoom_display_name,
  join_time, leave_time, duration_seconds,
  match_status (verified/unresolved/rejected/manual),
  matched_by FK (nullable, admin for manual matches)

AttendanceReview (staff_only)
  attendance FK, action (approve/reject/reassign),
  actor FK, reason, reviewed_at
```

**API Endpoints:**
- `POST /api/v1/webhooks/zoom` — Zoom webhook receiver (no auth, signature verified)
- `GET /console/corporate/cohorts/{id}/attendance` — admin attendance view
- `POST /console/corporate/attendance/{id}/resolve` — admin resolves unmatched attendee
- `GET /business/training/{cohort_company_id}/attendance` — employer sees own employees
- `GET /learning/live/{session_id}/my-attendance` — learner sees own

**Test Criteria:**
1. Valid Zoom webhook → ZoomEvent stored, attendance record created
2. Spoofed webhook (bad signature) → rejected 403
3. Duplicate event replay → idempotent
4. Attendee with matching email → auto-verified
5. Attendee without email → queued as unresolved for admin
6. Reconnections → aggregated into single attendance record
7. Multiple companies in cohort → each sees only own employees
8. Missing Zoom permissions → graceful error, no crash
9. Session not linked to valid cohort → event stored but not processed
10. Physical attendance → extension point exists, no auto-recording (GATE G02)

**Policy Gates:**
- **G02** — In-person/hybrid physical attendance evidence method

**Rollback:** Drop attendance tables; webhook endpoint is additive

---

### B2B-06: Employer / Learner / Tutor / Admin UI & Reports

**Complexity:** L | **Dependencies:** B2B-01 through B2B-05 APIs approved

**Scope:**
- Frontend React pages for all roles
- Backend reporting/selector endpoints

**New Files (Backend):**
- `backend/apps/corporate/api.py` — company-facing training API
- `backend/apps/corporate/reports.py` — reporting selectors
- `backend/apps/platform/console/corporate_reports.py`

**New Files (Frontend):**
- `frontend/src/pages/business/packages/` — seat purchase + allocation UI
- `frontend/src/pages/business/training/` — live training request + schedule
- `frontend/src/pages/business/reports/` — employer dashboards
- `frontend/src/pages/learning/corporate/` — employee training views
- `frontend/src/pages/console/corporate/` — admin management pages

**Role-Based Views:**

| Role | Sees |
|------|------|
| Company Owner/Admin | Purchase packages, manage seats, request live training, approve schedules, view employee progress/attendance, request refunds |
| Company Manager | View assigned employees' progress (scoped by unit), no checkout |
| Employee | Own corporate training, first session → full schedule after first ends, attendance, certificates |
| Tutor | Assigned cohort learner list, attendance, learning reports (own cohorts only) |
| Platform Admin | All companies, offerings, requests, cohorts, tutors, attendance, quotes, payments, audit |

**Test Criteria:**
1. Owner can see all company employees' progress; manager only sees managed units
2. Employee sees first live session only before it ends; full schedule after
3. Tutor sees only assigned cohort data, not other companies' HR/finance
4. Employee's personal B2C courses never appear in employer view
5. Company A cannot see Company B's employees in a shared cohort
6. Date/time formats respect user locale
7. Mixed personal + company learning displayed correctly on learner dashboard

**Policy Gates:**
- **D02/G03** — Scope of tutor cross-company data visibility

**Rollback:** Frontend-only changes; backend selectors are read-only additions

---

### B2B-07: Certificates / Cancellations / Company Departure Policies

**Complexity:** M | **Dependencies:** B2B-04 approved + GATES G01, G04, G07 resolved

**Scope:**
- Recorded certificates: reuse existing system (no changes needed)
- Live certificates: implement framework, block issuance until G01 resolved
- Cancel/postpone cohort: admin workflow
- Refund: admin-reviewed manual Stripe refund (no auto-calculation)
- Company departure: configurable policy per company

**New Files:**
- `backend/apps/corporate/certificates.py` — live certificate service (gated)
- `backend/apps/corporate/cancellations.py` — cancel/postpone workflows
- `backend/apps/corporate/departure.py` — employer-leaver policy service
- `backend/apps/corporate/tests/test_certificates.py`
- `backend/apps/corporate/tests/test_cancellations.py`
- `backend/apps/corporate/tests/test_departure.py`
- `backend/apps/corporate/migrations/0008_policies.py`

**Modified Files:**
- `backend/apps/corporate/models.py` — add `DeparturePolicy`, `CancellationRequest`

**Models:**

```
DeparturePolicy (TenantModel: org_id)
  policy_type (revoke_all/preserve_completed/admin_decides),
  configured_by FK, effective_from

CancellationRequest (TenantModel: org_id)
  cohort_company FK or seat_purchase FK,
  kind (cancel_live/cancel_recorded/postpone),
  status (submitted/approved/rejected/processed),
  reason, requested_by FK, reviewed_by FK,
  refund_amount_minor (nullable, admin-set), refund_id FK
```

**Test Criteria:**
1. Recorded certificate uses existing `learning.issue_certificate()` — no regression
2. Live certificate issuance blocked if G01 unresolved (ConfigurationBlocked)
3. Cohort cancellation → all company reservations cancelled
4. Postponed cohort → sessions rescheduled, companies notified
5. Refund request → admin reviews → manual Stripe refund → audit logged
6. No automatic partial-refund calculation
7. Employee departs: policy=revoke_all → enrollments revoked, certs preserved
8. Employee departs: policy=preserve_completed → completed enrollments kept
9. Historical completions never deleted
10. Company training rights separated from personal B2C

**Policy Gates (MUST be resolved before this milestone ships):**
- **G01** — Live certificate criteria
- **G04** — Cancellation/refund calculation rules
- **G07** — Employer departure policy options

**Rollback:** Drop policy tables; certificate/cancel services are additive

---

### B2B-08: E2E Security, Finance & Regression Verification

**Complexity:** M | **Dependencies:** All prior milestones approved

**Scope:**
- Full test suite across all B2B features
- Multi-company RLS isolation verification
- Stripe idempotency and concurrency tests
- B2C regression suite
- Security review: access control, data isolation, Zoom privacy
- PASS/FAIL/BLOCKED report

**New Files:**
- `backend/apps/corporate/tests/test_e2e_isolation.py`
- `backend/apps/corporate/tests/test_e2e_stripe.py`
- `backend/apps/corporate/tests/test_e2e_regression.py`
- `docs/features/b2b-packages-v1/e2e-report.md`

**Test Criteria:**
1. Two companies in same cohort: complete isolation of seats, allocations, attendance
2. Tutor sees only assigned cohort scope (not other companies' data)
3. Employer reports show only own employees
4. B2C personal courses/tokens/subscriptions unaffected
5. Stripe Checkout + Invoice idempotency (duplicate events)
6. Seat accounting correct after refund, cancellation, delayed payment
7. Zoom missing emails → queued not auto-matched
8. In-person attendance gap documented (GATE G02)
9. First-session schedule reveal timing correct
10. Recorded access lifetime unless admin expiry configured
11. Historical corporate subscribers (team plan) preserved
12. Concurrent reserve/checkout/allocate → no double-spend
13. Staff audit log covers all admin actions
14. Frontend build succeeds, API contract sync passes
15. No credentials exposed in responses or logs

**Policy Gates (reported, not blocking tests):**
- All unresolved gates from G01-G09 listed in report

**Rollback:** Test-only milestone, no schema changes

---

## Migration Safety

All migrations are **additive only**:
- New schema `corporate` with new tables
- New columns/indexes only
- No alterations to existing tables
- No data migrations
- No destructive operations (DROP, TRUNCATE, ALTER TYPE)

Migration order: `0001_initial` → `0002_rls` → `0003_quotes` → `0004_live_training` → `0005_live_rls` → `0006_live_payment` → `0007_attendance` → `0008_policies`

Apply only to confirmed isolated DEVELOPMENT database with explicit user permission.

---

## Testing Strategy

- **Unit tests:** Per-service, mocked Stripe, in-memory
- **Integration tests:** `SchemaTransactionTestCase` with real Neon, RLS verification
- **Run individually:** Each test file runs independently (Neon pooler deadlock avoidance)
- **B2C regression:** Run existing B2C test suite after each milestone
- **RLS tests:** Extend `core/tests/test_rls.py` for new corporate tables

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Zoom webhook email gaps | Queue unresolved, admin review UI |
| Cross-company cohort RLS | Custom policies + integration tests |
| Stripe Invoice API new surface | Thorough idempotency testing |
| Neon pooler deadlocks in tests | Run test files individually |
| Policy gates block milestones | Mark BLOCKED, ship framework without business logic |
| Tutor data scope ambiguity | Conservative default (cohort-only), gate G03 |
