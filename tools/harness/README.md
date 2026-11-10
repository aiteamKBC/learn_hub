# E2E harness (test-only, never shipped)

Browser end-to-end checks for each milestone. They drive the real app in a real browser
against a real database. Only Stripe is replaced (`e2e_wsgi.py`, so checkout works without
real payments), and its webhooks are delivered through the real handler (`e2e_stripe.py`).

## One-time setup (the user does this)
1. **A disposable database.** In the Neon console, open project Demo-LMS → Branches →
   *New branch*. Name it `e2e`, with parent `dev` (it copies the seeded demo data).
   E2E runs create users, courses and orders, so they never touch `dev` itself.
2. Create `backend/.env.e2e` with that branch's two connection strings:
   ```
   DATABASE_URL=postgresql://lms_app:...@<e2e pooled host>/lms?sslmode=require
   DATABASE_URL_OWNER=postgresql://lms_owner:...@<e2e direct host>/lms?sslmode=require
   ```
   Everything else comes from `backend/.env`. The file is git-ignored, and Claude Code is
   blocked from reading it.
3. `pip install waitress` in the backend venv (it runs Django on Windows). In
   `tools/harness/`: `npm install`, then `npx playwright install chromium`.
4. To start fresh at any time: in Neon, open the `e2e` branch → *Reset from parent*.

## Run
```powershell
python tools\harness\serve.py                 # Django :8000 (fake Stripe), Celery, vite preview :5173
cd tools\harness
node e2e_m1.js ..\..\shots\m1                 # marketplace
node e2e_m2.js ..\..\shots\m2                 # learning
$env:E2E_DEMO_PASSWORD = "<ask the user>"
node phone_check.js ..\..\shots\phone /learn /account /business
```
In Git Bash, prefix the phone check with `MSYS_NO_PATHCONV=1`, or Bash rewrites `/learn` into a Windows path.

The scripts exit non-zero on any failed step, page error, console error or HTTP 5xx. On a
failure they save a screenshot to `<out>/…FAILED.png`.

To stop: close the Django, Celery and vite processes. On Windows:
`Get-Process python,node | Stop-Process` (this stops every Python and Node process, so
only do it when nothing else is running).

## Files
| File | What |
|---|---|
| `serve.py` | Starts the harness against `backend/.env.e2e` |
| `e2e_wsgi.py` | Django with Stripe's gateway replaced by a local fake |
| `e2e_stripe.py` | Delivers a checkout/subscription webhook through the real handler |
| `e2e_user.py` | Creates a fresh verified learner |
| `e2e_course.py` | Creates a free course with one lecture of every kind (via the real services) |
| `e2e_org.py` | Creates a fresh company (admin, units, job role, 3 learners, 2 company courses, 1 requirement) for M3 |
| `e2e_verify_key.py` | The real allauth email-confirmation key for an address, for the M3 invite flow (see `e2e_wsgi.py`) |
| `e2e_grade.py` | Instructor marks the learner's latest submission (until M4 has the screen) |
| `invite.log` | Written by `e2e_wsgi.py`: `email<TAB>token` for every invite the harness sends, since the real mail backend never logs the token |
| `e2e_m1.js`, `e2e_m2.js` | Milestone scripts; add `e2e_m3.js` etc. in the same style |
| `phone_check.js` | Overflow check on a phone plus light/dark screenshots, for any routes (`E2E_DEMO_ORG` switches company first) |
| `phone_business.js` | `phone_check.js` over every business route as the admin of a fresh `e2e_org.py` company (no demo password) |
| `stop.py` | Stops the harness (processes on :8000/:5173 and the harness Celery worker) so `serve.py` picks up new code |
| `lib.js` | Shared paths, Python runner, e2e database env |
