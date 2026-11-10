# Current goal: finish the frontend (M3 to M6)

Claude Code works through this list **in order, without stopping**, until every box is
ticked. A Stop hook (`.claude/hooks/goal_gate.py`) sends you back to work while boxes remain.

**Branch:** work on `frontend-m3-m6` (create it from `main` if missing).
- One commit (or more) per milestone, with messages like `M3 business: …`.
- Push the branch after each milestone.
- Never merge to `main`; the user merges after the planner's review.

**Before each milestone:**
1. Re-read `CLAUDE.md`, `docs/build-status.md` and the milestone's brief.
2. If a `docs/milestones/<id>-review.md` exists from the planner and isn't marked "Applied", apply it first, `/verify`, then mark it "Applied: <date>" at the top.

**Ticking a box:** only when the milestone meets the full Definition of done in `CLAUDE.md`:
- tests, lint, type check and build pass;
- its E2E script passes;
- every earlier E2E script still passes;
- the phone check passes;
- `reviewer` findings are fixed;
- `/status` has been done;
- the work is committed and pushed.

**When you truly need the user** (a business decision, a password, a migration that changes existing data on Neon, a new dependency, anything the rules reserve for them):
1. Write the question(s) to `docs/NEEDS-USER.md`: short, numbered, each with your recommended answer.
2. Carry on with any part that doesn't depend on the answer.
3. Stop only when nothing else can be done.

The user deletes `NEEDS-USER.md` once they've answered.

**Context:** auto-compaction runs at 40% of the context. After a compaction you're reminded of this file. Keep notes that matter in `docs/build-status.md`, not only in the conversation.

## Checklist
- [x] M3 business workspace (`docs/milestones/M3-business.md`)
- [x] M4 instructor studio (`docs/milestones/M4-studio.md`): built and pushed. **User decision (2026-11-07):** its E2E script, phone check and reviewer pass move to the final regression below.
- [ ] M5 admin console (`docs/milestones/M5-console.md`)
- [ ] M6 polish, performance and demo readiness (`docs/milestones/M6-polish.md`)
- [ ] Final regression. **All browser testing is done here, after M6** (user decision, 2026-11-07); while building M5 and M6, write backend tests and run the targeted ones only:
  - full backend suite (find the two unidentified errors from the stopped 2026-11-07 run);
  - the E2E scripts for M4, M5 and M6 (written now, not earlier);
  - every E2E script (M1-M6 + demo);
  - the phone check on every route in light and dark;
  - `reviewer` over the whole branch.
  All green, recorded in build-status, pushed.
## Running unattended
- Nobody is there to approve prompts. Don't run `migrate`, installs or merges. Instead, put the need
  (e.g. "migration X must be applied to dev and e2e") in docs/NEEDS-USER.md and carry on with
  everything that doesn't depend on it.
- The planner may answer your questions in docs/ANSWERS.md. Read it whenever it changes.