# B2B Corporate Packages — Policy Gates Register

**Date:** 2026-11-11
**Purpose:** Every gate blocks specific implementation. Owner must resolve before that code ships.
**Convention:** Gates G01–G09 from Section C of the master plan. G10+ discovered during code audit.

---

## G01 — Live Certificate Criteria

**Question:** What earns a live-training certificate? Attendance threshold (e.g. 80%), tutor sign-off, graded assessment, or a combination?

| Dimension | Detail |
|-----------|--------|
| **Blocked code** | `Certificate` issuance logic for live enrollments. Currently `complete_course()` in `apps/learning/services.py` auto-issues on 100% required-lecture completion — this works for recorded but has no attendance-threshold equivalent for live. |
| **Blocked milestone** | B2B-07 (Certificates) |
| **Proposed options** | A) Attendance % threshold (admin-configurable per cohort). B) Tutor manual approval per learner. C) Attendance threshold AND tutor approval. D) Attendance + graded assessment pass. |
| **Interim safe behavior** | Do NOT auto-issue live certificates. Build `LiveCohort.certificate_policy` field (enum: pending_approval) and `CohortCompletion` model that records attendance stats, but gate issuance behind admin/tutor manual trigger until policy is approved. |
| **Impact if unresolved** | Learners who complete live training receive no certificate. Not a data-loss risk, but a feature gap. |

---

## G02 — In-person / Hybrid Physical Attendance Evidence

**Question:** How is physical presence verified for non-Zoom attendance? Options: admin/tutor manual entry, QR check-in, NFC tap, third-party integration.

| Dimension | Detail |
|-----------|--------|
| **Blocked code** | Physical attendance recording in `SessionAttendance`. Zoom webhooks only capture online participants. |
| **Blocked milestone** | B2B-05 (partially — Zoom online attendance can proceed; physical is blocked) |
| **Proposed options** | A) Admin/tutor manual attendance entry via console UI. B) QR code displayed at venue, learner scans with phone. C) Integration with on-site access system. D) Combination: manual default + optional QR. |
| **Interim safe behavior** | Build `SessionAttendance.source` enum with values `zoom`, `manual`, `qr`, `integration`. Implement `zoom` and `manual` sources. For in-person/hybrid sessions, admin manually marks attendance. Extension point ready for QR/integration later. |
| **Impact if unresolved** | In-person sessions require manual attendance entry. Not blocked — just less automated. Recommend approving Option D (manual + QR ready). |

---

## G03 — Scope of Tutor Cross-Company Data

**Question:** What data does a tutor see across companies in a shared cohort? Full learning records, attendance only, or something broader?

| Dimension | Detail |
|-----------|--------|
| **Blocked code** | Tutor API endpoints and RLS policies for `CohortTutor` data access. |
| **Blocked milestone** | B2B-06 (Tutor UI & Reports) |
| **Proposed options** | A) **Safe scope (recommended):** Cohort-specific learning progress, attendance, quiz/assignment results, completion status for all learners in assigned cohorts. No HR data, no financial data, no personal B2C courses, no other cohorts. B) Broader: Include company name and employee_ref for identification. C) Minimal: Attendance and completion only, no quiz/assignment details. |
| **Interim safe behavior** | Implement Option A as default. Tutor sees: learner name, email, company name (for identification in cross-company cohort), attendance, progress, quiz scores, assignment grades — scoped to assigned cohort only. No financial, HR, or B2C data. Admin can override per-tutor if needed. |
| **Impact if unresolved** | Tutor reporting delayed. Cohort management can still proceed admin-only. |

---

## G04 — Live Cancellation / Refund Details

**Question:** What are the refund rules for cancelled/postponed live cohorts? Partial attendance credit, cutoff dates, admin fee, pro-rata?

| Dimension | Detail |
|-----------|--------|
| **Blocked code** | Automated refund amount calculation. `gateway.refund()` exists (`apps/commerce/gateway.py`) but requires explicit amount. |
| **Blocked milestone** | B2B-07 (Cancellations) |
| **Proposed options** | A) Full refund if cancellation before first session. B) Pro-rata based on sessions remaining. C) Admin decides amount case-by-case (no formula). D) Configurable policy per cohort (full/pro-rata/none + admin override). |
| **Interim safe behavior** | Admin-only manual refund: staff enters amount in console, system calls `gateway.refund()`. No automated calculation. All refunds audited. Legal-minimum protections (e.g. Consumer Rights Act cooling-off) must be respected regardless — flag in admin UI. |
| **Impact if unresolved** | Refund requests require full manual processing. Acceptable for launch; not scalable long-term. |

---

## G05 — Course Deletion/Archiving with Unallocated Prepaid Seats

**Question:** What happens to prepaid unallocated seats when a course is delisted, archived, or deleted?

| Dimension | Detail |
|-----------|--------|
| **Blocked code** | Course archival/deletion hooks for `PurchasedSeatInventory`. Currently `Course.status` can move to `archived` but no commerce cascade exists. |
| **Blocked milestone** | B2B-01 (partially — seat model can be built; deletion policy deferred) |
| **Proposed options** | A) Freeze seats — company retains credit, admin arranges alternative or refund manually. B) Auto-refund unallocated seats. C) Convert to platform credit. D) Admin case-by-case. |
| **Interim safe behavior** | Prevent archiving/deleting a course that has unallocated purchased seats (raise `ServiceError`). Admin must first refund or reassign before archiving. Preserve all purchase/allocation history regardless. |
| **Impact if unresolved** | Courses with unallocated B2B seats cannot be archived. Minor operational friction. |

---

## G06 — Allocated Access Expiry vs Unallocated Inventory Lifetime

**Question:** Are these two separate clocks? Unallocated seats live forever (S10), but allocated access can expire (Q06)?

| Dimension | Detail |
|-----------|--------|
| **Blocked code** | Expiry logic on `SeatAllocation` vs `PurchasedSeatInventory`. |
| **Blocked milestone** | B2B-01 (partially — can build both fields; enforcement policy needed) |
| **Proposed options** | A) **Two separate clocks (recommended):** Inventory never expires while course exists. Allocated learner access defaults to lifetime, admin can set per-offering expiry (e.g. 12 months from allocation). B) Single clock: both expire together. C) Inventory expires after N months if unallocated. |
| **Interim safe behavior** | Implement Option A as default. `PurchasedSeatInventory` has no expiry. `SeatAllocation` → `Enrollment.access_expires_at` set from `CorporateOffering.access_expiry_days` if configured, else NULL (lifetime). Clear UI labeling that these are separate. |
| **Impact if unresolved** | Both clocks implemented but admin may be confused about which applies. Need clear documentation. |

---

## G07 — Employer Departure Policy

**Question:** When an employee leaves a company, what happens to their corporate training access, progress, and certificates?

| Dimension | Detail |
|-----------|--------|
| **Blocked code** | `OrgMember.removed_at` soft-delete handler for learning access. Currently `removed_at` is set but no cascade to enrollments/seats. |
| **Blocked milestone** | B2B-07 (Company Departure Policies) |
| **Proposed options** | A) Revoke access immediately; preserve completion/certificate history. B) Grace period (N days) then revoke. C) Configurable per company (admin sets policy). D) Recorded: keep access. Live: revoke remaining sessions. |
| **Interim safe behavior** | On member removal: set `SeatAllocation.status = "revoked"`. Do NOT delete enrollment or certificate. `Enrollment.status` set to `revoked` (access blocked). Certificate remains valid (already issued = earned). Seat returns to inventory for reassignment. Historical progress preserved in `ProgressEvent` (append-only). |
| **Impact if unresolved** | Seat is freed on departure but exact access transition is unclear. Certificates preserved is the safe default. |

---

## G08 — Level Compatibility Without Skills Radar

**Question:** How does admin decide learner level grouping for shared cohorts without automated assessment?

| Dimension | Detail |
|-----------|--------|
| **Blocked code** | None — this is a process decision, not a code gate. |
| **Blocked milestone** | None blocked. |
| **Proposed options** | A) Admin reviews company-stated level + course level and groups manually. B) Admin can request informal self-assessment from company (out-of-band). C) All levels welcome; tutor adapts. |
| **Interim safe behavior** | Display `Course.level` in cohort formation UI. Admin decides. No automated scoring or placement. Log admin's grouping decision in audit trail. |
| **Impact if unresolved** | No impact on code. Admin makes judgment calls. |

---

## G09 — Recorded Certificate Existing Rules

**Question:** Should B2B recorded certificates follow the same rules as B2C (auto-issue on 100% required lecture completion)?

| Dimension | Detail |
|-----------|--------|
| **Verified** | `complete_course()` in `apps/learning/services.py` auto-issues when all required lectures are completed. Works for both personal and org enrollments (Certificate is MixedTenantModel). |
| **Proposed options** | A) **Same rules as B2C (recommended):** 100% required lectures → auto-issue. B) Company can configure custom completion criteria. C) Tutor/admin must approve. |
| **Interim safe behavior** | Reuse existing certificate flow. Org enrollment hits 100% required lectures → `complete_course()` → `issue_certificate()`. No change needed. |
| **Impact if unresolved** | None if Option A accepted. Certificate flow already works for org enrollments. |

---

## Discovered Gates (from code audit)

### G10 — Stripe Invoicing API Implementation Choice

**Question:** Which Stripe API pattern for B2B invoices? Stripe Checkout with auto-invoice (current) vs Stripe Invoicing API (create → finalize → send → collect)?

| Dimension | Detail |
|-----------|--------|
| **Context** | Current gateway (`apps/commerce/gateway.py`) only creates Checkout Sessions with `invoice_creation: {enabled: True}`. P11 requires Stripe Invoicing (admin creates invoice, sends to company, company pays via hosted link). |
| **Proposed options** | A) **Both (recommended):** Keep Checkout for instant recorded purchases. Add Invoicing API for live cohort payments and custom quotes (admin-initiated, NET-30 terms). B) Invoicing only for all B2B. C) Checkout only with auto-invoice. |
| **Impact** | B2B-02 and B2B-04 need this decision. Gateway extension is ~100 lines. |
| **Interim safe behavior** | Start with Stripe Checkout for recorded. Add Invoicing API in B2B-02 for the invoice path. Both paths use the same webhook fulfillment (idempotent via `StripeEvent`). |

### G11 — Cross-Company Cohort RLS Pattern

**Question:** How to implement RLS for tables shared across companies (e.g. `LiveCohort` has learners from org A and org B)?

| Dimension | Detail |
|-----------|--------|
| **Context** | `core.rls.company_only` restricts to single org_id. A shared cohort needs multiple orgs to access the same cohort row while seeing only their own employees within it. |
| **Proposed options** | A) **Cohort tables are staff_only; APIs project org-filtered views (recommended).** LiveCohort, Session, CohortTutor are admin-managed. Company-facing APIs join through `CohortCompanyParticipation` (company_only RLS) to filter what each org sees. B) Custom RLS policy with subquery. C) Separate read views per org. |
| **Impact** | B2B-03 model design. Option A is simplest and aligns with "admin coordinates" principle. |

### G12 — Zoom OAuth Scope and App Type

**Question:** Server-to-Server OAuth app (no user consent) or User-managed OAuth app? Which scopes are needed?

| Dimension | Detail |
|-----------|--------|
| **Context** | No Zoom code exists. Need to choose: Server-to-Server app (platform owns meetings) vs User-managed (tutor authorizes their Zoom account). |
| **Proposed options** | A) **Server-to-Server (recommended):** Platform creates meetings on a designated Zoom account. Simpler, no per-tutor OAuth. B) User-managed: Each tutor connects their Zoom. More complex but tutors use their own accounts. |
| **Impact** | B2B-05 architecture. Determines webhook setup and meeting ownership. |

### G13 — Seat Allocation Creates Enrollment Immediately or On-Demand

**Question:** When a seat is allocated to an employee, is enrollment created immediately or when the learner first accesses the course?

| Dimension | Detail |
|-----------|--------|
| **Context** | Current `assign_to_members()` (`apps/learning/services.py`) creates `Enrollment` immediately with `source="organization"`. S09 says seat is "used" on assignment, not on first play. |
| **Proposed options** | A) **Immediate enrollment on allocation (recommended):** Matches existing pattern and S09 decision. Learner sees course in their dashboard immediately. B) Lazy enrollment on first access. |
| **Impact** | B2B-01 seat allocation design. Option A is simplest and consistent with existing code. |

---

## Gate Resolution Summary

| Gate | Blocks | Severity | Recommended Default |
|------|--------|----------|-------------------|
| G01 | B2B-07 | Medium | No auto-issue; manual trigger |
| G02 | B2B-05 (physical only) | Low | Manual + extension point |
| G03 | B2B-06 (tutor UI) | Medium | Safe cohort-scoped data |
| G04 | B2B-07 | Medium | Admin manual refund |
| G05 | B2B-01 (deletion) | Low | Block archival if unallocated seats |
| G06 | B2B-01 (expiry) | Low | Two separate clocks |
| G07 | B2B-07 | High | Revoke access, preserve history |
| G08 | None | None | Admin manual grouping |
| G09 | None | None | Reuse B2C rules |
| G10 | B2B-02, B2B-04 | High | Both Checkout + Invoicing |
| G11 | B2B-03 | High | staff_only + org-filtered views |
| G12 | B2B-05 | High | Server-to-Server OAuth |
| G13 | B2B-01 | Medium | Immediate enrollment on allocation |

### Critical Path

**Must resolve before B2B-01:** G06, G13 (seat model design depends on these)
**Must resolve before B2B-02:** G10 (Stripe Invoicing approach)
**Must resolve before B2B-03:** G11 (cross-company RLS)
**Must resolve before B2B-05:** G02, G12 (attendance + Zoom)
**Must resolve before B2B-07:** G01, G04, G07 (certificates, refunds, departures)

All other gates have safe interim defaults that allow implementation to proceed.
