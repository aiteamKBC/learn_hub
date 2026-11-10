---
description: Build a milestone from its brief in docs/milestones, verify it and record it
argument-hint: <milestone id, e.g. M3>
---
Build milestone **$ARGUMENTS** of the LearnHub LMS.

1. Read these: `CLAUDE.md`, `docs/build-status.md`, the brief `docs/milestones/$ARGUMENTS-*.md`, `docs/STRUCTURE.md` and `frontend/README.md`.
   - Open the screen mockups listed for this milestone in `docs/design/README.md` (images in `docs/design/mockups/`), and read the "intentional differences" and the specs for screens without a mockup.
   - If anything in the brief conflicts with CLAUDE.md, or needs a business decision, ask before building.
2. Make a task list from the brief's work packages and acceptance list.
3. Backend first, for each package:
   - write the endpoint/service changes with tests;
   - type every response and add the prefixes to the contract test (use the `api-contract` agent);
   - run the backend tests for that app.
   You may give independent packages (e.g. backend of one area, frontend of another) to parallel sub-agents. Always merge and re-test yourself.
4. Regenerate the types (`/sync-types`), then build the screens, following every frontend rule in CLAUDE.md:
   - artwork;
   - motion;
   - light/dark;
   - phone;
   - loading, empty and error states.
5. Run `/verify`. Use the `e2e-tester` agent for the milestone's E2E script and screenshots. Fix what fails.
6. Run the `reviewer` agent on the whole change. Fix its findings, or explain why not, in build-status.
7. Run `/status` to record the milestone. Then give the user a short summary:
   - what was built;
   - what was verified;
   - anything they must do: migrations to run, keys, settings, decisions.

Don't stop halfway to ask for permission on routine steps. Do stop for anything the rules reserve for the user:
- data-changing migrations on Neon;
- new dependencies;
- business decisions;
- anything touching secrets.
