# B2B-06 — Employer / Learner / Tutor / Admin UI & Reports

**Goal.** Build all frontend React pages and backend reporting endpoints for corporate training
across all roles: company admin, manager, employee, tutor, and platform admin.

**Non-negotiable constraints.**
- Company Owner/Admin: full purchase, allocation, and employee progress visibility.
- Company Manager: scoped to managed org units, no checkout rights.
- Employee: sees own corporate training only. First live session until it ends, then full schedule.
  No insight into pooling/waiting headcount or other companies.
- Tutor: authorized assigned cohorts ONLY, within approved tutor data policy scope. No unrelated
  HR/finance or personal B2C information.
- Platform Admin: full management console for all B2B operations.
- Never expose personal B2C courses in employer view (D01).
- Never expose Company A employees to Company B in shared cohort.

## Scope

1. **Backend:** Reporting selectors in `backend/apps/corporate/reports.py`,
   tutor-scoped endpoints, company dashboard aggregations.
2. **Frontend (Company):** Package purchase flow, seat allocation UI, live training request,
   schedule view, employee progress dashboards, attendance reports, certificate views.
3. **Frontend (Employee):** Corporate training tab, live session schedule (with first-session
   rule), attendance record, certificates.
4. **Frontend (Tutor):** Cohort learner list, attendance reports, learning progress.
5. **Frontend (Admin):** Corporate offerings, requests, cohorts, tutors, quotes, payments,
   reservations, attendance exceptions, audit dashboard.
6. **Console modules:** `corporate_reports.py` (admin reporting endpoints).

## Out of scope
- Skills Radar (explicitly suspended)
- Tutor payroll / compensation
- Automated refund calculation

## Acceptance

1. Company admin sees all employee progress; manager sees only managed units.
2. Employee sees first live session only before it ends; full schedule after.
3. Tutor sees only assigned cohort data.
4. Employee's personal B2C courses never appear in employer view.
5. CompanyA cannot see CompanyB employees in shared cohort.
6. Mixed personal + company learning displays correctly on learner dashboard.
7. Date/time formats use user locale.
8. Admin can view complete audit trail of all B2B operations.
9. Frontend type sync passes (`/sync-types` or equivalent).
10. All pages responsive (mobile-friendly).

## BLOCKED
- **D02 / G03** — Tutor cross-company data scope: proposed safe scope is cohort-specific
  educational/attendance reports only. Broader access requires explicit approval.

## Dependencies
B2B-01 through B2B-05 APIs approved and implemented.
