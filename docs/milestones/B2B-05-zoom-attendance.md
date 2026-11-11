# B2B-05 — Zoom + Live Attendance in Neon

**Goal.** Build secured Zoom integration for corporate live sessions with verified webhook
processing, attendee identity matching, and normalized attendance stored in Neon PostgreSQL.

**Non-negotiable constraints.**
- Zoom OAuth with least-privilege scopes. Webhook signature verification mandatory.
- Correlate each Zoom meeting occurrence to exactly one corporate Session/Cohort.
- Match ONLY confidently verified learner identities (email match to enrolled learner).
- Queue unresolved identities for admin review — never infer from display name alone (I02).
- Zoom webhook emails are NOT guaranteed for external accounts.
- Handle event deduplication, reconnections, join/leave aggregation.
- Keep Zoom tokens/PII isolated — never expose to unrelated companies.
- Recorded progress uses existing learning progress, NOT substituted with Zoom minutes.
- Physical In-person attendance is GATE G02 — build extension point only.
- Online-only Zoom attendance does NOT cover In-person/Hybrid physical presence.

## Scope

1. **Models:** `ZoomEvent` (raw webhook store, staff_only), `SessionAttendance` (normalized
   attendance, custom RLS), `AttendanceReview` (admin resolution actions).
2. **Webhook:** `POST /api/v1/webhooks/zoom` — signature verification, event deduplication.
3. **Services:** `backend/apps/corporate/zoom.py` (webhook processing),
   `backend/apps/corporate/attendance.py` (identity matching, normalization, reconnect aggregation).
4. **Company API:** employer sees own employees' attendance.
5. **Learner API:** employee sees own attendance.
6. **Console API:** admin attendance view, unresolved identity resolution.

## Out of scope
- Physical/in-person attendance recording (GATE G02)
- Tutor payroll or compensation
- Modifying Zoom meeting settings (read-only integration)

## Acceptance

1. Valid Zoom `meeting.participant_joined` / `meeting.participant_left` → ZoomEvent stored,
   SessionAttendance record created/updated.
2. Spoofed webhook (invalid signature) → rejected 403.
3. Duplicate event_id replay → idempotent (no duplicate attendance).
4. Attendee with email matching enrolled learner → match_status=verified.
5. Attendee without email or no match → match_status=unresolved, queued for admin.
6. Reconnections (same participant, multiple join/leave) → aggregated duration.
7. CompanyA sees only own employees' attendance in shared cohort (RLS).
8. Missing Zoom API permissions → graceful error with admin notification.
9. Session with no linked Zoom meeting → event stored, not processed.
10. Physical attendance extension point exists but produces no auto-records.

## BLOCKED
- **G02** — In-person/Hybrid physical attendance evidence method: admin/tutor manual,
  QR check-in, etc. Build extension point only.

## Dependencies
B2B-03 approved (cohort and session models exist).
B2B-04 approved (paid reservations link companies to sessions).
