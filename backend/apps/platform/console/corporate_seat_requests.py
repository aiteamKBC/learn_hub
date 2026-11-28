"""Console > Employee invitation requests: employers' employee lists for paid recorded
seats, approved or rejected here when the platform requires approval
(setting corporate.invite_approval_required)."""

from ninja import Schema

from apps.corporate.api import SeatRequestOut, seat_request_out
from apps.corporate.models import SeatRequest
from core.tenancy import tenant_context

from .common import router, staff


class ConsoleSeatRequestOut(SeatRequestOut):
    org_id: str
    org_name: str


class ConsoleSeatReviewIn(Schema):
    note: str = ""


def _out(r) -> dict:
    return {**seat_request_out(r), "org_id": str(r.org_id), "org_name": r.org.name}


@router.get("/seat-requests", response=list[ConsoleSeatRequestOut])
def list_seat_requests(request, status: str = "pending_approval"):
    """Requests across companies, newest first (default: waiting for approval)."""
    staff(request)
    with tenant_context(staff=True):
        qs = SeatRequest.objects.all()
        if status != "all":
            qs = qs.filter(status=status)
        qs = qs.select_related("org", "offering__course", "submitted_by").order_by("-created_at")[:100]
        return [_out(r) for r in qs]


@router.post("/seat-requests/{request_id}/approve", response=ConsoleSeatRequestOut)
def approve_seat_request(request, request_id: str, body: ConsoleSeatReviewIn):
    """Approve: invites go out (or the course opens for people already in the company)."""
    staff(request)
    from apps.corporate.pending import review

    req = review(request, request_id, approve=True, note=body.note)
    with tenant_context(staff=True):
        return _out(
            SeatRequest.objects.select_related("org", "offering__course", "submitted_by").get(pk=req.pk)
        )


@router.post("/seat-requests/{request_id}/reject", response=ConsoleSeatRequestOut)
def reject_seat_request(request, request_id: str, body: ConsoleSeatReviewIn):
    """Reject: nothing is sent and the held seats are free again."""
    staff(request)
    from apps.corporate.pending import review

    req = review(request, request_id, approve=False, note=body.note)
    with tenant_context(staff=True):
        return _out(
            SeatRequest.objects.select_related("org", "offering__course", "submitted_by").get(pk=req.pk)
        )
