"""Accepting a staff invitation to teach (/teach/invite/<token> in the app)."""

from ninja import Field, Router, Schema

from core.auth import session_auth

from . import invites

router = Router(tags=["identity"])


class InstructorInvitePreviewOut(Schema):
    email: str


class InstructorInviteIn(Schema):
    token: str = Field(..., min_length=10, max_length=600)


class InstructorInviteAcceptedOut(Schema):
    status: str


@router.get("/preview", response=InstructorInvitePreviewOut, auth=None)
def preview_invite(request, token: str):
    return invites.preview(token)


@router.post("/accept", response=InstructorInviteAcceptedOut, auth=session_auth)
def accept_invite(request, body: InstructorInviteIn):
    return {"status": invites.accept(token=body.token, user=request.user).status}
