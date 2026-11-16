"""HR actions on required training (compliance). Endpoints call these; Ninja stays out.

All run inside the company's RLS context (request with app.org_id set). Changes that
touch one person refresh that person immediately, in the same transaction, so the
matrix is right the moment HR clicks. Changes that can touch thousands of people
(a new rule, new targets) are refreshed by a background job after commit.
"""

from datetime import datetime

from django.db import connection, transaction
from django.utils import timezone

from apps.catalog.models import Course
from apps.org.models import JobRole, OrgUnit
from core.errors import ServiceError

from . import engine
from .models import CompletionRecord, Exemption, MemberStatus, Reminder, Requirement, RequirementTarget


def _refresh_later(org_id, *, requirement_ids=None, member_ids=None) -> None:
    from .tasks import refresh_org_task  # tasks import services' neighbours; avoid a cycle

    reqs = [str(r) for r in requirement_ids] if requirement_ids else None
    members = [str(m) for m in member_ids] if member_ids else None
    transaction.on_commit(
        lambda: refresh_org_task.delay(str(org_id), requirement_ids=reqs, member_ids=members)
    )


def _refresh_member(status: MemberStatus) -> None:
    engine.lock_org(status.org_id)
    engine.recompute(status.org_id, requirement_ids=[status.requirement_id], member_ids=[status.member_id])
    engine.open_renewals(status.org_id, member_ids=[status.member_id])
    status.refresh_from_db()


# ---------------------------------------------------------------- rules
def _validate_targets(org_id, targets: list[dict]) -> list[dict]:
    if not targets:
        raise ServiceError("no_targets", "Choose who this applies to (or everyone).")
    unit_ids = {t["unit_id"] for t in targets if t.get("unit_id")}
    role_ids = {t["job_role_id"] for t in targets if t.get("job_role_id")}
    if unit_ids and OrgUnit.objects.filter(
        org_id=org_id, id__in=unit_ids, archived_at__isnull=True
    ).count() != len(unit_ids):
        raise ServiceError("bad_unit", "One of the chosen units does not exist.")
    if role_ids and JobRole.objects.filter(
        org_id=org_id, id__in=role_ids, archived_at__isnull=True
    ).count() != len(role_ids):
        raise ServiceError("bad_job_role", "One of the chosen job roles does not exist.")
    seen, clean = set(), []
    for t in targets:
        key = (t.get("unit_id"), t.get("job_role_id"))
        if key not in seen:
            seen.add(key)
            clean.append({**t, "include_subunits": t.get("include_subunits", True)})
    return clean


@transaction.atomic
def create_requirement(
    *,
    org_id,
    course: Course,
    name: str,
    created_by,
    targets: list[dict],
    renewal_months: int | None = None,
    due_days: int = 30,
    expiring_soon_days: int = 30,
    reminder_days: list[int] | None = None,
    overdue_every_days: int = 7,
    description: str = "",
) -> Requirement:
    """targets: [{"unit_id": .., "job_role_id": .., "include_subunits": True}, ...];
    [{}] means everyone in the company."""
    if course.live_version_id is None:
        raise ServiceError("not_published", "Only published courses can be required.")
    if Requirement.objects.filter(org_id=org_id, name__iexact=name, archived_at__isnull=True).exists():
        raise ServiceError("duplicate_name", "A requirement with this name already exists.")
    targets = _validate_targets(org_id, targets)
    days = sorted({d for d in (reminder_days if reminder_days is not None else [14, 3]) if 0 < d <= 365})
    req = Requirement.objects.create(
        org_id=org_id,
        course=course,
        name=name,
        description=description,
        renewal_months=renewal_months,
        due_days=due_days,
        expiring_soon_days=expiring_soon_days,
        reminder_days=days,
        overdue_every_days=overdue_every_days,
        created_by=created_by,
    )
    RequirementTarget.objects.bulk_create(
        [RequirementTarget(org_id=org_id, requirement=req, **t) for t in targets]
    )
    _refresh_later(org_id, requirement_ids=[req.id])
    return req


@transaction.atomic
def set_targets(*, requirement: Requirement, targets: list[dict]) -> None:
    targets = _validate_targets(requirement.org_id, targets)
    requirement.targets.all().delete()
    RequirementTarget.objects.bulk_create(
        [RequirementTarget(org_id=requirement.org_id, requirement=requirement, **t) for t in targets]
    )
    _refresh_later(requirement.org_id, requirement_ids=[requirement.id])


@transaction.atomic
def update_requirement(*, requirement: Requirement, **changes) -> Requirement:
    """Renewal period, deadlines and reminder settings. Status is recomputed after commit;
    existing completion records keep the expiry they were given (an audit trail)."""
    allowed = {
        "name",
        "description",
        "renewal_months",
        "due_days",
        "expiring_soon_days",
        "reminder_days",
        "overdue_every_days",
    }
    unknown = set(changes) - allowed
    if unknown:
        raise ServiceError("bad_field", f"Cannot change: {', '.join(sorted(unknown))}.")
    for key, value in changes.items():
        setattr(requirement, key, value)
    requirement.save()
    _refresh_later(requirement.org_id, requirement_ids=[requirement.id])
    return requirement


@transaction.atomic
def archive_requirement(*, requirement: Requirement) -> None:
    requirement.archived_at = timezone.now()
    requirement.save(update_fields=["archived_at", "updated_at"])
    _refresh_later(requirement.org_id, requirement_ids=[requirement.id])


# ---------------------------------------------------------------- one person
def _add_months(when: datetime, months: int | None) -> datetime | None:
    """Same calendar arithmetic as the engine's SQL (31 Jan + 1 month = 28/29 Feb)."""
    if not months:
        return None
    with connection.cursor() as cur:
        cur.execute("SELECT %s::timestamptz + make_interval(months => %s)", [when, months])
        return cur.fetchone()[0]


@transaction.atomic
def extend_deadline(*, status: MemberStatus, due_at: datetime) -> MemberStatus:
    if due_at <= timezone.now():
        raise ServiceError("past_deadline", "The new deadline must be in the future.")
    status.due_override_at = due_at
    status.save(update_fields=["due_override_at", "updated_at"])
    _refresh_member(status)
    return status


@transaction.atomic
def grant_exemption(
    *, status: MemberStatus, reason: str, granted_by, ends_at: datetime | None = None
) -> Exemption:
    if not reason.strip():
        raise ServiceError("reason_required", "Give a reason for the exemption.")
    exemption = Exemption.objects.create(
        org_id=status.org_id,
        requirement_id=status.requirement_id,
        member_id=status.member_id,
        reason=reason.strip()[:300],
        starts_at=timezone.now(),
        ends_at=ends_at,
        granted_by=granted_by,
    )
    _refresh_member(status)
    return exemption


@transaction.atomic
def revoke_exemption(*, exemption: Exemption) -> None:
    Exemption.objects.filter(pk=exemption.pk, revoked_at__isnull=True).update(
        revoked_at=timezone.now(), updated_at=timezone.now()
    )
    status = MemberStatus.objects.get(requirement_id=exemption.requirement_id, member_id=exemption.member_id)
    _refresh_member(status)


@transaction.atomic
def record_manual_completion(
    *, status: MemberStatus, completed_at: datetime, recorded_by, note: str, evidence_asset_id=None
) -> CompletionRecord:
    """External training, or a personal certificate the learner chose to show HR."""
    if completed_at > timezone.now():
        raise ServiceError("future_date", "The completion date cannot be in the future.")
    if not note.strip():
        raise ServiceError("note_required", "Say what evidence was seen.")
    expires = _add_months(completed_at, status.requirement.renewal_months)
    record = CompletionRecord.objects.create(
        org_id=status.org_id,
        requirement_id=status.requirement_id,
        member_id=status.member_id,
        source=CompletionRecord.Source.MANUAL,
        completed_at=completed_at,
        expires_at=expires,
        evidence_asset_id=evidence_asset_id,
        note=note.strip()[:500],
        recorded_by=recorded_by,
    )
    MemberStatus.objects.filter(pk=status.pk).update(due_override_at=None)
    _refresh_member(status)
    return record


@transaction.atomic
def void_record(*, record: CompletionRecord, reason: str) -> None:
    if not reason.strip():
        raise ServiceError("reason_required", "Give a reason.")
    CompletionRecord.objects.filter(pk=record.pk, voided_at__isnull=True).update(
        voided_at=timezone.now(), void_reason=reason.strip()[:300], updated_at=timezone.now()
    )
    status = MemberStatus.objects.get(requirement_id=record.requirement_id, member_id=record.member_id)
    _refresh_member(status)


@transaction.atomic
def send_reminder(*, status: MemberStatus, sent_by) -> Reminder:
    """'Nudge' from the HR matrix: at most once per person, requirement and UTC day."""
    from .tasks import deliver_reminders_task

    if status.status in (MemberStatus.Status.COMPLIANT, MemberStatus.Status.EXEMPT):
        raise ServiceError("nothing_due", "This person has nothing due.")
    now = timezone.now()
    day = (now.date() - datetime(1970, 1, 1).date()).days
    reminder, created = Reminder.objects.get_or_create(
        member_status=status,
        kind=Reminder.Kind.MANUAL,
        due_at=status.due_at or now,
        step=day,
        defaults={"org_id": status.org_id, "sent_by": sent_by},
    )
    if not created:
        raise ServiceError("already_reminded", "A reminder was already sent today.", status=429)
    org_id, rid = str(status.org_id), str(reminder.id)
    transaction.on_commit(lambda: deliver_reminders_task.delay(org_id, [rid]))
    return reminder


def remind_members(*, org_id, member_ids: list, sent_by) -> dict:
    """Bulk 'nudge' from People: one manual reminder per training that is still due, for
    each person, through send_reminder (same once-a-day rule, same delivery task). Each
    send is its own savepoint, so one failure never hides or undoes the others."""
    due = list(
        MemberStatus.objects.filter(
            org_id=org_id, member_id__in=member_ids, requirement__archived_at__isnull=True
        ).exclude(status__in=[MemberStatus.Status.COMPLIANT, MemberStatus.Status.EXEMPT])
    )
    out = {"sent": 0, "skipped": 0, "failed": 0}
    for status in due:
        try:
            with transaction.atomic():
                send_reminder(status=status, sent_by=sent_by)
            out["sent"] += 1
        except ServiceError:
            out["skipped"] += 1  # already reminded today / nothing due
        except Exception:  # noqa: BLE001 - counted and reported, never shown as sent
            out["failed"] += 1
    out["people_without_due_training"] = len(set(member_ids) - {s.member_id for s in due})
    return out
