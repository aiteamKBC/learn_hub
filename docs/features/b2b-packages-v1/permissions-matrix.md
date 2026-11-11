# B2B Corporate Packages — Permissions Matrix

**Document:** B2B-00 Architecture Audit
**Status:** Design proposal — awaits owner review

---

## Roles

| Abbr | Role | Auth mechanism | Source |
|------|------|----------------|--------|
| **PA** | Platform Admin | `StaffSessionAuth` + `require_staff(request)` | `console/common.py` |
| **CO** | Company Owner | `session_auth` + `require_org_role(request, OrgRole.OWNER)` | `core/permissions.py` |
| **CA** | Company Admin | `session_auth` + `require_org_role(request, OrgRole.ADMIN)` | `core/permissions.py` |
| **CM** | Company Manager | `session_auth` + `org_scope(request, OrgRole.MANAGER)` | `core/permissions.py` — scoped to managed units |
| **EL** | Employee / Learner | `session_auth` + `OrgMember.role=learner` | `org/models.py` |
| **TU** | Tutor | `session_auth` + new `TutorAssignment` model | Proposed — not OrgMember |
| **AN** | Anonymous | No auth | Public catalog endpoints only |

---

## 1. Corporate Packages

| Action | PA | CO | CA | CM | EL | TU | AN |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| View recorded offerings (catalog) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View live offerings (catalog) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Purchase recorded seats (Stripe) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Request live training | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View own company quotes | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Accept / decline quote | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View seat inventory (own company) | ✅ | ✅ | ✅ | 🔒¹ | ❌ | ❌ | ❌ |
| Allocate seat to employee | ✅ | ✅ | ✅ | 🔒¹ | ❌ | ❌ | ❌ |
| Release unallocated seat | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Reassign allocated seat | ✅ | ⚠️² | ⚠️² | ❌ | ❌ | ❌ | ❌ |

> ¹ Manager sees/allocates only within managed units (`org_scope` unit_paths filter).
> ² Seat reassignment requires Platform Admin approval per Q05. Owner/Admin may initiate request; PA executes.

---

## 2. Live Training

| Action | PA | CO | CA | CM | EL | TU | AN |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| View cohort pool (aggregated demand) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Form cohort from request pool | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Confirm cohort schedule | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Assign tutor to cohort | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View own live bookings | ✅ | ✅ | ✅ | 🔒¹ | ✅ | ❌ | ❌ |
| View cohort schedule — before 1st session ends | ✅ | ✅³ | ✅³ | ❌ | 🔒⁴ | ✅⁵ | ❌ |
| View cohort schedule — after 1st session ends | ✅ | ✅ | ✅ | 🔒¹ | ✅ | ✅⁵ | ❌ |
| Join live session (Zoom link) | ❌ | ❌ | ❌ | ❌ | ✅⁶ | ✅⁵ | ❌ |
| View own attendance | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| View employee attendance (own company) | ✅ | ✅ | ✅ | 🔒¹ | ❌ | ❌ | ❌ |
| View cohort attendance (all companies) | ✅ | ❌ | ❌ | ❌ | ❌ | 🔒⁵ | ❌ |

> ³ Buyer sees sufficient schedule details for payment approval (L04), not necessarily Zoom links.
> ⁴ Employee sees FIRST session only until that session ends (U05/I03).
> ⁵ Tutor scoped to assigned cohorts only. Cross-company learner data is within approved tutor policy (D02 — POLICY GATE G03).
> ⁶ Zoom join URL visible 15 min before session start (existing `learning/api.py` pattern), hidden otherwise.

---

## 3. Employee Data & Reports

| Action | PA | CO | CA | CM | EL | TU | AN |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| View own training progress | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| View own certificates | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| View employee training (own company) | ✅ | ✅ | ✅ | 🔒¹ | ❌ | ❌ | ❌ |
| View company training report | ✅ | ✅ | ✅ | 🔒¹ | ❌ | ❌ | ❌ |
| View cohort learning report | ✅ | ❌ | ❌ | ❌ | ❌ | 🔒⁵ | ❌ |
| Export training data | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View personal B2C courses | ❌⁷ | ❌⁷ | ❌⁷ | ❌⁷ | ✅ | ❌ | ❌ |

> ⁷ Personal B2C enrollment/progress NEVER visible to company roles or PA. Hard isolation per D01.

---

## 4. Finance

| Action | PA | CO | CA | CM | EL | TU | AN |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Initiate Stripe Checkout | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View company invoices | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Request refund / cancellation | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Process / approve refund | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Set per-course pricing | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Create custom quote | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Send Stripe Invoice | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View Stripe billing portal | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 5. Administration

| Action | PA | CO | CA | CM | EL | TU | AN |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| CRUD corporate offerings | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage tutor roster | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approve tutor (internal/external) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Override / reconcile attendance | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Replace allocated seat (Q05) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Modify published schedule (U07) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Cancel / postpone cohort | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Extend enrollment window (L07) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Configure payment deadline (Q07) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Configure recorded access expiry (Q06) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View full audit trail | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## RLS Enforcement Strategy

| Table family | RLS helper | Isolation |
|-------------|-----------|-----------|
| Seat purchases, allocations | `rls.company_only` | Strict org_id isolation |
| Training requests | `rls.company_only` | Company sees only own requests |
| Live cohorts | `rls.staff_only` + custom read | PA manages; participants see own via join |
| Cohort participants | Custom policy | Employee sees own; employer sees company employees; tutor sees assigned cohort |
| Sessions / schedule | Custom policy | Visibility follows U05/I03 first-session rule |
| Attendance records | Custom policy | Learner→own; employer→own employees; tutor→assigned cohort (G03) |
| Quotes / invoices | `rls.company_only` | Company isolation; PA reads all |
| Tutor assignments | `rls.staff_only` + custom read | PA manages; tutor sees own assignments |
| Audit logs | `rls.staff_only` | PA only |

---

## Implementation Notes

1. **P10 enforcement**: Purchase/checkout requires `require_org_role(request, OrgRole.ADMIN)` — both Owner and Admin satisfy this. Manager/learner are rejected.
2. **Manager scoping**: `org_scope(request, OrgRole.MANAGER)` returns `Scope(unit_paths=[...])` — seat inventory and allocation queries must filter by unit path descendant matching.
3. **Tutor is NOT an OrgMember**: Tutors exist outside the company structure. A new `Tutor` model + `TutorAssignment` per-cohort controls access. Tutor data access policy is GATED (G03).
4. **Cross-company cohort isolation**: Multiple companies in one cohort must never see each other's employees. RLS on cohort participant tables filters by org_id. Tutor sees all participants in assigned cohort but NOT company financial data.
5. **Existing endpoint reuse**: Company Owner/Admin endpoints in `org/api.py` already gate by `OrgRole.ADMIN`. New B2B purchase endpoints follow same pattern.
