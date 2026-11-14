# LearnHub LMS: instructions for Claude Code

A Udemy-style marketplace plus a business compliance workspace, built as a sales demo
for a client. It must work end to end, with nothing faked, because the client will click
through it.
Stack: Django 5.2 + Django Ninja (`backend/`), React 19 + Vite + TypeScript + Tailwind v4
(`frontend/`), Neon Postgres (schema per domain, RLS), Redis + Celery, Bunny Stream
(video), Azure Blob (files), Stripe (test mode), Microsoft Graph (email).

**How work is organised.** Planning and review happen in a separate Claude session (the
"planner"). It writes milestone briefs in `docs/milestones/` and reviews what you build.
Your job:

1. Build exactly what the brief asks.
2. Prove it works.
3. Record what you did in `docs/build-status.md`.

When the brief and this file disagree, this file wins. When something is ambiguous or
would break a rule below, stop and ask the user. Don't guess.

Read before starting a milestone:

* `docs/build-status.md`: what exists and what's pending.
* `docs/STRUCTURE.md`: backend layering and frontend folders.
* `frontend/README.md`: the artwork and motion rules, with examples.
* `docs/client-questions.md`: open business decisions. Never decide these yourself.
* `docs/design/README.md`: the approved mockups (`docs/design/mockups/`), what we deliberately
  do differently from them, and specs for the screens that have no mockup.

---

## Design reference (every screen)
- Before building a screen, open its mockup(s) from `docs/design/mockups/`; the index is in `docs/design/README.md`. Match the layout, content and density.
- Apply the documented differences: our artwork, dark mode, motion, our tokens, no stock photos, no hard-coded business numbers.
- Screens without a mockup: follow the specs in the same README, and use the closest mockup it names.
- Before calling a screen done, look at your own screenshot next to the mockup and fix what's missing or worse. A mockup feature with no API: add the API if it's small and additive (tests + typed); otherwise list it in `docs/NEEDS-USER.md`.

## Long-running checks (save usage: wait, don't watch)
- Run every check through `python tools/run_check.py <name> -- <command>`. It writes the full output to `logs/<name>.log` and prints only a short summary.
  - Never stream a full test log into the conversation.
  - Read the log only around a failure (search for the test name).
- Anything over ~2 minutes (backend suite, E2E scripts, phone check, `vite build`): start it **in the background**, then **wait for it in one blocking call** rather than polling every few seconds. Or do unrelated work meanwhile.
- Backend tests: `--keepdb --noinput` (reuses the `test_*` database instead of rebuilding it on Neon, which cuts minutes per run). Run single apps or test classes while iterating; run the full suite once per milestone and before ticking a box.
- Re-run only what failed after a fix, then the full set once at the end.

---

## Non-negotiable rules

### Secrets and safety
- Secrets live only in `backend/.env` (and `frontend/.env*`).
  - Never read, print, copy or commit them.
  - Never put a key in code, docs, tests or chat.
  - Management commands must never print secrets.
- Never expose a server-side key to the browser. The Bunny token key, Stripe secret and Azure secret stay in Django.
- Nothing fake ships in the app. Test doubles (fake Stripe, etc.) live only in `tools/harness/` and tests.

### Database
- The app runs as `lms_app` (RLS enforced). It never uses `lms_owner`.
- Migrations run only through the owner connection: `python manage.py migrate --database owner`.
  - **Never `--fake`.**
- Neon (dev and production branches) may only **gain** tables, columns and rows.
  - If a change would alter or delete existing data, rename or drop anything, or rewrite a table: stop and ask the user first.
  - Never run destructive SQL on Neon yourself.
- End-to-end tests never run against the shared `dev` branch. Use the `e2e` Neon branch or a local Postgres (see `tools/harness/README.md`).

### Code conventions (backend)
- Layers:
  - `api.py` is thin;
  - `services.py` does the writes;
  - `selectors.py` does the optimised reads.
- Every company table has `org_id` + FORCE RLS (`core/tests/test_rls.py` enforces it).
- Every endpoint declares a typed 200 response schema. Schema class names are unique across the project.
  - `core/tests/test_api_contract.py` enforces both. When a milestone covers a new prefix, add it to `TYPED_PREFIXES`.
- One error shape everywhere: raise `core.errors.ServiceError(code, message, status=...)`.
- Rich text from users goes through `core.html.clean` (nh3). Plain text fields go through `core.html.plain`.
- Lists use keyset cursors (no OFFSET). Watch query counts: `core/tests/test_query_budgets.py`.
- Notifications go through `apps.engagement.notify.notify(...)`.
  - Every `url=` must be a real frontend route.
  - New wording goes in a data migration that only inserts.
- Cross-app imports point "upward" only (see STRUCTURE.md). Late-import inside functions when you need to call "down".

### Code conventions (frontend)
- Data comes only from the typed client: `api` + `unwrap` from `@/api/client`, with types generated from the API.
  - After any backend API change, regenerate the types: `/sync-types`.
  - Never hand-write response types.
- React Query hooks live in `src/features/<domain>/api.ts`. Invalidate exactly what a mutation changes.
  - Check that nothing shows stale data right after a mutation, and that no stale cache causes a wrong redirect.
- Links and navigation come from `@/lib/router`, which enables View Transitions.
- UI comes from `src/components/ui/*`. Don't add a UI library.
  - Before adding any dependency, ask.
  - Never import a whole icon set; import icons one by one.
- Every page must:
  - **Have custom artwork, never a flat background.** Use `<Backdrop variant=… />` from `components/art/backdrops.tsx`.
    - Workspace areas pick their art in the layout. Learner pages set it via route `handle: { art }`.
    - Keep shapes clear of the navigation and page titles (right side).
    - A new area gets a new variant, in the same style.
  - Use the agreed **motion**:
    - View Transitions between pages;
    - skeletons that cross-fade to content (`animate-reveal`);
    - `stagger` on lists;
    - numbers and charts that count up or fill (`useCountUp`, `useFill`, `Ring`);
    - small micro-interactions.
    - All subtle, 150–300 ms, and respecting reduced motion.
  - Work in **light and dark** mode, and on a phone, with no horizontal scroll.
  - Have loading, empty and error states (`EmptyState`, `ErrorState`, `Skeleton`).
  - Be accessible: labels on inputs, `aria-*` on custom controls, keyboard reachable.
- Writing: British English, short plain sentences, no jargon in the UI.

---

## Commands (Windows / PowerShell)

```powershell
# backend (from backend/, venv active: backend\venv). Prefer `cd backend; <cmd>` inside ONE
# command, or absolute paths: hooks and later commands assume the shell is at the repo root.
python manage.py test core apps        # full suite (needs no Redis)
ruff check . ; ruff format --check .
python manage.py makemigrations --check --dry-run
python manage.py migrate --database owner   # only when the user agrees (Neon!)
python manage.py runserver             # http://localhost:8000/api/docs

# frontend (from frontend/)
npm run dev                            # http://localhost:5173 (proxies /api)
npx tsc -b                             # type check
npx vite build                         # production build (watch the chunk sizes)
npm run gen:api                        # regenerate src/api/schema.d.ts (Django running)

# quiet wrapper for any long check (summary only; full log in logs/)
python tools/run_check.py backend-tests -- python manage.py test core apps --keepdb --noinput --cwd backend

# end to end (see tools/harness/README.md)
node tools/harness/e2e_m1.js shots/m1
node tools/harness/e2e_m2.js shots/m2
node tools/harness/phone_check.js shots/phone /learn /account
```

Slash commands: `/milestone <id>`, `/verify`, `/sync-types`, `/status`.
Sub-agents: `reviewer`, `e2e-tester`, `api-contract` (in `.claude/agents/`).

---

## Definition of done (every milestone)

1. Every screen in the brief is built and linked to the real backend. No placeholders are left for this milestone's routes.
2. Backend:
   - new behaviour has tests;
   - the full suite passes;
   - ruff is clean;
   - `makemigrations --check` is clean, or the new migrations are listed for the user.
3. The frontend type check and production build pass. The main entry chunk didn't grow without a reason.
4. An E2E script for the milestone (`tools/harness/e2e_<id>.js`) passes with no console errors and no 5xx. Earlier E2E scripts still pass.
5. The phone overflow check passes on every new route. You've looked at the light and dark screenshots yourself **next to the mockups** (`docs/design/`) and fixed anything missing or ugly.
6. The `reviewer` agent has been run on the diff and its findings fixed (or explained).
7. These are updated:
   - `docs/build-status.md`: what was built, the bugs found and fixed, and any migrations the user must run;
   - `frontend/README.md`, if the artwork or a convention changed;
   - `docs/client-questions.md`, if a business decision came up.
8. Final message to the user: what was built, what was verified, and anything they must do (migrations, keys, settings). Keep it short.





<!-- cloude-code-toolbox:mcp-skills-awareness-begin -->

### MCP & Skills awareness (Claude Code ToolBox)

_Last synced: 2026-11-13T16:03:16.173Z._

- **Full report:** `.claude/cloude-code-toolbox-mcp-skills-awareness.md` in this workspace (auto-overwritten on each scan). Use it as ground truth for configured servers and skill folders.
- **MCP:** For **live tools** in Claude Code, enable the matching server via `/mcp`. Servers are configured in `~/.claude.json` (user) and `.mcp.json` (project).
- **When the user’s task matches a server** (e.g. Confluence work and a **Confluence** / **Atlassian** MCP is listed), **prefer that server id** and plan on tool use—not only file search.
- **Skills:** Folders below contain `SKILL.md`; attach or cite paths in chat when relevant.

#### Workspace MCP

- `c:\Users\hp\Downloads\learn_hub\.mcp.json` _(workspace: learn_hub)_ — _file missing_

_No active workspace servers in mcp.json._

#### User MCP

- `C:\Users\hp\.claude.json` — _servers defined_

| Server id | Kind | Detail |
|-----------|------|--------|
| Neon | http | https://mcp.neon.tech/mcp |

#### Project skills

_None found (or no workspace open)._

#### User skills

- **skill-creator** — `C:\Users\hp\.claude\skills\skill-creator` — Create new skills, modify and improve existing skills. Use when users want to create a skill from scratch, edit, or optimize an existing skill.

<!-- cloude-code-toolbox:mcp-skills-awareness-end -->
