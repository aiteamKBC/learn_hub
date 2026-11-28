"""Console > Bundles: the platform admin picks the courses in each bundle and its seat price."""

from uuid import UUID

from ninja import Field, Schema

from apps.corporate.bundles import bundle_out, save_bundle
from apps.corporate.models import CourseBundle

from .common import ConsoleIdOut, router, staff


class ConsoleBundleIn(Schema):
    title: str = Field(..., max_length=160)
    description: str = Field("", max_length=2000)
    seat_price_minor: int = Field(..., ge=1, le=10_000_000)
    is_active: bool = True
    course_ids: list[UUID] = Field(..., max_length=20)


class ConsoleBundleCourseOut(Schema):
    course_id: str
    title: str
    slug: str
    seats_on_sale: bool
    normal_price_minor: int | None = None


class ConsoleBundleOut(Schema):
    id: str
    title: str
    description: str
    seat_price_minor: int
    is_active: bool
    currency: str
    courses: list[ConsoleBundleCourseOut]


@router.get("/corporate/bundles", response=list[ConsoleBundleOut])
def list_bundles(request):
    staff(request)
    qs = CourseBundle.objects.prefetch_related("items__course").order_by("-is_active", "title")
    return [bundle_out(b) for b in qs[:200]]


@router.post("/corporate/bundles", response=ConsoleIdOut)
def create_bundle(request, body: ConsoleBundleIn):
    staff(request)
    return {"id": save_bundle(request, body.dict()).id}


@router.put("/corporate/bundles/{bundle_id}", response=ConsoleIdOut)
def update_bundle(request, bundle_id: UUID, body: ConsoleBundleIn):
    staff(request)
    return {"id": save_bundle(request, body.dict(), bundle_id=bundle_id).id}
