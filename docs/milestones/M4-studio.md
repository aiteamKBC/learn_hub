# M4 - Instructor studio (`/studio`)

**Goal.** An instructor can do all of these without leaving `/studio`:
- create a course and build its curriculum, using every lecture kind;
- upload videos (Bunny) and lecture files (Azure);
- write quizzes and assignments;
- set the price and coupons;
- submit the course for review;
- run it afterwards: students, Q&A, reviews, marking, announcements, revenue, payouts.

**Already there:**
- the `/studio` layout with the `blueprint` artwork and its nav (`studioNav` in `frontend/src/app/router.tsx`);
- `RequireRole allowed="instructor"`.

Every studio route is a `ComingSoon` placeholder; replace them all.

**Backend:** `backend/apps/catalog/studio.py` (router `/api/v1/studio/`). Every endpoint is untyped today.

**Mockups:** `docs/design/mockups/` 19, 21, 12, 08, 11, 29, 24, 01, 31, 46 and 23 (course certificate settings). Gaps without a mockup are specified in `docs/design/README.md`.

**Demo login:** the seeded instructor `daniel.reeve…` (ask the user for the password, or put it in `E2E_DEMO_*` env vars).

## Work packages
- **P1 API contract.**
  - Type every `/studio/` endpoint (unique schema names prefixed `Studio…`).
  - Add `/api/v1/studio/` to `TYPED_PREFIXES`.
  - Run `/sync-types`.
- **P2 Become an instructor.**
  - Onboarding for a signed-in user (`POST studio/instructor-profile`): headline, bio, website.
  - The pending-approval state.
  - Approved instructors see the "Teach" entry in the user menu.
- **P3 My courses (`/studio/courses`).**
  - List with status (draft / in review / changes requested / published), students, rating, revenue.
  - Create a course (title → slug suggestion).
- **P4 Course builder (`/studio/courses/:id`)**, with tabs Details, Curriculum, Pricing, Coupons, Publish.
  - **Details:** title, subtitle, description (rich text; the server sanitises it), category, level, language, thumbnail URL, what you'll learn / requirements, CPD hours.
  - **Curriculum:**
    - sections and lectures, drag to reorder (`…/order` endpoints), with keyboard reorder too (move up/down buttons);
    - add any of the 7 lecture kinds;
    - edit each one in a side sheet:
      - video: upload to Bunny via `POST studio/media/videos` (tus/direct upload as the endpoint returns), then show processing status by polling `GET studio/media/{id}` until playable, with a preview;
      - article: rich text;
      - external link;
      - live session: date, time, duration, join URL;
      - download, and lecture files on any lecture: Azure upload with progress, rename, delete (`resources/uploads` → PUT → `resources`);
      - quiz: settings plus a question editor for all 7 question kinds, with options, the correct answer(s), matching pairs, blanks, explanation and points;
      - assignment: instructions, scores, submission types, due days, rubric.
    - Preview toggle per lecture.
  - **Pricing:** price tier picker (`studio/price-tiers`, `PUT …/price`) or free.
  - **Coupons:** list, create (code, % or tier, dates, max uses), delete.
  - **Publish:**
    - run the publish checklist;
    - show its problems as a list with "go to" links;
    - "Submit for review" (`versions/{id}/submit`);
    - show the reviewer's notes when changes are requested;
    - "Create new draft" (`courses/{id}/draft`) for a published course: learners keep the live version until the new one is approved.
- **P5 Students (`/studio/students`):** per course (`courses/{id}/students`), with progress, last active and completion.
- **P6 Marking (`/studio/grading`):**
  - a queue of submissions and quiz essays (`studio/grading`);
  - a marking view: the learner's text, link and files (download links), the rubric with scores, overall score, feedback, "return for resubmission";
  - `POST submissions/{id}/grade` and `attempts/{id}/grade`. The learner is notified (backend already does it).
- **P7 Q&A and reviews (`/studio/questions`):**
  - unanswered-first questions across my courses, answering inline (`engagement` answers: the instructor badge shows);
  - reviews, with replies (`engagement/reviews/{id}/reply`);
  - announcements: compose and send to a course's learners (`POST engagement/courses/{id}/announcements`).
- **P8 Money:**
  - `/studio/revenue`: sales and earnings charts, per course and per channel, with living numbers;
  - `/studio/payouts`: payout history; payout account form (`payout-account`).
  - Nothing new for money logic. Revenue shares are client questions; just display what the API returns.
- **P9 Dashboard (`/studio`):** KPIs (students, rating, revenue this month, items to mark, unanswered questions) with links into each area.

## Rules specific to M4
- An instructor sees only their own courses. A learner can never reach `/studio`. Test both.
- Unsaved changes: warn before leaving a sheet with edits.
- Uploads go straight to Bunny or Azure. Never stream them through Django.
- Show errors from the publish checklist exactly as the API words them.
- New artwork:
  - builder: **blueprint** (existing), with a **"storyboard / film strip"** variant for the curriculum (new);
  - money: **"coin stacks / rising bars"** (new).

## Acceptance (`tools/harness/e2e_m4.js`)
1. A new user applies to teach. Approve them in the harness via a small script (until M5's console screen exists).
2. Create a course and fill in the details.
3. Add 2 sections with lectures of every kind: a quiz with 3 question kinds, an assignment with a rubric, a file uploaded to a lecture. Skip the Azure step with a clear skip message if storage CORS isn't configured, and log that.
4. Reorder lectures. The order persists after a reload.
5. Set the price and create a coupon.
6. The publish checklist first shows problems; after fixing them, submit for review. Approve in the harness. The course is live on `/courses`.
7. A learner buys or enrols and submits the assignment. The instructor marks it in `/studio/grading`, and the learner sees the feedback (M2 flow).
8. A learner asks a question; the instructor answers it from the studio. The learner gets a notification.
9. The instructor posts an announcement; the learner sees it in the player.
10. Revenue and payout pages render with the seeded data.
11. Learner blocked from `/studio`. Phone check on every studio route. M1–M3 E2E still pass.
