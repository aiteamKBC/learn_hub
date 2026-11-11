# M12 — Cross-Access Resolver + Preview + Certificate eligibility (X01–X05, C01–C03)

**Goal.** One authoritative access function across all B2C and existing-B2B paths; certificate
eligibility respects source.

## Scope
1. Complete `platform.access.resolve(user, scope, target_id)`:
   order = admin_revoke > enrollment > package > token_spend > subscription > preview > deny.
2. Bulk mode for course outline: one query batched over `target_id IN (…)`.
3. Per-request memoization keyed on `(user_id, course_id)`.
4. Certificate issuance (`backend/apps/learning/certificates.py`) honours
   `Course.certificate_requires_purchase` and surfaces the access reason into
   `certificate.source_reason` for the audit trail.
5. Preview: existing `is_preview` behaviour preserved; resolver returns reason=`preview`.
6. Resolver denies are logged (sampled) to `AccessAuditLog`.
7. Media authorization surfaces (Bunny tokens, Azure SAS) go through the resolver.

## Acceptance
1. A user with BOTH direct enrollment and a token entitlement sees reason=`enrollment` in
   outline; token entitlement is not consumed.
2. Subscription lapse + past token unlock: lecture stays accessible via token_spend.
3. Preview flag on a locked lecture returns reason=`preview`.
4. Course outline request issues exactly one DB round-trip for the resolver block, independent
   of lecture count.

## BLOCKED
- **C03 / S03** — behaviour of `certificate_requires_purchase` default ships behind a flag.

## Dependencies
M9 (base resolver), M10 (package branch), M11 (subscription branch).
