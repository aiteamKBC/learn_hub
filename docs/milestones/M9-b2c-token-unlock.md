# M9 — Token Unlock + Entitlement Model (T05, T06, T10, X01, X03)

**Goal.** Let learners spend tokens to unlock lectures/materials, writing a durable entitlement
that survives price changes.

## Scope
1. New `platform.ContentEntitlement` model (owner_user, scope, target_id, source, source_ref,
   granted_at, expires_at nullable, revoked_at nullable, is_revocable).
2. `backend/apps/platform/access.py` (new) — `resolve(user, scope, target_id) -> AccessDecision`.
   M9 implements branches: admin_revoke, direct_enrollment, token_spend, preview, deny. Package
   and subscription branches land in M10/M11/M12.
3. `backend/apps/learning/services.py::_check_unlocked` delegates to `platform.access.resolve`.
4. `POST /api/v1/learning/unlock` `{scope, target_id}` — atomic spend + entitlement write.
5. `GET /api/v1/learning/access/{course_id}` — bulk resolver for the course outline.
6. Media authorization (`backend/apps/catalog/media.py`, `backend/apps/learning/uploads.py`)
   gated on the resolver.
7. Tests: concurrency on `spend_atomic`, resolver branch coverage, lecture/material unlock,
   entitlement persistence through price change.

## Acceptance
1. Unlocking a lecture decrements the wallet by exactly its token price and writes one
   `ContentEntitlement`.
2. Changing the lecture's token price afterwards leaves access intact.
3. Course outline fetch returns a per-lecture reason code (`enrollment`, `token_spend`,
   `preview`, `deny`).
4. Signed media URLs refuse to issue for a locked lecture.

## BLOCKED
None for internal shipping. P06/T11 (refund interaction) only affects the revoke path which is
admin-only until M13.

## Dependencies
M7 (wallet), M8 (pricing).

## Done — B2C-01 (Unified Content Access Engine) landed 2026-11-10
The additive foundation described in sections 1–3, 6 and 7 is now in the tree.
Wallet spending (section 4) and the `POST /learning/unlock` endpoint are deferred to
M-wallet, which this milestone now unblocks.

**Files added**
- `backend/apps/platform/access.py` — `AccessDecision` dataclass + `resolve()` with the
  7-branch precedence from `architecture.md §1`.
- `backend/apps/platform/migrations/0004_accessauditlog_contententitlement.py` — new tables.
- `backend/apps/platform/migrations/0005_b2c_access_engine_rls_and_backfill.py` — RLS
  policies for both tables (via `core.rls.enable_user_rls_sql` + a tailored AUDIT_LOG_RLS
  that lets the resolver write the current user's own audit rows) and the idempotent
  `legacy_purchase` backfill.
- `backend/apps/platform/tests/test_access_resolver.py` — 15 test cases covering
  precedence, grandfathering, B2B isolation and RLS.

**Files modified**
- `backend/apps/platform/models.py` — added `ContentEntitlement`, `AccessAuditLog`.
- `backend/core/rls.py` — added `enable_user_rls_sql()` helper.
- `backend/apps/learning/api.py::_check_unlocked` — delegates to the resolver for
  personal (org_id IS NULL) enrolments; B2B assignments bypass the B2C resolver.

**Deferred**
- Course-outline bulk fast path and per-request memoization (M12 §2–3).
- Resolver gating on Bunny signed URLs / Azure SAS / live-join tokens (M12 §7).
- Async queue for `AccessAuditLog` writes (TODOs in `access.py` and models docstrings).
- Certificate `source_reason` and `certificate_requires_purchase` (M12 §4, BLOCKED on C03).

