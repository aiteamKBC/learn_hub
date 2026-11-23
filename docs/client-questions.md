# Questions for the client

Business decisions that are **not ours to make**. Defaults are built so the demo works.
We go through this list with the client at the end of the project. Claude Code: add new
questions here, never decide them in code.

| # | Topic | What the demo does now | Decide |
|---|---|---|---|
| 1 | Revenue shares | Staff set the platform fee in the console: a default for new instructors (kept on approval) and a custom fee per instructor, for marketplace sales. Instructor-coupon sales (97%) and the subscription pool (25%) are fixed. Seeded default: 63% fee (37% to the instructor) | Final default fee; whether coupon and pool rates should also be per instructor |
| 2 | Instructor payouts | £25 minimum, monthly, 30-day hold | Minimum, frequency, hold |
| 3 | Refunds | 30-day window, instant self-service (the approved mockup said admin-reviewed) | Instant or reviewed |
| 4 | Tax | Prices shown tax-inclusive | Turn on Stripe Tax / VAT? |
| 5 | Currencies | Several currencies; some Stripe can't take | Which to offer |
| 6 | Plan prices | Personal £19.99/month with 7-day trial; Team £360/seat/year, min 5 seats | Prices, trial, minimum |
| 7 | Content protection (DRM) add-on | £49/month | Price |
| 8 | Team Plan sales contact | Placeholder email | Real contact |
| 9 | Notification wording, starter badges | Our wording; 5 badges | Wording, badge set |
| 10 | Microsoft sign-in audience | Any work/school + personal accounts | Or company tenants only |
| 11 | Production domain and hosting | None yet | Domain, hosting; needed for live Stripe/Bunny webhooks and Azure CORS |
| 12 | Commission rules | First match wins: course rule > instructor rule > category rule > price-band rule > the instructor's own rate > the default. Category and price-band rules sit above the instructor's own rate because every instructor gets one on approval. Discounts reduce the instructor's share (a switch in Settings turns that off) | Which rules, their order, and how discounts affect commission |
| 13 | Payout methods | Stripe Connect paid automatically; PayPal, Wise and bank recorded and paid by staff by hand | Which methods to offer |
| 14 | Payout requests | Instructors can request their available balance (past the hold, above the minimum) | On request, automatic monthly, or both |
| 15 | Regional pricing | Staff can set a price per country; otherwise the currency price | Use it? Which countries? |
| 16 | Promotions | One promotion per order; instructor coupons still work; no stacking | Stacking rules, first-purchase offer |
| 17 | Plans and included courses | Each plan can list its courses; empty = every course marked "in subscription" | Which courses per plan |
| 18 | Certificate expiry | No expiry by default; staff can set one per certificate | Should some courses expire (e.g. compliance)? |
| 19 | 2-step sign-in | Optional for users; staff can be required to use it | Require for staff / company admins? |
| 20 | Maintenance mode, guest browsing, registration | All on (maintenance off) | Defaults for launch |
| 21 | Payout hold and refund window | The payout hold is never shorter than the refund window (30 days each), so money cannot be paid out and then refunded | Keep them linked? |
| 22 | Instructor invitations | Staff invite by email; the link works for 7 days. **Answered 2026-11-08: yes**, built: a pending list with resend and cancel | Closed |
| 23 | HCM — PsyCap scale | Wellbeing surveys store each of the four PsyCap sub-scales (hope, efficacy, resilience, optimism) as an integer 0–100, same scale as the overall score. A survey UI that prefers 1–5 Likert items can convert at form time | Keep 0–100 everywhere, or store 1–5 Likert raw and derive 0–100 for dashboards |
| 24 | HCM — Wellbeing survey retention | Raw `WellbeingSurvey` rows kept indefinitely alongside the member. Quarterly rollups on `MemberQuarter` retained forever. The matching `Organization.retention_months` policy (72 months default) is not applied to wellbeing rows today | How long to keep raw survey rows; whether the organisation retention window applies to wellbeing |
| 25 | HCM — Wellbeing visibility to managers | A line manager can read the aggregate (mean + distribution) for members in their unit subtree; raw rows are admin-only. A member always reads their own | Should managers ever see individual raw responses (with consent?), or stay aggregate-only forever |
| 26 | HCM — CPD verification | A member may add external CPD entries to their own log. The platform shows them as "unverified" until an admin or line manager marks them verified; dashboards count verified and unverified hours separately | Who can verify (admin only, admin + line manager, auto-verify after N days), and whether unverified hours count towards framework readiness |
| 27 | HCM — Line manager assignment | Single-parent only: one `line_manager` per `MemberProfile`. No dotted-line / matrix relationships. A manager cannot be their own line manager (enforced in the database) | Add a secondary / dotted-line manager field, or keep single-parent |
| 28 | HCM — Manager visibility scope | A `UnitManager` sees members whose primary unit is a descendant of the manager's unit (LTree subtree, inclusive). Peers and parents of the unit are out of scope | Keep strict subtree, or add peer-unit visibility for named dotted-line groupings |
| 29 | HCM — `adjustments` field | Free-text TextField on `MemberProfile`, up to 2000 chars. Stores reasonable workplace adjustments (accessibility, scheduling). Visible to the member, their line manager and admins; not shown anywhere public | Confirm wording, confirm visibility, confirm whether this is mandatory for any role |
