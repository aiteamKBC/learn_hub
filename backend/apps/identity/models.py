"""Identity: who people are. The ONLY schema holding personal details (decision 8):
every other table stores user_id, never a name or email (certificates are the one
documented exception). Anonymisation therefore touches this schema only.

AUTH_USER_MODEL = "identity.User" was set before the first migration on purpose:
swapping the user model later is one of the few changes Django cannot migrate.
"""

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.core.validators import MaxValueValidator
from django.db import models

from core.db import table
from core.models import BaseModel

SCHEMA = "identity"


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("Email is required")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self.create_user(email, password, **extra)


class User(BaseModel, AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(max_length=320, unique=True)  # stored lowercased, see save()
    full_name = models.CharField(max_length=200, blank=True)
    avatar_url = models.URLField(blank=True)
    timezone = models.CharField(max_length=64, default="UTC")  # display only; data is UTC
    preferred_currency = models.CharField(max_length=3, blank=True)  # ISO 4217, '' = auto
    phone = models.CharField(max_length=20, blank=True)  # collected at checkout review
    country = models.CharField(max_length=2, blank=True)  # ISO 3166-1 alpha-2
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)  # platform staff (console)
    stripe_customer_id = models.CharField(max_length=64, blank=True)
    anonymized_at = models.DateTimeField(null=True, blank=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        db_table = table(SCHEMA, "users")
        indexes = [
            models.Index(
                fields=["stripe_customer_id"],
                name="ix_users_stripe_customer",
                condition=~models.Q(stripe_customer_id=""),
            ),
        ]

    def save(self, *args, **kwargs):
        self.email = (self.email or "").strip().lower()  # Ali@x.com == ali@x.com
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.email


class InstructorProfile(BaseModel):
    class Type(models.TextChoices):
        IN_HOUSE = "in_house", "In-house"
        EXTERNAL = "external", "Marketplace"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending review"
        APPROVED = "approved", "Approved"
        SUSPENDED = "suspended", "Suspended"
        REJECTED = "rejected", "Rejected"

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="instructor_profile")
    instructor_type = models.CharField(max_length=16, choices=Type.choices, default=Type.EXTERNAL)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    headline = models.CharField(max_length=160, blank=True)
    bio = models.TextField(blank=True, max_length=5000)
    website_url = models.URLField(blank=True)
    social_links = models.JSONField(default=dict, blank=True)
    expertise = models.JSONField(default=list, blank=True)  # ["Web development", "Python"]
    public_slug = models.SlugField(max_length=80, unique=True, null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    # The platform's cut of this instructor's marketplace sales (2000 = 20%). Set from the
    # default when approved; staff can change it. NULL = use the platform default.
    platform_fee_bps = models.PositiveIntegerField(
        null=True, blank=True, validators=[MaxValueValidator(10000)]
    )
    # Denormalised counters, refreshed by jobs (never COUNT(*) on page load)
    rating_avg = models.DecimalField(max_digits=3, decimal_places=2, default=0)
    rating_count = models.PositiveIntegerField(default=0)
    student_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = table(SCHEMA, "instructor_profiles")
        indexes = [models.Index(fields=["status"], name="ix_instructor_status")]

    def __str__(self) -> str:
        return f"Instructor {self.user_id}"


class InstructorInvite(BaseModel):
    """A staff invitation to teach (console > Instructors). The emailed link is a signed
    token naming this row; cancelling the row makes every link for it stop working."""

    email = models.EmailField(max_length=320)
    name = models.CharField(max_length=200, blank=True)
    invited_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    sent_at = models.DateTimeField()
    expires_at = models.DateTimeField()
    send_count = models.PositiveSmallIntegerField(default=1)
    accepted_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = table(SCHEMA, "instructor_invites")
        indexes = [models.Index(fields=["email"], name="ix_instructor_invite_email")]
