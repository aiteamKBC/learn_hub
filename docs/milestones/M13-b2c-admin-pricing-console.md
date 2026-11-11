# M13 — Admin Pricing Console + Course Editor pricing + Manual wallet adjust + Bonus campaigns (A01–A06)

**Goal.** Staff-only console surfaces to run the whole B2C monetization layer.

## Scope (add under `backend/apps/platform/console/`)
1. `tokens.py` — token pack CRUD, `TokenRate` CRUD (history preserved).
2. `packages.py` — cash package CRUD, course picker, snapshot refresh.
3. `subscription_plans.py` — unlimited plan CRUD, plan version cutover.
4. `wallet_adjust.py` — credit/clawback with required `reason`, audit log row in same
   transaction.
5. `bonus_campaigns.py` — `BonusCampaign` CRUD (BLOCKED funding model F02 — campaigns can be
   drafted but not activated until F02 approved).
6. Reporting extensions handled in M15.

## Routes
- `GET/POST/PATCH/DELETE /api/v1/console/tokens/packs`
- `GET/PUT /api/v1/console/tokens/rate`
- `GET/POST/PATCH /api/v1/console/tokens/campaigns`
- `POST /api/v1/console/wallet/{user_id}/adjust`
- `GET/POST/PATCH /api/v1/console/packages`
- `GET/POST/PATCH /api/v1/console/subscriptions/plans`

All typed with `Console…` schemas (contract test), add prefixes to `TYPED_PREFIXES`, all gated
on `RequireRole allowed="staff"`.

## Acceptance
1. Staff credit of 500 tokens writes exactly one `TokenGrant(source=admin_adjustment, qty=500,
   unit_cost=0)` + one audit log row inside one transaction.
2. Rate change invalidates the `tokens:rate:active` Redis cache; next read returns the new value.
3. Draft bonus campaign cannot be activated while F02 is BLOCKED; UI shows a blocking banner.
4. Non-staff gets 403 on every new console route.

## BLOCKED
- **F02** before campaigns can be activated.

## Dependencies
M7–M12.

---

## PR 1 done (B2C-03 PR 1 / 3) — 2026-11-10

Models, migrations, service and tests landed. API + UI follow in PR 2 / PR 3. See
`docs/milestones/M8-b2c-content-pricing.md` for the file list.

Service signatures for PR 2 (all live in `apps.commerce.pricing_service`):
- Each mutating function takes `actor=...`, `reason=...`, and an optional `request=None`.
  Non-staff actors raise `django.core.exceptions.PermissionDenied`.
- `set_course_price(course, *, price_tier=UNSET, full_course_token_price=UNSET, mode=UNSET, actor, reason, request=None)` — `UNSET` sentinel distinguishes "leave alone" from `None` ("clear").
- `set_lecture_token_price(lecture, amount, *, actor, reason, request=None)`
- `set_material_token_price(material, amount, *, actor, reason, request=None)`
- `set_preview_flag(target, is_free_preview, *, actor, reason, confirm=False, request=None)`
- `distribute_course_token_price(course, total_tokens, *, weights_config=None, actor, reason, dry_run=False, request=None)` — `weights_config` REQUIRED (C05 blocked); Hamilton largest-remainder; deterministic.
- `upsert_token_pack(*, pack_id=None, name, token_amount, price_tier, is_active, sort_order, actor, reason, request=None)`
- `upsert_token_rate(*, tokens_per_gbp_minor, effective_from, actor, reason, notes="", request=None)` — closes prior open rate at the same instant.
- `upsert_topup_policy(*, currency, min_minor, max_minor, is_active, actor, reason, request=None)`
- `upsert_bonus_campaign(*, campaign_id=None, ..., is_active, actor, reason, request=None)` — raises `ConfigurationBlocked("F02 …")` when `is_active=True`.

Exceptions: `ConfigurationBlocked`, `django.core.exceptions.ValidationError`,
`django.core.exceptions.PermissionDenied`.

## PR 2 done (B2C-03 PR 2 / 3) — 2026-11-11

Console Django-Ninja endpoints + endpoint tests + republish wiring. No new models,
no new migrations, no frontend. Mounted alongside the existing cash pricing console
at `/api/v1/console/pricing/token/*` via the same router registration pattern used
by `pricing.py` (module-import side effect in `apps/platform/console/__init__.py`).

### Files
- `backend/apps/platform/console/token_pricing.py` (new) — the whole surface + schemas.
- `backend/apps/platform/console/__init__.py` (edit) — registers the new module.
- `backend/apps/catalog/services.py` (edit) — `create_draft` calls
  `migrate_token_pricing_on_republish(source, draft, actor=by)` after `_copy_content`,
  wrapped in a try/except that logs and continues so republish semantics are unchanged.
- `backend/apps/platform/tests/test_console_token_pricing.py` (new) — 14 tests.

### Endpoints (all gated on `StaffSessionAuth` + `staff(request)`)
- `GET    /api/v1/console/pricing/token/courses?search=&page=&page_size=`
- `GET    /api/v1/console/pricing/token/courses/{course_id}`
- `PATCH  /api/v1/console/pricing/token/courses/{course_id}`
- `POST   /api/v1/console/pricing/token/courses/{course_id}/distribute-tokens`
- `PATCH  /api/v1/console/pricing/token/lectures/{lecture_id}`
- `PATCH  /api/v1/console/pricing/token/materials/{material_id}`
- `POST   /api/v1/console/pricing/token/courses-bulk` (literal segment used in place of `/courses/bulk` so it never collides with the `{course_id}` UUID pattern)
- `GET    /api/v1/console/pricing/token/packs?include_inactive=`
- `POST   /api/v1/console/pricing/token/packs`
- `PATCH  /api/v1/console/pricing/token/packs/{pack_id}`
- `DELETE /api/v1/console/pricing/token/packs/{pack_id}` (soft delete)
- `GET    /api/v1/console/pricing/token/rates`
- `POST   /api/v1/console/pricing/token/rates`
- `GET    /api/v1/console/pricing/token/topup-policies`
- `PUT    /api/v1/console/pricing/token/topup-policies/{currency}`
- `GET    /api/v1/console/pricing/token/bonus-campaigns?include_inactive=`
- `POST   /api/v1/console/pricing/token/bonus-campaigns`
- `PATCH  /api/v1/console/pricing/token/bonus-campaigns/{campaign_id}`
- `GET    /api/v1/console/pricing/token/audit?entity_type=&entity_id=&from_date=&to_date=&page=&page_size=`

### UNSET vs null
PATCH schemas type each optional field as `Any = "__UNSET__"` and rely on pydantic's
`exclude_unset=True` to distinguish three cases: field missing → sentinel → service
sees `UNSET`; field present as `null` → `None`; field with a value → value. The
endpoint collects `payload.dict(exclude_unset=True)` and forwards only the provided
kwargs to `pricing_service.set_course_price`. For `price_tier_id` the UUID is resolved
to a `PriceTier` row first (404 on unknown id).

### Error mapping
Service exceptions are translated to the console's standard `ServiceError` shape:
`PermissionDenied → 403`, `ConfigurationBlocked → 409` with code `C05_BLOCKED` or
`F02_BLOCKED`, Django `ValidationError → 400` with code `VALIDATION` (or
`RATE_EFFECTIVE_FROM_PAST` when the message mentions `effective_from` + `future`).

### Server-authoritative distribution
`POST /distribute-tokens` ignores any per-lecture amounts supplied by the client
(`client_allocation` or similar) and returns only the server-computed Hamilton
allocation from the submitted `weights_config`.

### Republish wiring
`apps/catalog/services.create_draft` now runs
`pricing_service.migrate_token_pricing_on_republish(source, draft, actor=by)` after
`_copy_content`. The call is wrapped in try/except that logs the failure and
continues — republish semantics never change if token-price migration raises.

### Still BLOCKED (for PR 3 and owner awareness)
- **C05** — default auto-distribution weights still require explicit `weights_config`.
- **F02** — bonus campaign activation stays rejected; only drafts can be saved.
