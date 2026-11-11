# B2B-03 — Live Request Pool, Intakes, Cohorts & Tutor Scheduling

**Goal.** Build the corporate live training lifecycle: company requests interest, admin aggregates
into cohorts, assigns tutors, publishes schedules. No payment at this stage.

**Non-negotiable constraints.**
- Internal interest aggregation is admin-only. Do NOT tell individual learners a class is waiting
  for participants. Company sees "Under Review" / "Scheduling" status only.
- Before first session ENDS: employee sees first session only. After: full schedule visible (U05/I03).
- Company authorized buyer sees sufficient scheduling details BEFORE payment (L04).
- Cross-company cohort allowed for same course only (L01). Companies retain hard org isolation.
- Split one company's seats between cohorts requires company approval (S11).
- No Skills Radar: admin manually reviews level compatibility (L06/L08/G08).
- Tutor internal/external requires Platform Admin approval (U01).
- Only Platform Admin authors and publishes schedules (U03).

## Scope

1. **Models:** `LiveCourseConfig`, `TrainingRequest`, `Intake`, `LiveCohort`, `CohortCompany`,
   `Session`, `Tutor`, `TutorAssignment`.
2. **Services:** `backend/apps/corporate/live.py` (request + cohort lifecycle),
   `backend/apps/corporate/scheduling.py` (session + tutor management).
3. **Console API:** request pool view, cohort CRUD, session scheduling, tutor approval.
4. **Company API:** submit request, view status, view visible sessions.
5. **RLS:** `staff_only` on cohorts/tutors/assignments; `company_only` on requests/cohort_companies;
   custom policy on sessions (staff + enrolled companies + assigned tutor).

## Out of scope
- Payment for live seats (B2B-04)
- Zoom attendance (B2B-05)
- Frontend (B2B-06)
- Live certificates (B2B-07)

## Acceptance

1. Company submits training request → status=submitted, admin sees in request pool.
2. Employee view: status shows "Under Review", NOT "waiting for 3 more people".
3. Admin forms cohort from 2 companies' requests → CohortCompany rows created for each.
4. Cross-company cohort: CompanyA and CompanyB in same cohort; CompanyA sees only own data.
5. Admin cannot auto-split company's seats across cohorts without company consent.
6. Before first session ends: employee query returns only Session #1.
7. After first session ends: employee query returns full schedule.
8. Company buyer sees course + schedule summary before payment step.
9. Tutor approval: pending → approved by admin → can be assigned to cohort.
10. Admin extends enrollment window / offers alternative date for insufficient interest.
11. Cohort min/max learner count enforced at confirmation.
12. Only owner/admin can submit training requests.

## BLOCKED
- **G08** — Level compatibility without Skills Radar: admin decides manually, no automated
  scoring. Milestone proceeds with manual admin decision only.

## Dependencies
B2B-01 approved (corporate app and base models exist).
