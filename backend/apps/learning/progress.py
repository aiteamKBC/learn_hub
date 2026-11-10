"""Video progress heartbeats (performance plan, section 1).

The player sends a heartbeat every 15-30 s. Writing each one to Postgres would mean
a write per viewer every few seconds, so heartbeats go to Redis and a Celery job
flushes them once a minute as ONE batched upsert:

    heartbeat ──> Redis hash hb:<enrollment>:<lecture key>  (+ set hb:dirty)
    flush (every 60 s) ──> INSERT ... ON CONFLICT DO UPDATE  learning.lecture_progress
                       └─> INSERT                            learning.progress_events (monthly partitions)
                       └─> videos past min_watch_pct are marked complete

Without Redis (local development) a heartbeat is written straight through.
Anti-cheat: watched seconds per heartbeat are capped, so skipping to the end does
not count as watching.
"""

import uuid

from django.conf import settings
from django.db import connection
from django.utils import timezone

from core.tenancy import tenant_context

from .models import Enrollment

MAX_WATCHED_PER_BEAT = 70  # seconds: a 30 s heartbeat at 2x speed plus slack
DIRTY_SET = "hb:dirty"
FLUSH_BATCH = 5000


def _redis():
    if not settings.REDIS_URL:
        return None
    from django_redis import get_redis_connection

    return get_redis_connection("default")


def record_heartbeat(
    *, enrollment: Enrollment, lecture_key, position_sec: int, watched_delta_sec: int, ended: bool = False
) -> None:
    """Called by the player endpoint. Validation of ownership happens in the API layer.
    `ended` (the video reached its end): this lecture's buffer is written now, so the
    learner sees the lecture ticked at once instead of after the next flush. The rule
    is unchanged: it completes only if enough was really watched."""
    watched = max(0, min(int(watched_delta_sec), MAX_WATCHED_PER_BEAT))
    position = max(0, int(position_sec))
    member = f"{enrollment.id}:{lecture_key}"
    r = _redis()
    if r is None:  # dev: write through
        _apply_batch([(enrollment.id, uuid.UUID(str(lecture_key)), position, watched)])
        return
    key = f"hb:{member}"
    pipe = r.pipeline()
    if ended:  # take what is buffered for this lecture, add this beat, write it now
        pipe.hgetall(key)
        pipe.delete(key)
        pipe.srem(DIRTY_SET, member)
        data = {k.decode() if isinstance(k, bytes) else k: int(v) for k, v in pipe.execute()[0].items()}
        _apply_batch(
            [(enrollment.id, uuid.UUID(str(lecture_key)), position, data.get("watched", 0) + watched)]
        )
        return
    pipe.hset(key, "pos", position)
    pipe.hincrby(key, "watched", watched)
    pipe.sadd(DIRTY_SET, member)
    pipe.execute()


def is_complete(enrollment: Enrollment, lecture_key) -> bool:
    from .models import LectureProgress

    return LectureProgress.objects.filter(
        enrollment=enrollment, lecture_key=lecture_key, completed_at__isnull=False
    ).exists()


def flush_heartbeats() -> int:
    """Celery job: move buffered heartbeats into Postgres. Returns rows written."""
    r = _redis()
    if r is None:
        return 0
    members = r.spop(DIRTY_SET, FLUSH_BATCH) or []
    batch = []
    for raw in members:
        member = raw.decode() if isinstance(raw, bytes) else raw
        key = f"hb:{member}"
        pipe = r.pipeline()
        pipe.hgetall(key)
        pipe.delete(key)
        data, _ = pipe.execute()
        if not data:
            continue
        data = {k.decode(): int(v) for k, v in data.items()}
        enrol_id, lecture_key = member.split(":")
        batch.append(
            (uuid.UUID(enrol_id), uuid.UUID(lecture_key), data.get("pos", 0), data.get("watched", 0))
        )
    if batch:
        _apply_batch(batch)
    return len(batch)


def _apply_batch(batch: list[tuple]) -> None:
    """One upsert + one event insert for the whole batch. Runs with the staff key:
    this is a system job writing rows whose org/user come from their enrolments."""
    now = timezone.now()
    with tenant_context(staff=True), connection.cursor() as cur:
        values_sql = ", ".join(["(%s::uuid, %s::uuid, %s::int, %s::int)"] * len(batch))
        params = [x for row in batch for x in row]
        cur.execute(
            f"""
            WITH v(enrollment_id, lecture_key, pos, watched) AS (VALUES {values_sql})
            INSERT INTO learning.lecture_progress
                (enrollment_id, lecture_key, last_position_sec, watched_sec, updated_at)
            SELECT enrollment_id, lecture_key, pos, watched, %s FROM v
            ON CONFLICT (enrollment_id, lecture_key) DO UPDATE SET
                last_position_sec = EXCLUDED.last_position_sec,
                watched_sec = learning.lecture_progress.watched_sec + EXCLUDED.watched_sec,
                updated_at = EXCLUDED.updated_at
            """,  # noqa: S608 - only placeholders are interpolated
            [*params, now],
        )
        cur.execute(
            f"""
            WITH v(enrollment_id, lecture_key, pos, watched) AS (VALUES {values_sql})
            INSERT INTO learning.progress_events (enrollment_id, org_id, user_id, course_id, lecture_key, seconds)
            SELECT e.id, e.org_id, e.user_id, e.course_id, v.lecture_key, v.watched
            FROM v JOIN learning.enrollments e ON e.id = v.enrollment_id
            WHERE v.watched > 0
            """,  # noqa: S608
            params,
        )
        cur.execute(
            f"""
            WITH v(enrollment_id, lecture_key, pos, watched) AS (VALUES {values_sql})
            UPDATE learning.enrollments e SET last_accessed_at = %s, last_lecture_key = v.lecture_key
            FROM v WHERE e.id = v.enrollment_id
            """,  # noqa: S608
            [*params, now],
        )
        _complete_watched_videos({row[0] for row in batch})


def _complete_watched_videos(enrollment_ids: set) -> None:
    """Mark videos complete once watched_sec reaches the lecture's min_watch_pct:
    ONE set-based UPDATE for the whole batch, then refresh affected enrolments. The
    length is the lecture's, or Bunny's for the video when the lecture has none (a video
    attached before Bunny finished encoding it)."""
    from .services import refresh_course_progress

    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE learning.lecture_progress p SET completed_at = now(), updated_at = now()
            FROM learning.enrollments e
            JOIN catalog.courses c ON c.id = e.course_id
            JOIN catalog.lectures l ON l.version_id = c.live_version_id
            LEFT JOIN catalog.media_assets a ON a.id = l.video_id
            CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(l.duration_sec, 0), a.duration_sec, 0) AS sec) d
            WHERE p.enrollment_id = e.id
              AND p.enrollment_id = ANY(%s::uuid[])
              AND p.completed_at IS NULL
              AND l.lecture_key = p.lecture_key
              AND l.kind = 'video' AND d.sec > 0
              AND p.watched_sec * 100 >= d.sec * l.min_watch_pct
            RETURNING p.enrollment_id
            """,
            [list(enrollment_ids)],
        )
        touched = {row[0] for row in cur.fetchall()}
    for enrollment in Enrollment.objects.filter(pk__in=touched).select_related("course"):
        refresh_course_progress(enrollment)
