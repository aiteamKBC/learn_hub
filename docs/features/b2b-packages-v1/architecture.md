# B2B Corporate Packages — Technical Architecture

**Status:** Design proposal — pending owner review  
**Scope:** Corporate B2B packages only (Recorded + Live). No B2B tokens, no B2B subscriptions.  
**Supersedes:** Nothing — greenfield feature on top of existing platform  

---

## 1. System Overview

Learn Hub extends its existing B2C marketplace with a corporate B2B channel.
Companies purchase **per-course, per-delivery-type seat packages** — never tokens,
never personal unlimited subscriptions. Two delivery variants:

| Variant | Payment trigger | Access duration | Seat lifecycle |
|---------|----------------|-----------------|----------------|
| **Recorded Course Package** | Direct Stripe Checkout or Invoice | Lifetime (or admin-configured expiry) | Purchased → Allocated → Active (enrollment created) |
| **Corporate Live Training** | After admin confirms cohort + schedule | Cohort start → cohort end | Requested → Reserved → Paid → Active → Completed |

Key constraints:
- Stripe is the ONLY payment provider (Checkout + Invoicing).
- No new team-subscription checkout — historical subscriptions preserved read-only.
- Corporate Live cohorts are separate from Kent Business College student classes.
- Skills Radar is entirely deferred — no assessment engine, scoring, or placement.
- Platform Admin alone manages pricing, cohorts, tutors, and schedules.

### Existing infrastructure reused

| Component | File | Reuse |
|-----------|------|-------|
| Organization, OrgMember, OrgUnit | `apps/org/models.py` | Company identity, roles, hierarchy |
| OrgRole + org_scope() | `core/permissions.py` | Role gating (owner/admin/manager/learner) |
| Organization.stripe_customer_id | `apps/org/models.py` | Stripe Customer for B2B payments |
| gateway.create_checkout_session() | `apps/commerce/gateway.py` | Stripe Checkout (extended for Invoicing) |
| StripeEvent idempotency | `apps/commerce/models.py` | Webhook dedup |
| webhooks.py dispatch | `apps/commerce/webhooks.py` | Event routing by `meta.kind` |
| Enrollment (source="organization") | `apps/learning/models.py` | Org-scoped enrollment with org FK |
| Certificate (MixedTenantModel) | `apps/learning/models.py` | Org-aware certificates |
| notify() + NotificationTemplate | `apps/engagement/notify.py` | In-app + email notifications |
| audit() / audit_request() | `apps/platform/services.py` | Immutable audit trail |
| TenantModel, MixedTenantModel | `core/models.py` | Company-isolated base models |
| RLS helpers | `core/rls.py` | company_only, reference, staff_only, personal |
| Course, CourseVersion, Lecture | `apps/catalog/models.py` | Existing course structure |
| PriceTier, PriceTierAmount, FxRate | `apps/commerce/models.py` | Multi-currency pricing |

---

## 2. Proposed Data Model

All new tables live in a **`corporate` Postgres schema** (following the convention
of `catalog`, `commerce`, `org`, `platform`, etc.). New Django app: `apps/corporate/`.

### 2.1 CorporateOffering

Admin-managed per-course, per-delivery-type pricing. One row per (course, delivery_type).

```python
# apps/corporate/models.py
SCHEMA = "corporate"

class CorporateOffering(BaseModel):
    class DeliveryType(models.TextChoices):
        RECORDED = "recorded", "Recorded Course Package"
        LIVE     = "live",     "Corporate Live Training"

    course        = models.ForeignKey("catalog.Course", on_delete=models.PROTECT, related_name="+")
    delivery_type = models.CharField(max_length=10, choices=DeliveryType.choices)
    price_tier    = models.ForeignKey("commerce.PriceTier", on_delete=models.PROTECT, related_name="+")
    is_active     = models.BooleanField(default=True)
    custom_quote_enabled = models.BooleanField(default=False)
    description   = models.TextField(blank=True)

    class Meta:
        db_table = table(SCHEMA, "corporate_offerings")
        constraints = [
            models.UniqueConstraint(
                fields=["course", "delivery_type"],
                condition=Q(is_active=True),
                name="uq_offering_active_per_course_delivery",
            ),
        ]
```

**RLS:** `reference` — everyone reads, only staff writes.

### 2.2 SeatPurchase

One row per purchase transaction. Tracks quantity purchased, price snapshot,
and Stripe identifiers. Org-scoped (company_only).

```python
class SeatPurchase(TenantModel):
    class Status(models.TextChoices):
        PENDING   = "pending",   "Pending payment"
        PAID      = "paid",      "Paid"
        REFUNDED  = "refunded",  "Fully refunded"
        PARTIAL   = "partial",   "Partially refunded"
        EXPIRED   = "expired",   "Payment expired"
        VOIDED    = "voided",    "Voided"

    offering            = models.ForeignKey(CorporateOffering, on_delete=models.PROTECT, related_name="+")
    buyer               = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    quantity            = models.PositiveIntegerField()
    unit_price_minor    = models.IntegerField()          # snapshot at purchase
    currency            = models.CharField(max_length=3)
    total_minor         = models.IntegerField()
    gbp_total_minor     = models.IntegerField()          # for reporting/payouts
    fx_rate             = models.DecimalField(max_digits=12, decimal_places=6, default=1)
    status              = models.CharField(max_length=12, choices=Status.choices, default="pending")
    stripe_session_id   = models.CharField(max_length=255, blank=True)
    stripe_invoice_id   = models.CharField(max_length=255, blank=True)
    payment_intent      = models.CharField(max_length=255, blank=True)
    paid_at             = models.DateTimeField(null=True, blank=True)
    refunded_at         = models.DateTimeField(null=True, blank=True)
    expires_at          = models.DateTimeField(null=True, blank=True)  # live seats expire at cohort end
    notes               = models.TextField(blank=True)
    quote               = models.ForeignKey("CorporateQuote", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "seat_purchases")
        indexes = [
            models.Index(fields=["org", "offering", "status"], name="ix_sp_org_offering"),
            models.Index(fields=["stripe_session_id"], name="ix_sp_stripe_session"),
        ]
```

**RLS:** `company_only` — each company sees only their own purchases.

### 2.3 SeatAllocation

Tracks which employee holds which seat. Status machine:
`allocated` → `active` (enrollment created) → `revoked` | `released`.

```python
class SeatAllocation(TenantModel):
    class Status(models.TextChoices):
        ALLOCATED = "allocated", "Seat assigned, enrollment pending"
        ACTIVE    = "active",    "Enrollment created"
        REVOKED   = "revoked",   "Admin revoked"
        RELEASED  = "released",  "Released for reassignment"

    seat_purchase  = models.ForeignKey(SeatPurchase, on_delete=models.PROTECT, related_name="allocations")
    user           = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    status         = models.CharField(max_length=12, choices=Status.choices, default="allocated")
    allocated_at   = models.DateTimeField(auto_now_add=True)
    activated_at   = models.DateTimeField(null=True, blank=True)  # enrollment creation timestamp
    released_at    = models.DateTimeField(null=True, blank=True)
    released_by    = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    release_reason = models.TextField(blank=True)
    enrollment     = models.ForeignKey("learning.Enrollment", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "seat_allocations")
        constraints = [
            models.UniqueConstraint(
                fields=["seat_purchase", "user"],
                condition=Q(status__in=["allocated", "active"]),
                name="uq_alloc_active_per_purchase_user",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "seat_purchase", "status"], name="ix_alloc_purchase_status"),
        ]
```

**RLS:** `company_only`.

**Seat accounting invariant:**  
`SeatAllocation.filter(seat_purchase=X, status__in=["allocated","active"]).count() <= X.quantity`  
Enforced in service layer via `SELECT ... FOR UPDATE` on SeatPurchase row.

### 2.4 CorporateQuote + QuoteItem

Optional custom-quote flow. Admin creates quote, sends Stripe Invoice.

```python
class CorporateQuote(TenantModel):
    class Status(models.TextChoices):
        DRAFT    = "draft",    "Draft"
        SENT     = "sent",     "Sent to company"
        ACCEPTED = "accepted", "Accepted & paid"
        EXPIRED  = "expired",  "Expired"
        DECLINED = "declined", "Declined"
        VOIDED   = "voided",   "Voided by admin"

    buyer              = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    status             = models.CharField(max_length=12, choices=Status.choices, default="draft")
    valid_until        = models.DateTimeField()
    currency           = models.CharField(max_length=3)
    total_minor        = models.IntegerField(default=0)
    stripe_invoice_id  = models.CharField(max_length=255, blank=True)
    stripe_invoice_url = models.CharField(max_length=1024, blank=True)
    notes              = models.TextField(blank=True)
    created_by_staff   = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "corporate_quotes")
        indexes = [
            models.Index(fields=["org", "status"], name="ix_quote_org_status"),
        ]


class QuoteItem(TenantModel):
    quote           = models.ForeignKey(CorporateQuote, on_delete=models.CASCADE, related_name="items")
    offering        = models.ForeignKey(CorporateOffering, on_delete=models.PROTECT, related_name="+")
    quantity        = models.PositiveIntegerField()
    unit_price_minor = models.IntegerField()
    line_total_minor = models.IntegerField()

    class Meta:
        db_table = table(SCHEMA, "quote_items")
```

**RLS:** `company_only` for both.

### 2.5 TrainingRequest

Company submits interest for live training. Internal-only aggregation by admin.

```python
class TrainingRequest(TenantModel):
    class Status(models.TextChoices):
        SUBMITTED     = "submitted",     "Submitted"
        UNDER_REVIEW  = "under_review",  "Under review"
        SCHEDULING    = "scheduling",    "Scheduling in progress"
        OFFERED       = "offered",       "Cohort offered"
        ACCEPTED      = "accepted",      "Company accepted"
        DECLINED      = "declined",      "Company declined"
        EXPIRED       = "expired",       "Request expired"
        CANCELLED     = "cancelled",     "Cancelled"

    course          = models.ForeignKey("catalog.Course", on_delete=models.PROTECT, related_name="+")
    requester       = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    requested_seats = models.PositiveIntegerField()
    preferred_intake = models.CharField(max_length=50, blank=True)  # e.g. "2027-Q1"
    preferred_delivery_mode = models.CharField(max_length=12, blank=True)  # online/in_person/hybrid
    status          = models.CharField(max_length=16, choices=Status.choices, default="submitted")
    admin_notes     = models.TextField(blank=True)  # internal, never exposed to company
    status_label    = models.CharField(max_length=64, blank=True)  # company-facing: "Under Review", "Scheduling"

    class Meta:
        db_table = table(SCHEMA, "training_requests")
        indexes = [
            models.Index(fields=["org", "status"], name="ix_treq_org_status"),
            models.Index(fields=["course", "status"], name="ix_treq_course_status"),
        ]
```

**RLS:** `company_only` — company sees own requests. Admin sees all via staff bypass.

**Note:** `admin_notes` is never returned in company-facing API responses. The company sees
`status_label` (e.g. "Under Review", "Scheduling") — never "waiting for enough people".

### 2.6 LiveCohort

Admin-created, cross-company. May contain participants from multiple organizations.

```python
class LiveCohort(BaseModel):
    class Status(models.TextChoices):
        FORMING      = "forming",      "Forming (gathering interest)"
        CONFIRMED    = "confirmed",    "Schedule confirmed"
        PENDING_PAY  = "pending_pay",  "Awaiting company payments"
        IN_PROGRESS  = "in_progress",  "In progress"
        COMPLETED    = "completed",    "Completed"
        CANCELLED    = "cancelled",    "Cancelled"

    class DeliveryMode(models.TextChoices):
        ONLINE    = "online",    "Online (Zoom)"
        IN_PERSON = "in_person", "In-person"
        HYBRID    = "hybrid",    "Hybrid"

    course          = models.ForeignKey("catalog.Course", on_delete=models.PROTECT, related_name="+")
    title           = models.CharField(max_length=200, blank=True)
    intake          = models.CharField(max_length=50, blank=True)  # "2027-Q1", "2027-Intake-3"
    status          = models.CharField(max_length=16, choices=Status.choices, default="forming")
    delivery_mode   = models.CharField(max_length=12, choices=DeliveryMode.choices)
    min_learners    = models.PositiveIntegerField(default=1)
    max_learners    = models.PositiveIntegerField()
    current_seats   = models.PositiveIntegerField(default=0)  # denormalized from CohortCompany
    scheduled_start = models.DateField(null=True, blank=True)
    scheduled_end   = models.DateField(null=True, blank=True)
    notes           = models.TextField(blank=True)  # admin notes

    class Meta:
        db_table = table(SCHEMA, "live_cohorts")
        indexes = [
            models.Index(fields=["course", "status"], name="ix_cohort_course_status"),
            models.Index(fields=["intake"], name="ix_cohort_intake"),
        ]
```

**RLS:** `staff_only` — admin table. Participating org members and tutors access
via service-layer queries with explicit authorization (not direct RLS).
Cohort data is returned through the company API endpoints which apply
org-scoping and role checks in Python.

### 2.7 CohortCompany

Links companies to cohorts. Tracks each company's seat allocation and payment status.

```python
class CohortCompany(TenantModel):
    class Status(models.TextChoices):
        INTERESTED    = "interested",    "Interest registered"
        OFFERED       = "offered",       "Cohort offered to company"
        PENDING_PAY   = "pending_pay",   "Awaiting payment"
        PAID          = "paid",          "Payment confirmed"
        ACTIVE        = "active",        "Learners enrolled"
        COMPLETED     = "completed",     "Cohort completed"
        CANCELLED     = "cancelled",     "Company cancelled"
        WITHDRAWN     = "withdrawn",     "Admin withdrew company"

    cohort           = models.ForeignKey(LiveCohort, on_delete=models.PROTECT, related_name="companies")
    training_request = models.ForeignKey(TrainingRequest, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    seat_purchase    = models.ForeignKey(SeatPurchase, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    approved_seats   = models.PositiveIntegerField(default=0)
    status           = models.CharField(max_length=16, choices=Status.choices, default="interested")
    payment_deadline = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "cohort_companies")
        constraints = [
            models.UniqueConstraint(fields=["cohort", "org"], name="uq_cohort_company"),
        ]
```

**RLS:** `company_only` — each company sees only their own cohort participation.

### 2.8 Session

Individual meeting/class within a cohort.

```python
class Session(BaseModel):
    class Status(models.TextChoices):
        SCHEDULED    = "scheduled",    "Scheduled"
        IN_PROGRESS  = "in_progress",  "In progress"
        COMPLETED    = "completed",    "Completed"
        CANCELLED    = "cancelled",    "Cancelled"
        RESCHEDULED  = "rescheduled",  "Rescheduled"

    cohort          = models.ForeignKey(LiveCohort, on_delete=models.PROTECT, related_name="sessions")
    sequence        = models.PositiveIntegerField()  # 1-based session number
    title           = models.CharField(max_length=200, blank=True)
    scheduled_at    = models.DateTimeField()
    duration_min    = models.PositiveIntegerField()
    delivery_mode   = models.CharField(max_length=12, choices=LiveCohort.DeliveryMode.choices)
    location        = models.CharField(max_length=500, blank=True)  # physical address or "Online"
    zoom_meeting_id = models.CharField(max_length=64, blank=True)
    zoom_join_url   = models.CharField(max_length=1024, blank=True)
    zoom_host_url   = models.CharField(max_length=1024, blank=True)  # host start link, never exposed to learners
    status          = models.CharField(max_length=16, choices=Status.choices, default="scheduled")
    actual_start    = models.DateTimeField(null=True, blank=True)
    actual_end      = models.DateTimeField(null=True, blank=True)
    reschedule_note = models.TextField(blank=True)

    class Meta:
        db_table = table(SCHEMA, "sessions")
        constraints = [
            models.UniqueConstraint(fields=["cohort", "sequence"], name="uq_session_sequence"),
        ]
        indexes = [
            models.Index(fields=["cohort", "scheduled_at"], name="ix_session_schedule"),
        ]
```

**RLS:** `staff_only` — admin table. Learner access to session data goes through service
layer with the first-session / full-schedule visibility rule (U05/I03).

### 2.9 Tutor + TutorAssignment

```python
class Tutor(BaseModel):
    class Type(models.TextChoices):
        INTERNAL = "internal", "Internal"
        EXTERNAL = "external", "External"

    class Status(models.TextChoices):
        PENDING   = "pending",   "Pending approval"
        APPROVED  = "approved",  "Approved"
        REJECTED  = "rejected",  "Rejected"
        SUSPENDED = "suspended", "Suspended"

    user            = models.OneToOneField(User, on_delete=models.PROTECT, related_name="tutor_profile")
    type            = models.CharField(max_length=10, choices=Type.choices)
    status          = models.CharField(max_length=12, choices=Status.choices, default="pending")
    approved_by     = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    approved_at     = models.DateTimeField(null=True, blank=True)
    bio             = models.TextField(blank=True)
    specializations = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = table(SCHEMA, "tutors")


class TutorAssignment(BaseModel):
    tutor       = models.ForeignKey(Tutor, on_delete=models.PROTECT, related_name="assignments")
    cohort      = models.ForeignKey(LiveCohort, on_delete=models.PROTECT, related_name="tutor_assignments")
    assigned_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = table(SCHEMA, "tutor_assignments")
        constraints = [
            models.UniqueConstraint(fields=["tutor", "cohort"], name="uq_tutor_cohort"),
        ]
```

**RLS:** Both `staff_only` — Platform Admin manages tutors.

### 2.10 SessionAttendance

```python
class SessionAttendance(BaseModel):
    class Source(models.TextChoices):
        ZOOM_WEBHOOK  = "zoom_webhook",  "Zoom webhook (auto)"
        MANUAL_ADMIN  = "manual_admin",  "Manual entry by admin"
        MANUAL_TUTOR  = "manual_tutor",  "Manual entry by tutor"

    session          = models.ForeignKey(Session, on_delete=models.PROTECT, related_name="attendance_records")
    user             = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    org              = models.ForeignKey("org.Organization", on_delete=models.PROTECT, related_name="+")
    source           = models.CharField(max_length=16, choices=Source.choices)
    join_at          = models.DateTimeField()
    leave_at         = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(default=0)
    is_verified      = models.BooleanField(default=False)
    verified_by      = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    zoom_event       = models.ForeignKey("ZoomEvent", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "session_attendance")
        indexes = [
            models.Index(fields=["session", "user"], name="ix_att_session_user"),
            models.Index(fields=["org", "user", "session"], name="ix_att_org_user"),
        ]
```

**RLS:** Custom policy:
- Learner: `user_id = app.user_id` (own attendance)
- Company: `org_id = app.org_id` (own employees' attendance)
- Staff: all rows

Tutor access is service-layer gated, not RLS — the tutor queries attendance
for sessions of their assigned cohorts only.

### 2.11 ZoomEvent

Raw Zoom webhook event store for audit and replay.

```python
class ZoomEvent(BaseModel):
    event_id    = models.CharField(max_length=64, unique=True)
    event_type  = models.CharField(max_length=64)  # e.g. "meeting.participant_joined"
    meeting_id  = models.CharField(max_length=64, db_index=True)
    account_id  = models.CharField(max_length=64, blank=True)
    payload     = models.JSONField()
    received_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    error       = models.TextField(blank=True)

    class Meta:
        db_table = table(SCHEMA, "zoom_events")
```

**RLS:** `staff_only`.

---

## 3. API Design

### 3.1 Learner API — extends `/api/v1/business/`

Added to existing `apps/org/api.py` router (auth=session_auth, requires org membership):

| Method | Path | Min role | Description |
|--------|------|----------|-------------|
| GET | `/training` | LEARNER | My corporate courses (recorded + live) |
| GET | `/training/{id}/schedule` | LEARNER | Live schedule (visibility rules: first session only until it ends, then full) |
| GET | `/training/{id}/attendance` | LEARNER | My attendance records for a live course |

**First-session visibility rule (U05/I03):**
```
if session.sequence == 1:
    always visible (date, time, join_url 15min before start)
elif first_session.status == "completed" or first_session.actual_end <= now:
    visible (date, time; join_url 15min before start)
else:
    hidden
```

### 3.2 Company API — extends `/api/v1/business/`

| Method | Path | Min role | Description |
|--------|------|----------|-------------|
| GET | `/packages` | MANAGER | Available corporate offerings with pricing |
| POST | `/packages/{id}/checkout` | ADMIN | Create Stripe Checkout for recorded seats |
| POST | `/packages/{id}/request` | ADMIN | Submit live training request |
| GET | `/quotes` | ADMIN | Company's quotes |
| POST | `/quotes/{id}/accept` | ADMIN | Accept quote (may trigger Stripe Invoice) |
| GET | `/seats` | MANAGER | Seat inventory: purchases, allocations, available counts |
| GET | `/seats/{purchase_id}` | MANAGER | Single purchase detail with allocations |
| POST | `/seats/allocate` | ADMIN | Allocate N seats to employees by member IDs |
| POST | `/seats/{alloc_id}/release` | ADMIN | Release seat (requires admin approval → service layer) |
| POST | `/seats/{alloc_id}/reassign` | ADMIN | Release + reallocate to different employee (atomic) |
| GET | `/employees/{id}/training` | MANAGER | Employee training detail (org-scoped, progress, attendance, certs) |
| GET | `/live-bookings` | MANAGER | Company's live cohort participations |
| POST | `/live-bookings/{cc_id}/checkout` | ADMIN | Pay for confirmed live cohort placement |
| GET | `/live-bookings/{cc_id}/schedule` | MANAGER | Cohort schedule (respects company buyer visibility per L04) |
| GET | `/training-requests` | ADMIN | Company's training requests |
| DELETE | `/training-requests/{id}` | ADMIN | Cancel pending request |
| GET | `/attendance-report` | MANAGER | Attendance report for company employees across cohorts |

**Buyer visibility (L04):** Company buyer (ADMIN/OWNER) sees sufficient scheduling details
(dates, times, delivery mode) BEFORE payment. This is separate from the learner first-session
rule — buyers always see full schedule at the payment step.

### 3.3 Console API — new `apps/platform/console/corporate.py`

| Method | Path | Description |
|--------|------|-------------|
| **Offerings** | | |
| GET | `/corporate/offerings` | List all offerings, filter by course/delivery/active |
| POST | `/corporate/offerings` | Create offering (course + delivery + price tier) |
| PATCH | `/corporate/offerings/{id}` | Update pricing, active state, quote flag |
| **Quotes** | | |
| GET | `/corporate/quotes` | All quotes across companies |
| POST | `/corporate/quotes` | Create quote for a company |
| PATCH | `/corporate/quotes/{id}` | Update draft quote |
| POST | `/corporate/quotes/{id}/send` | Finalize and send (creates Stripe Invoice) |
| POST | `/corporate/quotes/{id}/void` | Void quote |
| **Seat Purchases** | | |
| GET | `/corporate/purchases` | All purchases across companies |
| GET | `/corporate/purchases/{id}` | Detail with allocations |
| POST | `/corporate/purchases/{id}/refund` | Process refund (Stripe + revoke allocations) |
| **Training Requests** | | |
| GET | `/corporate/requests` | Request pool — all companies, filterable |
| PATCH | `/corporate/requests/{id}` | Update status, admin notes |
| **Cohorts** | | |
| GET | `/corporate/cohorts` | All cohorts |
| POST | `/corporate/cohorts` | Create cohort (course, delivery, min/max, intake) |
| PATCH | `/corporate/cohorts/{id}` | Update cohort details |
| POST | `/corporate/cohorts/{id}/companies` | Add company to cohort |
| DELETE | `/corporate/cohorts/{id}/companies/{org_id}` | Remove company from cohort |
| POST | `/corporate/cohorts/{id}/confirm` | Confirm schedule → notify companies for payment |
| **Sessions** | | |
| GET | `/corporate/cohorts/{id}/sessions` | List sessions |
| POST | `/corporate/cohorts/{id}/sessions` | Add session |
| PATCH | `/corporate/sessions/{id}` | Update session (reschedule) |
| DELETE | `/corporate/sessions/{id}` | Cancel session |
| **Tutors** | | |
| GET | `/corporate/tutors` | List tutors |
| POST | `/corporate/tutors` | Register tutor (internal/external) |
| PATCH | `/corporate/tutors/{id}` | Approve/reject/suspend |
| POST | `/corporate/tutors/{id}/assign` | Assign tutor to cohort |
| **Attendance** | | |
| GET | `/corporate/attendance/{session_id}` | Session attendance with verification status |
| POST | `/corporate/attendance/{session_id}` | Manual attendance entry |
| PATCH | `/corporate/attendance/{id}` | Verify/correct attendance |
| GET | `/corporate/attendance/unresolved` | Zoom-matched but unverified identities |
| **Dashboard** | | |
| GET | `/corporate/dashboard` | B2B KPIs: revenue, seat utilization, active cohorts |

### 3.4 Webhook Extensions

**Stripe** — extends existing `apps/commerce/webhooks.py`:
```python
# New meta.kind values in checkout.session.completed dispatch:
"corporate_recorded"  → corporate.services.fulfil_recorded_purchase(session)
"corporate_live"      → corporate.services.fulfil_live_purchase(session)

# New: invoice.paid with meta.kind="corporate_quote"
"corporate_quote"     → corporate.services.fulfil_quote(invoice)
```

**Zoom** — new endpoint at `/api/v1/webhooks/zoom`:
```python
# apps/corporate/zoom_webhooks.py
# Verifies Zoom webhook signature (HMAC-SHA256)
# Handles: meeting.participant_joined, meeting.participant_left, meeting.ended
# Stores raw ZoomEvent, processes attendance asynchronously via Celery
```

---

## 4. Stripe Integration

### 4.1 Recorded Package — Stripe Checkout (existing flow)

```
Company ADMIN → POST /packages/{id}/checkout
  → gateway.create_checkout_session(
        mode="payment",
        line_items=[{price_data: {unit_amount, currency}, quantity: N}],
        metadata={"kind": "corporate_recorded", "offering_id": ..., "org_id": ...},
        customer=org.stripe_customer_id,
        invoice_creation={"enabled": True},
    )
  → redirect to Stripe hosted page
  → webhook checkout.session.completed (kind=corporate_recorded)
  → corporate.services.fulfil_recorded_purchase():
      1. Create SeatPurchase (status=paid)
      2. Audit: "corporate_purchase"
      3. Notify company admins
```

### 4.2 Live Package — Stripe Checkout

```
Admin confirms cohort → POST /live-bookings/{cc_id}/checkout
  → Same flow as recorded but metadata.kind="corporate_live"
  → Reservation TTL: admin-configured payment_deadline on CohortCompany
  → Expired holds: Celery periodic task checks CohortCompany.payment_deadline
      and transitions status to "cancelled", releasing capacity
```

### 4.3 Custom Quote — Stripe Invoicing (NEW gateway functions needed)

```
Admin creates quote → POST /corporate/quotes/{id}/send
  → corporate.services.send_quote():
      1. Create Stripe Customer (or use existing org.stripe_customer_id)
      2. gateway.create_invoice(customer, metadata, collection_method="send_invoice", due_date)
      3. gateway.add_invoice_items(invoice, line_items)
      4. gateway.finalize_invoice(invoice)
      5. gateway.send_invoice(invoice)  — emails hosted link
      6. Update CorporateQuote with stripe_invoice_id, stripe_invoice_url
  → webhook invoice.paid (kind=corporate_quote)
  → corporate.services.fulfil_quote():
      1. Create SeatPurchase(s) from QuoteItems
      2. Update CorporateQuote.status = "accepted"
      3. Audit + notify
```

### 4.4 New gateway functions — `apps/commerce/gateway.py`

```python
def create_invoice(*, customer, metadata, collection_method="send_invoice",
                   days_until_due=30, currency=None, description=None):
    """Create a Stripe Invoice (draft). Returns stripe.Invoice."""

def add_invoice_item(*, invoice_id, description, amount, currency, quantity=1):
    """Add a line item to a draft invoice."""

def finalize_invoice(invoice_id):
    """Finalize (lock) the invoice. Returns finalized stripe.Invoice."""

def send_invoice(invoice_id):
    """Send finalized invoice to customer. Returns stripe.Invoice."""

def void_invoice(invoice_id):
    """Void an unpaid invoice."""
```

These are additive functions — no changes to existing gateway code.

### 4.5 Refund Flow

Admin-reviewed only (per Q08):
```
Console POST /corporate/purchases/{id}/refund
  → corporate.services.refund_purchase(purchase_id, *, amount=None):
      1. Validate: purchase.status == "paid"
      2. Revoke active allocations + enrollments
      3. gateway.refund(payment_intent, amount, idempotency_key)
      4. Update SeatPurchase.status = "refunded" or "partial"
      5. Audit: "corporate_refund"
```

No automated refund calculations — admin decides amount (G04).

---

## 5. RLS Strategy

| Table | RLS helper | Rationale |
|-------|-----------|-----------|
| `corporate_offerings` | `reference` | Public catalog, staff writes |
| `seat_purchases` | `company_only` | Hard org isolation |
| `seat_allocations` | `company_only` | Hard org isolation |
| `corporate_quotes` | `company_only` | Company sees own quotes |
| `quote_items` | `company_only` | Inherits from quote |
| `training_requests` | `company_only` | Company sees own requests |
| `live_cohorts` | `staff_only` | Cross-company admin table |
| `cohort_companies` | `company_only` | Company sees own participation |
| `sessions` | `staff_only` | Admin-managed; service-layer access |
| `session_attendance` | Custom (see below) | Multi-actor visibility |
| `tutors` | `staff_only` | Admin manages |
| `tutor_assignments` | `staff_only` | Admin manages |
| `zoom_events` | `staff_only` | Raw webhook data |

### Custom RLS for session_attendance

```sql
-- SELECT: own rows OR company's employees' rows OR staff
CREATE POLICY sel_att ON corporate.session_attendance FOR SELECT USING (
    user_id = current_setting('app.user_id')::uuid
    OR org_id = current_setting('app.org_id')::uuid
    OR current_setting('app.platform_staff', true) = 'on'
);
-- INSERT/UPDATE/DELETE: staff only
CREATE POLICY mut_att ON corporate.session_attendance FOR ALL USING (
    current_setting('app.platform_staff', true) = 'on'
);
```

### Cross-company cohort visibility

LiveCohort and Session are `staff_only` at the RLS level. Company users access
cohort/session data through Python-layer endpoints that:
1. Join through `CohortCompany` (which is `company_only` RLS)
2. Filter sessions by the first-session visibility rule
3. Strip zoom_host_url and admin-only fields before returning

This avoids complex multi-company RLS policies while maintaining strict isolation.

---

## 6. Concurrency & Idempotency

### 6.1 Seat Allocation — Atomic Count Check

```python
def allocate_seat(purchase_id, user_id):
    with transaction.atomic():
        purchase = SeatPurchase.objects.select_for_update().get(pk=purchase_id)
        used = SeatAllocation.objects.filter(
            seat_purchase=purchase,
            status__in=["allocated", "active"],
        ).count()
        if used >= purchase.quantity:
            raise ServiceError("no_seats", "All seats allocated", status=409)
        # ... create allocation
```

### 6.2 Cohort Capacity

```python
def add_company_to_cohort(cohort_id, org_id, seats):
    with transaction.atomic():
        cohort = LiveCohort.objects.select_for_update().get(pk=cohort_id)
        if cohort.current_seats + seats > cohort.max_learners:
            raise ServiceError("cohort_full", "Cohort capacity exceeded", status=409)
        cohort.current_seats += seats
        cohort.save(update_fields=["current_seats", "updated_at"])
        # ... create CohortCompany
```

### 6.3 Stripe Fulfillment — Existing Pattern

All Stripe webhook handlers check `StripeEvent.event_id` uniqueness (existing
`apps/commerce/webhooks.py` pattern). Duplicate events return immediately.

B2B fulfillment functions are additionally idempotent:
- `fulfil_recorded_purchase()`: checks `SeatPurchase.stripe_session_id` uniqueness
- `fulfil_live_purchase()`: checks `CohortCompany.seat_purchase` uniqueness
- `fulfil_quote()`: checks `CorporateQuote.stripe_invoice_id` status

### 6.4 Quote Expiry

```python
def accept_quote(quote_id):
    quote = CorporateQuote.objects.get(pk=quote_id)
    if quote.valid_until < timezone.now():
        raise ServiceError("quote_expired", "Quote has expired", status=410)
    if quote.status != "sent":
        raise ServiceError("invalid_status", f"Cannot accept {quote.status} quote", status=409)
```

### 6.5 Payment Deadline for Live Holds

Celery periodic task (`apps/corporate/tasks.py`):
```python
@shared_task
def expire_unpaid_live_holds():
    expired = CohortCompany.objects.filter(
        status="pending_pay",
        payment_deadline__lt=timezone.now(),
    ).select_for_update(skip_locked=True)
    for cc in expired:
        cc.status = "cancelled"
        cc.save(update_fields=["status", "updated_at"])
        # Release capacity on cohort
        LiveCohort.objects.filter(pk=cc.cohort_id).update(
            current_seats=F("current_seats") - cc.approved_seats
        )
        audit(action="live_hold_expired", ...)
```

---

## 7. Migration Strategy

### 7.1 Schema Creation

```sql
-- 0001_corporate_schema.py (RunSQL)
CREATE SCHEMA IF NOT EXISTS corporate;
```

### 7.2 Table Creation Order (dependency-aware)

1. `0001` — Schema + CorporateOffering + Tutor
2. `0002` — CorporateQuote + QuoteItem + TrainingRequest + SeatPurchase
3. `0003` — LiveCohort + CohortCompany + TutorAssignment + Session
4. `0004` — SeatAllocation + ZoomEvent + SessionAttendance
5. `0005` — RLS policies for all tables

### 7.3 Gateway Extension

Additive functions in `apps/commerce/gateway.py` — no changes to existing functions.

### 7.4 Webhook Extension

New `meta.kind` values dispatched in existing `apps/commerce/webhooks.py`.
New Zoom webhook endpoint in `apps/corporate/zoom_webhooks.py`.

### 7.5 Existing Tables — No Changes

B2B does NOT modify any existing B2C or platform tables:
- No changes to Course, Enrollment, Certificate, ContentEntitlement
- No changes to Plan, Subscription, Order, Payment
- No changes to TokenGrant, TokenSpend, CashPackage
- Organization.stripe_customer_id is already present

The only cross-app interaction is:
- `Enrollment` rows created via existing `learning.enrol()` with `source="organization"`
- `gateway.py` gains additive functions for Stripe Invoicing
- `webhooks.py` gains new `meta.kind` dispatch branches

---

## 8. Testing Strategy

### 8.1 Test Infrastructure

All tests use `SchemaTransactionTestCase` from `core.tests.base` with `databases = {"default", "owner"}`.
Test data uses UUID-tagged fixtures (`uuid.uuid4().hex[:8]`) per existing convention.

### 8.2 Per-Milestone Test Plan

| Milestone | Test file | Key scenarios |
|-----------|----------|---------------|
| B2B-01 | `corporate/tests/test_seats.py` | Allocation, over-allocation rejection, release, reassign, concurrent allocation race, multi-company isolation, payment-before-allocation guard |
| B2B-02 | `corporate/tests/test_checkout.py` | Stripe Checkout fulfillment, duplicate webhook, invoice fulfillment, stale quote rejection, buyer role check, B2C regression |
| B2B-03 | `corporate/tests/test_cohorts.py` | Cohort formation, multi-company participation, schedule visibility (first-session rule), request status labels, capacity check |
| B2B-04 | `corporate/tests/test_live_payment.py` | Reservation TTL, expired hold cleanup, racing payments, duplicate invoice, capacity after refund |
| B2B-05 | `corporate/tests/test_zoom.py` | Webhook signature, participant matching, unresolved identity queue, duplicate events, email-missing fallback, multi-company attendance isolation |
| B2B-06 | `corporate/tests/test_api.py` | All role boundaries, hidden schedule, mixed personal/company, employee training detail, attendance report |
| B2B-07 | `corporate/tests/test_lifecycle.py` | Certificate flow, cancellation, refund + revocation, departure policy config |
| B2B-08 | `corporate/tests/test_integration.py` | Full E2E: 2 companies in same cohort, RLS isolation, Stripe idempotency, concurrent operations, B2C regression |

### 8.3 B2C Regression

Every milestone must run existing B2C test suite and confirm zero regressions:
```
python manage.py test apps.commerce.tests apps.platform.tests apps.learning.tests --keepdb --noinput -v 2
```

### 8.4 Multi-Company Isolation Test Pattern

```python
def test_company_a_cannot_see_company_b_seats(self):
    with tenant_context(org_id=self.org_a.id, user_id=self.admin_a.id):
        seats_a = SeatPurchase.objects.all()
    with tenant_context(org_id=self.org_b.id, user_id=self.admin_b.id):
        seats_b = SeatPurchase.objects.all()
    # org_a created purchases; org_b sees none
    self.assertGreater(seats_a.count(), 0)
    self.assertEqual(seats_b.count(), 0)
```

---

## 9. File Layout — New `apps/corporate/`

```
apps/corporate/
├── __init__.py
├── models.py          # All models from Section 2
├── services.py        # Seat allocation, purchase fulfillment, cohort management
├── selectors.py       # Read-only queries (training list, schedule, attendance)
├── api.py             # Company-facing API (extends /business/)
├── zoom_webhooks.py   # Zoom webhook handler
├── tasks.py           # Celery tasks (expire holds, process Zoom events)
├── admin.py           # Django admin (optional, for debugging)
├── migrations/
│   ├── 0001_initial.py
│   ├── 0002_quotes_requests_purchases.py
│   ├── 0003_cohorts_sessions.py
│   ├── 0004_allocations_zoom_attendance.py
│   └── 0005_rls_policies.py
└── tests/
    ├── __init__.py
    ├── test_seats.py
    ├── test_checkout.py
    ├── test_cohorts.py
    ├── test_live_payment.py
    ├── test_zoom.py
    ├── test_api.py
    ├── test_lifecycle.py
    └── test_integration.py
```

Console endpoints in existing `apps/platform/console/corporate.py`.

---

## 10. Dependency Map

```
B2B-00  Architecture (this doc)
  └─ B2B-01  Seat Ledger + Offerings + Allocations
       ├─ B2B-02  Recorded Checkout + Stripe Invoicing
       │    └─ B2B-06  Employer/Learner/Admin UI (recorded)
       └─ B2B-03  Live Request Pool + Cohorts + Sessions
            ├─ B2B-04  Live Payment + Reservation TTL
            │    └─ B2B-06  Employer/Learner/Admin UI (live)
            └─ B2B-05  Zoom Integration + Attendance
                 └─ B2B-06  Tutor UI + Attendance Reports
  B2B-07  Certificates + Cancellations + Departure (after G01/G04/G07 resolved)
  B2B-08  End-to-End Security + Finance Verification
```
