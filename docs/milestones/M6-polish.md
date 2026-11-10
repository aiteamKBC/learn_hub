# M6 - Polish, performance and demo readiness

**Goal.** The demo feels finished and fast. Nobody should be able to find a broken corner in a 30-minute client walkthrough.

## Work packages
- **P1 Leftover placeholders.** No `ComingSoon` remains anywhere. Every header/footer link goes to a real page, or is removed:
  - footer: Help centre, Privacy, Book a demo, Teach on LearnHub;
  - also check the `/design` page and the 404 page.
- **P2 Performance:**
  - main entry chunk below **300 KB minified**: split vendor chunks (React, Radix, React Query) sensibly; lazy-load heavy widgets; check that no icon set or chart lib lands in the entry;
  - check Lighthouse (performance, accessibility, best practices) on home, catalogue, course, player and business overview. Target ≥ 90 for accessibility and best practices; fix the biggest performance items;
  - images: `loading="lazy"`, sizes, and a fallback for missing thumbnails;
  - API: run `core/tests/test_query_budgets.py`, and add budgets for the M3–M5 lists that are missing.
- **P3 Accessibility pass:**
  - keyboard through every flow (catalogue → buy → player → quiz; business matrix; studio builder);
  - focus visible;
  - dialogs trap focus;
  - announcements via `aria-live` for toasts;
  - colour contrast in both themes.
- **P4 Consistency pass:**
  - titles (`document.title`) on every route;
  - empty, error and loading states everywhere;
  - date and money formats;
  - British English;
  - no developer wording in the UI.
- **P4b Mockup gaps worth closing:**
  - instant search suggestions in the catalogue (37);
  - "Upcoming assignments" and "My certificates" panels on My learning (42).
  Add small additive APIs if needed.
- **P5 Artwork and motion audit:** every route has its artwork (list the route → variant in `frontend/README.md`), shapes clear of text in both themes; motion is consistent and reduced motion is respected.
- **P6 Demo script:** write `docs/demo-script.md`, a 20–30 minute click path for the client meeting covering each persona: visitor, learner, company admin/manager, instructor, staff. Include the logins (as "ask Zeeka" placeholders, never the passwords) and what to say at each step. Add `tools/harness/e2e_demo.js`, which runs that exact path.
- **P7 Deployment readiness (prepare, don't deploy):**
  - production settings check (`python manage.py check --deploy`);
  - write the deployment checklist in `docs/deploy.md`: env vars by name, migrate + seed, Stripe/Bunny webhook URLs, Azure CORS, Microsoft/Google sign-in redirect URIs, Redis/Celery, static files, domain.
  - The user decides the hosting; it's a client question.

## Acceptance
- Every E2E script (M1–M6, demo) passes.
- The phone check passes on every route in the router (generate the list from `router.tsx`, including dynamic routes with seeded ids).
- The main chunk is under target, and the Lighthouse scores are recorded in build-status.
- `reviewer` has been run over the whole frontend (not only the diff), with its findings fixed.
