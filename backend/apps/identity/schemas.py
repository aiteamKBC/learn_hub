"""Pydantic In/Out schemas for the identity API."""

from uuid import UUID

from ninja import Field, Schema


class MembershipOut(Schema):
    org_id: UUID
    name: str
    slug: str
    role: str
    logo_url: str = ""
    primary_color: str = ""


class MeOut(Schema):
    id: UUID
    email: str
    full_name: str
    avatar_url: str
    timezone: str
    is_staff: bool
    preferred_currency: str
    is_instructor: bool
    instructor_status: str  # none | pending | approved | suspended | rejected
    memberships: list[MembershipOut]


class MePatchIn(Schema):
    full_name: str | None = Field(None, max_length=200)
    timezone: str | None = Field(None, max_length=64)
    preferred_currency: str | None = Field(None, max_length=3)


class OkOut(Schema):
    ok: bool = True


class TotpQrOut(Schema):
    """The pending 2-step key as a QR code (an SVG data URI), for the setup screen."""

    image: str
