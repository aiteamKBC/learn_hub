"""Platform: running the system.

Postgres schema: platform.

    settings         reference: platform-wide settings and feature flags (staff write)
    entitlements     what a company or person may use (Team plan seats, content protection),
                     written only from verified payments or by staff
    outbox_events    the transactional outbox: an event is saved IN THE SAME TRANSACTION as
                     the change it describes, then dispatched. Nothing is lost if a worker
                     or Redis dies between commit and enqueue (payments -> payouts rely on it)
    webhook_events   every inbound provider webhook (Bunny), stored once, then processed
    audit_logs       append-only, partitioned by month (SQL in migration 0002): who did what,
                     when, from where. No UPDATE or DELETE is possible for the app role
"""

from django.conf import settings
from django.db import models
from django.db.models import Q

from core.db import table
from core.models import BaseModel

SCHEMA = "platform"
User = settings.AUTH_USER_MODEL


class Setting(BaseModel):
    key = models.CharField(max_length=100, unique=True)  # "signup.enabled", "flags.ai_assistant"
    value = models.JSONField()
    description = models.CharField(max_length=300, blank=True)
    is_public = models.BooleanField(default=False)  # may be sent to the browser
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        db_table = table(SCHEMA, "settings")

    def __str__(self) -> str:
        return self.key


class Entitlement(BaseModel):
    class Source(models.TextChoices):
        SUBSCRIPTION = "subscription", "Team or personal plan"
        ADDON = "addon", "Add-on subscription"
        GRANT = "grant", "Granted by staff"

    org = models.ForeignKey(
        "org.Organization", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True, related_name="+")
    feature = models.CharField(max_length=60)  # "business", "personal_plan", "content_protection"
    source = models.CharField(max_length=12, choices=Source.choices)
    source_ref = models.UUIDField(null=True, blank=True)  # subscription / addon subscription id
    seats = models.PositiveIntegerField(null=True, blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)  # NULL = until revoked
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = table(SCHEMA, "entitlements")
        constraints = [
            models.CheckConstraint(
                condition=(Q(org__isnull=False) & Q(user__isnull=True))
                | (Q(org__isnull=True) & Q(user__isnull=False)),
                name="ck_entitlement_one_owner",
            ),
            models.UniqueConstraint(
                fields=["feature", "source", "source_ref"],
                condition=Q(source_ref__isnull=False),
                name="uq_entitlement_source",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "feature"], name="ix_ent_org", condition=Q(org__isnull=False)),
            models.Index(fields=["user", "feature"], name="ix_ent_user", condition=Q(user__isnull=False)),
        ]


class ContentEntitlement(BaseModel):
    """B2C Unified Content Access Engine — personal, user-owned entitlement.

    An authoritative "this user may access this course/lecture/material" row, created
    by a verified payment (cash package, token unlock), a subscription grant (NOT used
    — subscription access is evaluated live by the resolver), an admin grant, or a
    legacy backfill from an existing completed Order + personal Enrollment.

    org is kept NULL on purpose: B2C entitlements are strictly personal. B2B access
    continues to flow through the existing `Entitlement` table above (feature+org).
    """

    class Scope(models.TextChoices):
        COURSE = "course", "Course"
        LECTURE = "lecture", "Lecture"
        MATERIAL = "material", "Material / downloadable asset"

    class Source(models.TextChoices):
        CASH_PACKAGE = "cash_package", "Cash package purchase"
        TOKEN_UNLOCK = "token_unlock", "Token unlock (lecture/material)"
        FULL_COURSE_TOKEN_UNLOCK = "full_course_token_unlock", "Token unlock (whole course)"
        SUBSCRIPTION = "subscription", "Subscription (evaluated live — rarely persisted)"
        ADMIN_GRANT = "admin_grant", "Granted by staff"
        LEGACY_PURCHASE = "legacy_purchase", "Pre-B2C-v2 completed order / enrolment"
        PREVIEW = "preview", "Free preview flag"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    # Personal by design: NULL org. Kept nullable for symmetry with the B2B Entitlement.
    org = models.ForeignKey(
        "org.Organization", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    scope = models.CharField(max_length=12, choices=Scope.choices)
    target_id = models.UUIDField()  # course_id, lecture_id or material (LectureResource) id
    source = models.CharField(max_length=32, choices=Source.choices)
    # source_ref points at an Order, OrderItem, TokenSpend, Subscription, Enrollment etc.
    # Deliberately a free-form UUID so this table does not import commerce/learning models.
    source_ref = models.UUIDField(null=True, blank=True)
    source_ref_kind = models.CharField(max_length=32, blank=True)  # "order", "token_spend", "enrollment"...
    granted_at = models.DateTimeField()
    expires_at = models.DateTimeField(null=True, blank=True)  # NULL = lifetime
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=300, blank=True)
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = table(SCHEMA, "content_entitlements")
        indexes = [
            models.Index(fields=["user", "scope", "target_id"], name="ix_cent_user_target"),
            models.Index(
                fields=["user", "scope", "target_id"],
                name="ix_cent_active",
                condition=Q(revoked_at__isnull=True),
            ),
            models.Index(
                fields=["expires_at"], name="ix_cent_expires", condition=Q(expires_at__isnull=False)
            ),
        ]
        constraints = [
            # One live entitlement per (user, scope, target, source) — prevents duplicates
            # when a webhook or backfill retries.
            models.UniqueConstraint(
                fields=["user", "scope", "target_id", "source"],
                condition=Q(revoked_at__isnull=True),
                name="uq_cent_active_per_source",
            ),
            models.CheckConstraint(
                condition=Q(revoked_at__isnull=True) | Q(revoked_at__gte=models.F("granted_at")),
                name="ck_cent_revoke_after_grant",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} {self.scope}:{self.target_id} ({self.source})"


class AccessAuditLog(BaseModel):
    """Append-only trail of every resolver decision.

    Written by `apps.platform.access.resolve()` for allow and deny. No UPDATE / DELETE
    is issued by app code — the row survives as support evidence.

    TODO (M-wallet / M12): move writes to an async queue so the resolver stays off the
    request hot path on busy course-outline fetches; see architecture §11.
    """

    class Decision(models.TextChoices):
        ALLOW = "allow", "Allow"
        DENY = "deny", "Deny"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    scope = models.CharField(max_length=12, choices=ContentEntitlement.Scope.choices)
    target_id = models.UUIDField()
    decision = models.CharField(max_length=6, choices=Decision.choices)
    reason_code = models.CharField(max_length=40)
    resolved_source = models.CharField(max_length=32, blank=True)
    checked_at = models.DateTimeField()
    request_id = models.CharField(max_length=64, blank=True)

    class Meta:
        db_table = table(SCHEMA, "access_audit_log")
        indexes = [
            models.Index(fields=["user", "scope", "target_id"], name="ix_aal_user_target"),
            models.Index(fields=["checked_at"], name="ix_aal_time"),
        ]


class SubscriptionAccessEvent(BaseModel):
    """Tracks per-lecture access events for subscription users.

    Used by the F03 revenue pool calculation to attribute subscription revenue
    to instructors based on actual content consumption.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    subscription = models.UUIDField()
    course = models.ForeignKey("catalog.Course", on_delete=models.CASCADE, related_name="+")
    lecture = models.ForeignKey("catalog.Lecture", on_delete=models.CASCADE, related_name="+")
    duration_seconds = models.PositiveIntegerField(default=0)
    accessed_at = models.DateTimeField()

    class Meta:
        db_table = table(SCHEMA, "subscription_access_events")
        indexes = [
            models.Index(fields=["user", "course", "-accessed_at"], name="ix_sae_user_course"),
            models.Index(fields=["subscription", "-accessed_at"], name="ix_sae_sub"),
        ]


class OutboxEvent(BaseModel):
    topic = models.CharField(max_length=80)  # "order.paid"
    payload = models.JSONField()
    available_at = models.DateTimeField()  # retry backoff moves this forward
    attempts = models.PositiveSmallIntegerField(default=0)
    processed_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True)

    class Meta:
        db_table = table(SCHEMA, "outbox_events")
        indexes = [
            models.Index(
                fields=["available_at"], name="ix_outbox_due", condition=Q(processed_at__isnull=True)
            ),
            models.Index(
                fields=["processed_at"], name="ix_outbox_done", condition=Q(processed_at__isnull=False)
            ),
        ]


class WebhookEvent(BaseModel):
    provider = models.CharField(max_length=20)  # "bunny"
    dedupe_key = models.CharField(max_length=200)
    payload = models.JSONField()
    processed_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True)

    class Meta:
        db_table = table(SCHEMA, "webhook_events")
        constraints = [models.UniqueConstraint(fields=["provider", "dedupe_key"], name="uq_webhook_once")]


class AuditLog(models.Model):
    """Read model for the partitioned audit table (created by SQL; Django never alters it)."""

    id = models.BigIntegerField(primary_key=True)
    created_at = models.DateTimeField()
    actor_id = models.UUIDField(null=True)
    org_id = models.UUIDField(null=True)
    action = models.CharField(max_length=80)
    target_type = models.CharField(max_length=60)
    target_id = models.CharField(max_length=64)
    ip = models.GenericIPAddressField(null=True)
    request_id = models.CharField(max_length=64)
    data = models.JSONField()

    class Meta:
        managed = False
        db_table = table(SCHEMA, "audit_logs")

    def __str__(self) -> str:
        return f"{self.action} {self.target_type}:{self.target_id}"
