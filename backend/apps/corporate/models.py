from django.conf import settings
from django.db import models
from django.db.models import Q

from core.db import table
from core.models import BaseModel, TenantModel

User = settings.AUTH_USER_MODEL
SCHEMA = "corporate"


class CorporateOffering(BaseModel):
    class DeliveryType(models.TextChoices):
        RECORDED = "recorded", "Recorded Course Package"
        LIVE = "live", "Corporate Live Training"

    course = models.ForeignKey("catalog.Course", on_delete=models.PROTECT, related_name="+")
    delivery_type = models.CharField(max_length=10, choices=DeliveryType.choices)
    price_tier = models.ForeignKey("commerce.PriceTier", on_delete=models.PROTECT, related_name="+")
    is_active = models.BooleanField(default=True)
    custom_quote_enabled = models.BooleanField(default=False)
    description = models.TextField(blank=True)

    class Meta:
        db_table = table(SCHEMA, "corporate_offerings")
        constraints = [
            models.UniqueConstraint(
                fields=["course", "delivery_type"],
                condition=Q(is_active=True),
                name="uq_offering_active_per_course_delivery",
            ),
        ]


class CorporateQuote(TenantModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent to company"
        ACCEPTED = "accepted", "Accepted & paid"
        EXPIRED = "expired", "Expired"
        DECLINED = "declined", "Declined"
        VOIDED = "voided", "Voided by admin"

    buyer = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    valid_until = models.DateTimeField()
    currency = models.CharField(max_length=3)
    total_minor = models.IntegerField(default=0)
    stripe_invoice_id = models.CharField(max_length=255, blank=True)
    stripe_invoice_url = models.CharField(max_length=1024, blank=True)
    notes = models.TextField(blank=True)
    created_by_staff = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "corporate_quotes")
        indexes = [
            models.Index(fields=["org", "status"], name="ix_quote_org_status"),
        ]


class QuoteItem(TenantModel):
    quote = models.ForeignKey(CorporateQuote, on_delete=models.CASCADE, related_name="items")
    offering = models.ForeignKey(CorporateOffering, on_delete=models.PROTECT, related_name="+")
    quantity = models.PositiveIntegerField()
    unit_price_minor = models.IntegerField()
    line_total_minor = models.IntegerField()

    class Meta:
        db_table = table(SCHEMA, "quote_items")


class SeatPurchase(TenantModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending payment"
        PAID = "paid", "Paid"
        REFUNDED = "refunded", "Fully refunded"
        PARTIAL = "partial", "Partially refunded"
        EXPIRED = "expired", "Payment expired"
        VOIDED = "voided", "Voided"

    offering = models.ForeignKey(CorporateOffering, on_delete=models.PROTECT, related_name="+")
    buyer = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    quantity = models.PositiveIntegerField()
    unit_price_minor = models.IntegerField()
    currency = models.CharField(max_length=3)
    total_minor = models.IntegerField()
    gbp_total_minor = models.IntegerField()
    fx_rate = models.DecimalField(max_digits=12, decimal_places=6, default=1)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    stripe_session_id = models.CharField(max_length=255, blank=True)
    stripe_invoice_id = models.CharField(max_length=255, blank=True)
    payment_intent = models.CharField(max_length=255, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    refunded_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    quote = models.ForeignKey(
        CorporateQuote,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        db_table = table(SCHEMA, "seat_purchases")
        indexes = [
            models.Index(fields=["org", "offering", "status"], name="ix_sp_org_offering"),
            models.Index(fields=["stripe_session_id"], name="ix_sp_stripe_session"),
        ]


class SeatAllocation(TenantModel):
    class Status(models.TextChoices):
        ALLOCATED = "allocated", "Seat assigned, enrollment pending"
        ACTIVE = "active", "Enrollment created"
        REVOKED = "revoked", "Admin revoked"
        RELEASED = "released", "Released for reassignment"

    seat_purchase = models.ForeignKey(SeatPurchase, on_delete=models.PROTECT, related_name="allocations")
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ALLOCATED)
    allocated_at = models.DateTimeField(auto_now_add=True)
    activated_at = models.DateTimeField(null=True, blank=True)
    released_at = models.DateTimeField(null=True, blank=True)
    released_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    release_reason = models.TextField(blank=True)
    enrollment = models.ForeignKey(
        "learning.Enrollment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

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


class AllocationEvent(TenantModel):
    class Action(models.TextChoices):
        ALLOCATED = "allocated", "Seat allocated"
        ACTIVATED = "activated", "Enrollment created"
        REVOKED = "revoked", "Seat revoked"
        RELEASED = "released", "Released for reassignment"
        REASSIGNED = "reassigned", "Reassigned to another employee"

    allocation = models.ForeignKey(SeatAllocation, on_delete=models.PROTECT, related_name="events")
    action = models.CharField(max_length=16, choices=Action.choices)
    actor = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    target_user = models.ForeignKey(User, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    previous_user = models.ForeignKey(User, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    note = models.TextField(blank=True)

    class Meta:
        db_table = table(SCHEMA, "allocation_events")
        indexes = [
            models.Index(fields=["org", "allocation"], name="ix_ae_org_alloc"),
        ]


# ================================================================ B2B-03: Live Training Models


class TrainingRequest(TenantModel):
    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        UNDER_REVIEW = "under_review", "Under review"
        SCHEDULING = "scheduling", "Scheduling in progress"
        OFFERED = "offered", "Cohort offered"
        ACCEPTED = "accepted", "Company accepted"
        DECLINED = "declined", "Company declined"
        EXPIRED = "expired", "Request expired"
        CANCELLED = "cancelled", "Cancelled"

    course = models.ForeignKey("catalog.Course", on_delete=models.PROTECT, related_name="+")
    requester = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    requested_seats = models.PositiveIntegerField()
    preferred_intake = models.CharField(max_length=50, blank=True)
    preferred_delivery_mode = models.CharField(max_length=12, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SUBMITTED)
    admin_notes = models.TextField(blank=True)
    status_label = models.CharField(max_length=64, blank=True)

    class Meta:
        db_table = table(SCHEMA, "training_requests")
        indexes = [
            models.Index(fields=["org", "status"], name="ix_treq_org_status"),
            models.Index(fields=["course", "status"], name="ix_treq_course_status"),
        ]


class LiveCohort(BaseModel):
    class Status(models.TextChoices):
        FORMING = "forming", "Forming (gathering interest)"
        CONFIRMED = "confirmed", "Schedule confirmed"
        PENDING_PAY = "pending_pay", "Awaiting company payments"
        IN_PROGRESS = "in_progress", "In progress"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    class DeliveryMode(models.TextChoices):
        ONLINE = "online", "Online (Zoom)"
        IN_PERSON = "in_person", "In-person"
        HYBRID = "hybrid", "Hybrid"

    course = models.ForeignKey("catalog.Course", on_delete=models.PROTECT, related_name="+")
    title = models.CharField(max_length=200, blank=True)
    intake = models.CharField(max_length=50, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.FORMING)
    delivery_mode = models.CharField(max_length=12, choices=DeliveryMode.choices)
    min_learners = models.PositiveIntegerField(default=1)
    max_learners = models.PositiveIntegerField()
    current_seats = models.PositiveIntegerField(default=0)
    scheduled_start = models.DateField(null=True, blank=True)
    scheduled_end = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        db_table = table(SCHEMA, "live_cohorts")
        indexes = [
            models.Index(fields=["course", "status"], name="ix_cohort_course_status"),
            models.Index(fields=["intake"], name="ix_cohort_intake"),
        ]


class CohortCompany(TenantModel):
    class Status(models.TextChoices):
        INTERESTED = "interested", "Interest registered"
        OFFERED = "offered", "Cohort offered to company"
        PENDING_PAY = "pending_pay", "Awaiting payment"
        PAID = "paid", "Payment confirmed"
        ACTIVE = "active", "Learners enrolled"
        COMPLETED = "completed", "Cohort completed"
        CANCELLED = "cancelled", "Company cancelled"
        WITHDRAWN = "withdrawn", "Admin withdrew company"

    cohort = models.ForeignKey(LiveCohort, on_delete=models.PROTECT, related_name="companies")
    training_request = models.ForeignKey(
        TrainingRequest,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    seat_purchase = models.ForeignKey(
        SeatPurchase,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    approved_seats = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.INTERESTED)
    payment_deadline = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "cohort_companies")
        constraints = [
            models.UniqueConstraint(fields=["cohort", "org"], name="uq_cohort_company"),
        ]


class Session(BaseModel):
    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        IN_PROGRESS = "in_progress", "In progress"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        RESCHEDULED = "rescheduled", "Rescheduled"

    cohort = models.ForeignKey(LiveCohort, on_delete=models.PROTECT, related_name="sessions")
    sequence = models.PositiveIntegerField()
    title = models.CharField(max_length=200, blank=True)
    scheduled_at = models.DateTimeField()
    duration_min = models.PositiveIntegerField()
    delivery_mode = models.CharField(max_length=12, choices=LiveCohort.DeliveryMode.choices)
    location = models.CharField(max_length=500, blank=True)
    zoom_meeting_id = models.CharField(max_length=64, blank=True)
    zoom_join_url = models.CharField(max_length=1024, blank=True)
    zoom_host_url = models.CharField(max_length=1024, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SCHEDULED)
    actual_start = models.DateTimeField(null=True, blank=True)
    actual_end = models.DateTimeField(null=True, blank=True)
    reschedule_note = models.TextField(blank=True)

    class Meta:
        db_table = table(SCHEMA, "sessions")
        constraints = [
            models.UniqueConstraint(fields=["cohort", "sequence"], name="uq_session_sequence"),
        ]
        indexes = [
            models.Index(fields=["cohort", "scheduled_at"], name="ix_session_schedule"),
        ]


class Tutor(BaseModel):
    class Type(models.TextChoices):
        INTERNAL = "internal", "Internal"
        EXTERNAL = "external", "External"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        SUSPENDED = "suspended", "Suspended"

    user = models.OneToOneField(User, on_delete=models.PROTECT, related_name="tutor_profile")
    type = models.CharField(max_length=10, choices=Type.choices)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    approved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)
    bio = models.TextField(blank=True)
    specializations = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = table(SCHEMA, "tutors")


class TutorAssignment(BaseModel):
    tutor = models.ForeignKey(Tutor, on_delete=models.PROTECT, related_name="assignments")
    cohort = models.ForeignKey(LiveCohort, on_delete=models.PROTECT, related_name="tutor_assignments")
    assigned_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = table(SCHEMA, "tutor_assignments")
        constraints = [
            models.UniqueConstraint(fields=["tutor", "cohort"], name="uq_tutor_cohort"),
        ]


# ================================================================ B2B-07: Cancellations / Policies


class CancellationRequest(TenantModel):
    class Type(models.TextChoices):
        COHORT_CANCEL = "cohort_cancel", "Cohort cancellation"
        RECORDED_REFUND = "recorded_refund", "Recorded package refund"
        POSTPONEMENT = "postponement", "Cohort postponement"

    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        UNDER_REVIEW = "under_review", "Under review"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        PROCESSED = "processed", "Refund processed"

    type = models.CharField(max_length=20, choices=Type.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SUBMITTED)
    requester = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    seat_purchase = models.ForeignKey(
        SeatPurchase,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    cohort_company = models.ForeignKey(
        "CohortCompany",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    reason = models.TextField()
    admin_notes = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    refund_amount_minor = models.IntegerField(null=True, blank=True)
    refund_currency = models.CharField(max_length=3, blank=True)
    stripe_refund_id = models.CharField(max_length=255, blank=True)
    refunded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "cancellation_requests")
        indexes = [
            models.Index(fields=["org", "status"], name="ix_cancel_org_status"),
        ]


class DeparturePolicy(TenantModel):
    class Action(models.TextChoices):
        REVOKE_ALL = "revoke_all", "Revoke all active enrollments"
        PRESERVE_COMPLETED = "preserve_completed", "Keep completed, revoke active"
        ADMIN_DECIDES = "admin_decides", "Admin decides per case"

    action = models.CharField(max_length=20, choices=Action.choices, default=Action.ADMIN_DECIDES)
    set_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    notes = models.TextField(blank=True)

    class Meta:
        db_table = table(SCHEMA, "departure_policies")
        constraints = [
            models.UniqueConstraint(fields=["org"], name="uq_departure_policy_org"),
        ]


# ================================================================ B2B-05: Zoom + Attendance Models


class ZoomEvent(BaseModel):
    event_id = models.CharField(max_length=64, unique=True)
    event_type = models.CharField(max_length=64)
    meeting_id = models.CharField(max_length=64, db_index=True)
    account_id = models.CharField(max_length=64, blank=True)
    payload = models.JSONField()
    received_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True)

    class Meta:
        db_table = table(SCHEMA, "zoom_events")


class SessionAttendance(BaseModel):
    class MatchStatus(models.TextChoices):
        VERIFIED = "verified", "Confidently matched"
        UNRESOLVED = "unresolved", "Needs admin review"
        REJECTED = "rejected", "Admin rejected match"

    class Source(models.TextChoices):
        ZOOM_WEBHOOK = "zoom_webhook", "Zoom webhook (auto)"
        MANUAL_ADMIN = "manual_admin", "Manual entry by admin"
        MANUAL_TUTOR = "manual_tutor", "Manual entry by tutor"

    session = models.ForeignKey(Session, on_delete=models.PROTECT, related_name="attendance_records")
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    org = models.ForeignKey("org.Organization", on_delete=models.PROTECT, related_name="+")
    source = models.CharField(max_length=16, choices=Source.choices)
    match_status = models.CharField(max_length=12, choices=MatchStatus.choices, default=MatchStatus.VERIFIED)
    join_at = models.DateTimeField()
    leave_at = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(default=0)
    is_verified = models.BooleanField(default=False)
    verified_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    zoom_event = models.ForeignKey(
        ZoomEvent, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    zoom_participant_email = models.CharField(max_length=255, blank=True)
    zoom_display_name = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = table(SCHEMA, "session_attendance")
        indexes = [
            models.Index(fields=["session", "user"], name="ix_att_session_user"),
            models.Index(fields=["org", "user", "session"], name="ix_att_org_user"),
        ]
