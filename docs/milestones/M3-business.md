# M3 - Business workspace (company admins and managers)

**Goal.** A company admin can run their whole training programme from `/business`:
- see who is compliant;
- set requirements;
- manage people, teams and invitations;
- assign courses;
- handle exceptions;
- export reports;
- manage billing and branding.

A manager sees the same screens, limited to their own units.

**Already done:**
- `/business` overview (`ComplianceDashboard`);
- the workspace layout with the `contours` artwork;
- the workspace switcher;
- the real notification bell.

Every other `/business/*` route is a `ComingSoon` placeholder in `frontend/src/app/router.tsx`. Replace them all.

**Mockups:** there are none for the business area. Build from the specs in `docs/design/README.md` ("Screens with NO mockup → M3"), and use the closest mockups it names (26, 05, 33, 02, 18, 06 in `docs/design/mockups/`).

**Demo login (Neon seed):** `hana.cole@brightwater.example.com` (company admin of Brightwater Care Group). Get the password from the user; it's not in the repo.

---

## Work packages

### P1. API contract for org + compliance (do first)
- Several org/compliance endpoints return untyped bodies (`-` in the OpenAPI listing):
  - unit/role/person PATCH and DELETE;
  - invite revoke;
  - invitation lookup/accept;
  - assign;
  - assignments;
  - compliance person;
  - extend/exempt/record/void/remind;
  - branding.
- Give each one a typed response (`OkOut` from `apps.identity.schemas` where nothing else is returned).
- Add `/api/v1/org/` and `/api/v1/compliance/` to `TYPED_PREFIXES`. CSV export is the only exception: add it to `NOT_JSON`.
- Then run `/sync-types`.

### P2. Training matrix - `/business/matrix`
- `GET compliance/matrix`: people (rows) × requirements (columns). Each cell shows the status colour and label from `STATUS` in `features/compliance/api.ts`.
- Filters:
  - unit (tree select from `org/units`);
  - job role;
  - status;
  - requirement;
  - search.
  Keep them in the URL search params. Use keyset "load more".
- Sticky first column and header. Horizontal scroll inside the table only, never the page.
- Clicking a cell opens a side sheet (`DialogContent side="right"`) for that person + requirement. It shows the dates and history from `compliance/people/{member_id}`, and these actions:
  - **Extend** due date;
  - **Exempt** (reason, optional end) and revoke an exemption;
  - **Record completion** (date, note; evidence upload can come later);
  - **Void** a record (reason);
  - **Send reminder** (managers: once per period; the API enforces it, so show its message).
  The matrix updates after each action without a reload.
- Phone: becomes a list of people with their worst status and a details sheet.

### P3. Requirements - `/business/requirements`
- List with compliance % ring, total, overdue and course.
- Create/edit in a sheet:
  - course (from `org/library`);
  - name, description;
  - due days;
  - renewal months (or "never");
  - expiring-soon days;
  - reminder days (chips);
  - overdue reminder interval;
  - **targets** (whole company / units / job roles; `TargetIn`).
- Archive with a confirmation.

### P4. People - `/business/people`
- Searchable, filterable list (`org/people`) with compliance counts per person, and keyset pagination.
- Person page or sheet:
  - role (admin/manager/learner; only admins change roles);
  - job title, employee ref;
  - units, job roles;
  - their requirements (reuse the P2 sheet actions);
  - remove from the company (with a confirmation).

### P5. Locations & teams - `/business/units`
- Unit tree (`org/units`): create child, rename, change code, archive.
- Assign managers (`PUT units/{id}/managers`) from the people list.
- Job roles: list, create, rename, archive.

### P6. Invitations - `/business/invites` and public `/invite/:token`
- Invite by email: role, optional unit and job role. Single or bulk (paste many emails).
- List pending invites with expiry. Revoke.
- `/invite/:token`: a public page that shows which company invited you (`GET org/invitations/{token}`). Then:
  - sign in or sign up;
  - `POST accept`;
  - land in the company workspace (switch `X-Org-Id`) with a welcome toast.
  Cover the cases: expired, already accepted, wrong account.

### P7. Course library + assign - `/business/library`, `/business/assign`
- Library (`org/library`, `source` filter): cards with assigned/completed counts.
- Assign flow:
  1. Pick a course.
  2. Pick people and/or whole units (sub-units included).
  3. Confirm with a count of who will receive it (`POST org/assign`).
- The people who receive it get the existing `course_assigned` notification.
- Per-course progress: `GET org/assignments?course_id=`.

### P8. Reports - `/business/reports`
- Compliance by requirement and by unit: charts using the existing chart styles, living numbers.
- CSV export (`compliance/export.csv`, unit filter). Use `downloadExport()`, which already sends `X-Org-Id`.
- Company audit trail (`org/audit`, action filter, keyset).

### P9. Billing - `/business/billing`
- The company subscription (`commerce/subscriptions` with the company `X-Org-Id`):
  - plan, seats used/limit (`org/company`), renewal date, status;
  - billing portal button;
  - "buy seats" through the existing team-plan subscribe flow (minimum 5 seats).
- No new payment logic. Reuse M1's flow and the thank-you page.

### P10. Settings - `/business/settings`
- Company name (read-only unless an endpoint exists), logo URL, primary/accent colours (`PUT org/company/branding`) with a live preview of the workspace header, and data-retention info.
- Branding colours should tint the workspace header/sidebar accent at runtime. They must not replace the design tokens, and contrast must stay readable.

---

## Rules specific to M3
- **Roles:**
  - admins see everything;
  - managers see only their units (the API already scopes them; the UI must not offer admin-only actions to managers);
  - learners must never reach `/business` (`RequireManager` already guards it).
  Test all three.
- Every list has loading, empty and error states, plus keyset "load more".
- Each new area gets artwork:
  - matrix: contours (existing);
  - people: **constellation-like "org chart"** (new);
  - units: **map pins / floor plan** (new);
  - reports: **chart grid** (new);
  - billing: ribbons (existing);
  - settings: dials (existing);
  - invite page: aurora (existing).
  Keep the shapes on the right.
- No business decisions in code. Example: whether managers can exempt people is decided by the API. If the UI needs a policy the API doesn't have, ask, and log it in `docs/client-questions.md`.

## Acceptance (the E2E script `tools/harness/e2e_m3.js` must cover)
1. Admin signs in → overview → matrix: filters by unit and status (and the URL updates), opens a cell, extends the due date, and the cell updates.
2. Exempt and revoke; record a completion; void it (with reasons).
3. Create a requirement targeting one unit → it appears in the matrix for those people only.
4. Invite a new email → open `/invite/:token` in a fresh browser → sign up → accept → land in the workspace as a learner → `/learn/required` shows the company's required training.
5. Assign a course to a unit → the member gets the notification and the course appears in My learning.
6. Create a unit, add a manager → sign in as that manager → the manager sees only that unit's people and no admin-only buttons.
7. Reports: the CSV download works (check the header row); the audit trail lists the actions above.
8. Billing shows seats; settings saves branding and the header shows it.
9. A learner without a role gets redirected away from `/business`.
10. Phone: the matrix list view and a person sheet work. No horizontal scroll on any `/business` route.
11. M1 and M2 E2E still pass.
