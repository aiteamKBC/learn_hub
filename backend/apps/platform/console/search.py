"""Console header: global search and the sidebar badge counts.

Search results link to console routes with a query parameter that opens the matching
detail panel (the pages read it):

    /console/students?user=<id>       /console/instructors?user=<id>
    /console/courses?course=<id>      /console/sales?order=<id>
    /console/communications?ticket=<id>   /console/certificates?q=<code>
"""

import re
from uuid import UUID

from django.db.models import Q
from ninja import Schema

from apps.catalog.models import CertificateTemplate, Course, CourseVersion
from apps.commerce.models import Order
from apps.engagement.models import ContentReport, Ticket
from apps.identity.models import InstructorProfile, User
from apps.learning.models import Certificate
from apps.payouts.models import PayoutRequest

from .common import router, staff

UUID_PREFIX = re.compile(r"^[0-9a-f-]{8,36}$")


class ConsoleSearchHitOut(Schema):
    id: UUID
    title: str
    subtitle: str
    url: str


class ConsoleSearchGroupOut(Schema):
    key: str  # users | instructors | courses | orders | tickets | certificates
    label: str
    hits: list[ConsoleSearchHitOut]


class ConsoleSearchOut(Schema):
    q: str
    groups: list[ConsoleSearchGroupOut]


class ConsoleNavCountsOut(Schema):
    approvals: int
    tickets_open: int
    reports_open: int
    payout_requests: int


def _people(q: str, n: int):
    match = Q(email__icontains=q) | Q(full_name__icontains=q)
    rows = list(User.objects.filter(match, anonymized_at__isnull=True).order_by("full_name", "id")[: n * 2])
    teaching = set(InstructorProfile.objects.filter(user__in=rows).values_list("user_id", flat=True))
    learners = [u for u in rows if u.id not in teaching][:n]
    instructors = [u for u in rows if u.id in teaching][:n]
    return (
        [{"id": u.id, "title": u.full_name or u.email, "subtitle": u.email, "url": f"/console/students?user={u.id}"}
         for u in learners],
        [{"id": u.id, "title": u.full_name or u.email, "subtitle": u.email, "url": f"/console/instructors?user={u.id}"}
         for u in instructors],
    )  # fmt: skip


@router.get("/search", response=ConsoleSearchOut)
def search(request, q: str = "", limit: int = 5):
    """Grouped results for the header search (at most `limit` per group, 6 small queries)."""
    staff(request)
    q = q.strip()[:100]
    n = max(1, min(limit, 10))
    if len(q) < 2:
        return {"q": q, "groups": []}
    learners, instructors = _people(q, n)
    courses = [{"id": c.id, "title": c.title, "subtitle": c.get_status_display(), "url": f"/console/courses?course={c.id}"}
               for c in Course.objects.filter(Q(title__icontains=q) | Q(slug__icontains=q.lower()))
               .order_by("title")[:n]]  # fmt: skip
    order_q = Q(user__email__icontains=q) | Q(stripe_payment_intent_id__iexact=q)
    if UUID_PREFIX.match(q.lower()):
        order_q |= Q(id__startswith=q.lower()) if len(q) < 36 else Q(id=q.lower())
    orders = [{"id": o.id, "title": f"Order {str(o.id)[:8].upper()}", "subtitle": f"{o.user.email} · {o.get_status_display()}",
               "url": f"/console/sales?order={o.id}"}
              for o in Order.objects.filter(order_q).select_related("user").order_by("-id")[:n]]  # fmt: skip
    tickets = [{"id": t.id, "title": f"{t.reference} · {t.subject}", "subtitle": t.get_status_display(),
                "url": f"/console/communications?ticket={t.id}"}
               for t in Ticket.objects.filter(Q(reference__iexact=q) | Q(subject__icontains=q)).order_by("-last_message_at")[:n]]  # fmt: skip
    certs = [{"id": c.id, "title": c.verification_code, "subtitle": f"{c.recipient_name} · {c.course_title}",
              "url": f"/console/certificates?q={c.verification_code}"}
             for c in Certificate.objects.filter(Q(verification_code__iexact=q) | Q(recipient_name__icontains=q))
             .order_by("-issued_at")[:n]]  # fmt: skip
    groups = [("students", "Students", learners), ("instructors", "Instructors", instructors),
              ("courses", "Courses", courses), ("orders", "Orders", orders), ("tickets", "Support tickets", tickets),
              ("certificates", "Certificates", certs)]  # fmt: skip
    return {"q": q, "groups": [{"key": k, "label": label, "hits": hits} for k, label, hits in groups if hits]}


@router.get("/nav-counts", response=ConsoleNavCountsOut)
def nav_counts(request):
    """Badges in the console sidebar (polled once a minute)."""
    staff(request)
    return {
        "approvals": CourseVersion.objects.filter(status="in_review").count()
        + CertificateTemplate.objects.filter(status="pending").count(),
        "tickets_open": Ticket.objects.filter(status__in=["open", "progress"]).count(),
        "reports_open": ContentReport.objects.filter(status="open").count(),
        "payout_requests": PayoutRequest.objects.filter(status="pending").count(),
    }
