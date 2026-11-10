# Questions for the user

1. **Course language (M4 Details tab).** The brief asks for a "language" field, but `catalog.courses` has no language column. Adding one is an additive migration (a new column with default `'en'`), so it needs `migrate --database owner` on dev and e2e.
   **Recommended:** yes, add `language` (ISO code, default `en`) in M6 or after the planner's review. Until then the Details tab leaves it out.

2. **Run two new migrations on Neon (dev and e2e).** Both only add a nullable column:
   - catalog 0005: `lectures.prerequisite_key`;
   - identity 0002: `instructor_profiles.platform_fee_bps`.
   Command: `cd backend; python manage.py migrate --database owner`, against dev and then e2e.
   **Recommended:** yes. The studio, player and console fail on Neon until they run.

(Closed 2026-11-07: money screens became a basic admin-set fee, now built; prerequisite lesson, now built. See build-status.)

---
## Answers from the user (2026-11-07, via the planner)
1. **Course language:** yes. Added in the M5 migration set (`courses.language`, default `en`).
2. **Money screens (mockups 01, 31):** build them now, in M5, as configurable data with defaults from
   `client-questions.md` (#2, #12-#14). See M5 P11/P12.
3. **Prerequisite lesson:** `lectures.prerequisite_key` already exists (catalog 0005). If the player rule is
   not wired yet, wire it in M5 (no new migration).

## Answers from the user (2026-11-08, via the planner)
- **Question 1 (course language):** already answered and built in M5 (`courses.language`). Closed.
- **Question 2 + the M5 migrations:** **yes, Claude Code runs them.** Run
  `python manage.py migrate --database owner` on **dev**, then on **e2e** (all pending migrations: engagement 0005,
  catalog 0005, identity 0002 and the 9 M5 migrations). Then `seed_demo` and `seed_console_demo` on both.
  Before each run, show `showmigrations` for the pending list; stop and ask if anything is not additive.
  Report what ran (never print connection strings).
- **2-step sign-in QR code:** yes. `qrcode` is already installed with `django-allauth[mfa]`, so it is **not** a
  new dependency. Render the QR server-side as SVG next to the key.
- **Client question 22 (pending instructor invitations):** yes, build the list with resend and cancel
  (additive table if needed; list the migration and run it as above).
- **Client question 21 (payout hold vs refund window):** keep them linked for the demo. Leave the question
  open for the client.

**Done 2026-11-08 (Claude Code):** migrations and seeds ran on dev and e2e as above (plus the new identity
0003_instructor_invites table); QR code built; pending invitations built. All questions here are closed;
client question 21 stays open in `client-questions.md`. This file can be deleted.

