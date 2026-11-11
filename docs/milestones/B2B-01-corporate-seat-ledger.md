# B2B-01 — Corporate Package Offerings & Seat Ledger

**Goal.** Introduce per-course, per-delivery-type pricing for corporate customers and a seat
inventory ledger that tracks purchased → allocated → revoked/expired lifecycle with full audit.

**Non-negotiable constraints.**
- B2B packages only. Do NOT create tokens, wallets, or subscriptions for B2B.
- Reuse existing `Organization`, `OrgMember`, role system. Do NOT duplicate org models.
- Separate `seat_limit` (membership cap) from per-course seat inventory.
- All corporate tables use `TenantModel` (org_id) with `company_only` RLS.
- Allocation is atomic: `SELECT … FOR UPDATE` to prevent double-spend.
- Seat reassignment requires Platform Admin approval with immutable audit trail (Q05).
- Unallocated recorded seats remain available while the course exists (S10).
- Allocated recorded access is lifetime by default; admin may configure expiry (Q06).
- Company role isolation: only owner/admin may allocate seats.

## Scope

1. **New app:** `backend/apps/corporate/` with schema `corporate`.
2. **Models:** `CorporateOffering` (per-course/delivery pricing), `SeatPurchase` (paid inventory),
   `SeatAllocation` (employee assignment), `AllocationEvent` (audit trail).
3. **Services:** `allocate_seat()`, `release_seat()`, `reassign_seat()` — atomic, audited,
   idempotent where applicable.
4. **Console API:** CRUD offerings, company seat inventory view, allocation detail.
5. **Migrations:** `0001_initial` (schema + tables), `0002_rls` (RLS policies).
6. **RLS:** `company_only` on seat_purchases, seat_allocations, allocation_events.
   `reference` on offerings (everyone reads, staff writes).

## Out of scope
- Stripe checkout / payment (B2B-02)
- Live training requests / cohorts (B2B-03)
- Frontend pages (B2B-06)
- Certificates, refunds, departure policies (B2B-07)

## Acceptance

1. Admin creates offering for Course X (recorded, £50/seat) → visible in console list.
2. Staff creates SeatPurchase(org=CompanyA, quantity=10, status=paid) → 10 available allocations.
3. CompanyA admin allocates seat to employee → status=allocated, Enrollment(source=organization)
   created, AllocationEvent logged.
4. Concurrent allocation of last seat → exactly one succeeds, other gets ServiceError.
5. Over-allocation prevented: allocated_count >= quantity → error.
6. CompanyA cannot see CompanyB's purchases (RLS verified).
7. Release seat → status=revoked, enrollment revoked, event logged.
8. Reassign seat → old revoked, new allocated, requires admin, two events logged.
9. Allocation against unpaid SeatPurchase → rejected.
10. Unallocated recorded seats never auto-expire (S10 verified).

## BLOCKED
None — this milestone has no unresolved policy gates.

## Dependencies
B2B-00 architecture reviewed and approved by owner.
