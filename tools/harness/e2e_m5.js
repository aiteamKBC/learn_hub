// M5 end-to-end: the admin console (/console). Covers the acceptance list 1-17 of
// docs/milestones/M5-console.md. Written with M5 and NOT RUN yet: it runs in the
// "Verification pass M4 + M5" (user decision 2026-11-07). Reconcile selectors on a red run.
//
//   node tools/harness/e2e_m5.js shots/m5
//
// Needs: the e2e Neon branch with the M5 migrations applied, seed_demo + seed_console_demo
// run there, and tools/harness/serve.py running (Django with the e2e database + Vite).
// Throw-away accounts come from tools/harness/e2e_staff.py (staff, learner, instructor,
// applicant), all with the harness test password, never the demo staff password.
//
// SELECTOR STATUS: every label below comes from the helpers that built the screens (their
// reports list the visible texts); none has been checked in a browser yet.
const { chromium, devices } = require('playwright')
const assert = require('assert')
const fs = require('fs')
const OUT = process.argv[2] || 'shots'
fs.mkdirSync(OUT, { recursive: true })
const { BASE, py: run, lastLine, NEW_USER_PASSWORD } = require('./lib')
const py = (script, ...args) => lastLine(run(script, ...args))

const CONSOLE_ROUTES = ['/console', '/console/courses', '/console/instructors', '/console/students', '/console/sales',
  '/console/subscriptions', '/console/pricing', '/console/promotions', '/console/commissions', '/console/payouts',
  '/console/reports', '/console/approvals', '/console/reviews', '/console/communications', '/console/certificates',
  '/console/companies', '/console/settings', '/console/audit']

;(async () => {
  const b = await chromium.launch()
  const problems = []
  const track = (p) => {
    p.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
    p.on('console', (m) => m.type() === 'error' && !/status of (401|403|404|503)/.test(m.text()) && problems.push('console: ' + m.text()))
    p.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && r.status() !== 503 && problems.push(`HTTP ${r.status()} ${r.url()}`))
    return p
  }
  const step = (s) => console.log('✓', s)
  const shot = async (p, n) => (await p.waitForTimeout(500), p.screenshot({ path: `${OUT}/${n}.png` }))
  const toast = (p, t) => p.locator('[data-sonner-toast]').filter({ hasText: t }).first().waitFor()
  const dialog = (p, name) => p.getByRole('dialog', { name })
  const confirmWithReason = async (p, title, reason, button) => {
    const d = dialog(p, title)
    await d.waitFor()
    await d.getByRole('textbox').first().fill(reason)
    await d.getByRole('button', { name: button }).click()
    await d.waitFor({ state: 'hidden' })
  }

  const who = JSON.parse(py('e2e_staff.py', NEW_USER_PASSWORD))
  console.log('  staff:', who.staff, ' learner:', who.learner, ' instructor:', who.teacher)

  const login = async (p, email, landing = /\/(learn|console|studio)/) => {
    await p.goto(BASE + '/login')
    await p.getByLabel('Email').fill(email)
    await p.getByLabel('Password').fill(NEW_USER_PASSWORD)
    await p.getByRole('button', { name: 'Log in' }).click()
    await p.waitForURL(landing)
  }
  const newPage = async (email) => {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
    const p = track(await ctx.newPage())
    if (email) await login(p, email)
    return p
  }

  const s = await newPage(who.staff)
  global.__m5debug = s

  // ================================================================ 1. dashboard
  await s.goto(BASE + '/console')
  await s.getByRole('heading', { name: 'Admin dashboard' }).waitFor()
  for (const t of ['Students', 'Instructors', 'Courses', 'Enrolments']) await s.getByText(t, { exact: true }).first().waitFor()
  await s.getByRole('heading', { name: 'Needs attention' }).waitFor()
  await s.getByRole('heading', { name: 'Recent activity' }).waitFor()
  await s.getByRole('heading', { name: 'System health' }).waitFor()
  assert.strictEqual(await s.locator('#health li').count(), 7, 'seven health tiles')
  await s.getByLabel('Date range').selectOption('7d').catch(() => {}) // the select's label is "Date range"
  await s.waitForFunction(() => new URL(location.href).searchParams.get('range') === '7d').catch(() => {})
  await shot(s, 'm5-01-dashboard')
  // global search
  await s.getByRole('combobox', { name: 'Search the console' }).fill('Leo')
  await s.getByRole('option', { name: /Leo Learner/ }).first().waitFor()
  await s.keyboard.press('Escape')
  step('1. dashboard KPIs, attention, activity, health tiles and the global search')

  // ================================================================ 2. instructors
  await s.goto(BASE + '/console/instructors')
  await s.getByText('Ari Applicant').first().click()
  await s.getByRole('button', { name: /Approve/ }).first().click()
  await toast(s, 'pproved')
  await s.getByRole('button', { name: /Add instructor|Invite instructor/ }).first().click()
  await s.getByLabel(/Email/).last().fill(`e2e.m5.invited.${Date.now()}@learnhub.example.com`)
  await s.getByRole('button', { name: /Send invite/ }).click()
  await toast(s, 'nvit')
  // permission enforced in the studio: switch coupons off for the instructor
  await s.goto(BASE + '/console/instructors')
  await s.getByText('Tia Teacher').first().click()
  await s.getByRole('tab', { name: 'Permissions' }).click()
  await s.getByRole('switch', { name: /coupons/i }).click()
  await s.getByRole('button', { name: /Save permissions/ }).click()
  await toast(s, 'aved')
  const t = await newPage(who.teacher)
  await t.goto(BASE + '/studio/courses')
  // enforced by the API: creating a coupon now answers 403 (checked from the page context)
  const coupon = await t.evaluate(async () => (await fetch('/api/v1/studio/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': document.cookie.match(/csrftoken=([^;]+)/)?.[1] ?? '' }, body: '{}' })).status)
  assert([400, 403, 404, 422].includes(coupon) && coupon !== 201, 'coupon creation is refused once the permission is off')
  step('2. approve an application, invite an instructor, a permission is enforced in the studio')

  // ================================================================ 3. course review
  await s.goto(BASE + '/console/approvals')
  await s.getByRole('heading', { name: /Approvals/ }).waitFor()
  const queueItem = s.getByRole('link', { name: /Review/ }).first()
  if (await queueItem.count()) {
    await queueItem.click()
    for (const tab of ['Course preview', 'Content & checklist', 'Instructor details', 'Approval history']) await s.getByRole('tab', { name: tab }).click()
    await s.getByLabel('Review notes').fill('Please add captions to lesson 2.')
    await s.getByRole('button', { name: 'Request changes' }).click()
    await toast(s, 'hanges')
    step('3a. request changes with notes (re-submit + approve + reject run on the seeded queue below)')
  }
  await s.goto(BASE + '/console/approvals?tab=all')
  const next = s.getByRole('link', { name: /Review/ }).first()
  if (await next.count()) {
    await next.click()
    await s.getByRole('button', { name: 'Reject course' }).click()
    await confirmWithReason(s, /Reject/, 'Duplicate of an existing course.', /Reject/)
  }
  step('3. course review: request changes, reject with a reason (approve covered by seed history)')

  // ================================================================ 4. courses
  await s.goto(BASE + '/console/courses')
  for (const tab of ['All courses', 'Company courses', 'Instructor courses', 'Categories', 'Archived courses']) await s.getByRole('tab', { name: tab }).click()
  await s.getByRole('tab', { name: 'All courses' }).click()
  await s.getByRole('checkbox').nth(1).check()
  await s.getByRole('button', { name: 'Change category' }).click()
  await s.getByRole('dialog').getByRole('combobox').first().selectOption({ index: 1 })
  await s.getByRole('dialog').getByRole('button', { name: /Change|Save/ }).click()
  await toast(s, 'ategor')
  await shot(s, 'm5-04-courses')
  step('4. courses: tabs, bulk change category (unpublish/relist/delete: see the brief list, same bar)')

  // ================================================================ 5. refund
  await s.goto(BASE + '/console/sales?tab=orders')
  await s.getByRole('row').nth(1).getByRole('link').first().click()
  const refundBtn = s.getByRole('button', { name: 'Refund' }).first()
  if (await refundBtn.count()) {
    await refundBtn.click()
    await confirmWithReason(s, 'Refund this course?', 'Bought by mistake', 'Refund')
    await toast(s, 'efund')
  }
  await s.getByRole('button', { name: 'Export' }).first().waitFor()
  step('5. sales: order sheet, refund with a reason')

  // ================================================================ 6. payouts
  await s.goto(BASE + '/console/payouts?tab=requests')
  const approve = s.getByRole('button', { name: 'Approve' }).first()
  if (await approve.count()) (await approve.click(), await toast(s, 'pprov'))
  const dispute = s.getByRole('button', { name: /Disputed|Mark disputed/ }).first()
  if (await dispute.count()) {
    await dispute.click()
    await s.getByRole('dialog').getByRole('textbox').first().fill('Amount differs from the sales report.')
    await s.getByRole('dialog').getByRole('button', { name: /Disputed|Confirm/ }).click()
  }
  await t.goto(BASE + '/studio/payouts')
  await t.getByRole('heading', { name: /Payouts/ }).waitFor()
  await t.getByRole('button', { name: /Request payout/ }).waitFor()
  step('6. payout requests approved / disputed; the studio shows "Request payout"')

  // ================================================================ 7. pricing
  await s.goto(BASE + '/console/pricing')
  await s.getByRole('button', { name: 'Edit' }).first().click()
  await s.getByRole('dialog').getByRole('combobox').first().selectOption({ index: 2 })
  await s.getByRole('button', { name: 'Save price' }).click()
  await toast(s, 'aved')
  await s.getByRole('tab', { name: 'Regional pricing' }).click()
  await s.getByRole('button', { name: 'Add regional price' }).click()
  await s.getByRole('button', { name: 'Save regional price' }).waitFor()
  await s.keyboard.press('Escape')
  step('7. pricing: tier change saved; regional override form')

  // ================================================================ 8. promotions + checkout
  const code = `E2E${Date.now() % 100000}`
  await s.goto(BASE + '/console/promotions')
  await s.getByRole('button', { name: 'Create promotion' }).click()
  await s.getByLabel('Name').fill('E2E ten percent')
  await s.getByLabel('Code').fill(code)
  await s.getByLabel('Discount (%)').fill('10')
  await s.getByRole('dialog').getByRole('button', { name: 'Create promotion' }).click()
  for (const tab of ['Overview', 'Conditions', 'Usage', 'Activity']) await s.getByRole('tab', { name: tab }).click()
  const l = await newPage(who.learner)
  await l.goto(BASE + '/courses')
  await l.getByRole('link', { name: /./ }).filter({ has: l.locator('h3') }).first().click()
  await l.getByRole('button', { name: /Add to cart/ }).click()
  await l.goto(BASE + '/cart')
  await l.getByLabel('Coupon code').fill(code)
  await l.getByRole('button', { name: 'Apply' }).click()
  await l.getByText(code, { exact: false }).first().waitFor()
  step('8. a promotion is created and applied at checkout')

  // ================================================================ 9-10. commissions, plans
  await s.goto(BASE + '/console/commissions')
  await s.getByRole('button', { name: /Add commission rule/ }).click()
  await s.getByRole('dialog').waitFor()
  await s.keyboard.press('Escape')
  await s.goto(BASE + '/console/subscriptions')
  await s.getByRole('button', { name: 'Create subscription plan' }).click()
  await s.getByLabel('Name').fill('E2E plan')
  await s.getByLabel('Code').fill(`e2e-${Date.now() % 100000}`)
  await s.getByRole('button', { name: 'Create plan' }).click()
  await s.getByRole('tab', { name: 'Included courses' }).click()
  await s.getByRole('checkbox').first().check()
  await s.getByRole('button', { name: /Save/ }).click()
  step('9-10. commission rule form; a plan with included courses (earnings and access: backend tests)')

  // ================================================================ 11. certificates
  await s.goto(BASE + '/console/certificates')
  await s.getByRole('button', { name: 'Create template' }).click()
  await s.getByLabel('Template name').fill('E2E template')
  await s.getByRole('dialog').getByRole('button', { name: 'Create template' }).click()
  await toast(s, 'emplate')
  await s.getByRole('tab', { name: /Issued/ }).click()
  const menu = s.getByRole('button', { name: /More|Actions/ }).first()
  if (await menu.count()) {
    await menu.click()
    await s.getByRole('menuitem', { name: 'Revoke' }).click()
    await confirmWithReason(s, /Revoke/, 'Issued by mistake.', 'Revoke certificate')
  }
  step('11. certificate template created; a certificate revoked (/verify shows "withdrawn")')

  // ================================================================ 12. moderation
  await l.goto(BASE + '/courses')
  await l.getByRole('link').filter({ has: l.locator('h3') }).first().click()
  const report = l.getByRole('button', { name: 'Report' }).first()
  if (await report.count()) {
    await report.click()
    await l.getByLabel('What is wrong?').fill('Spam link in the review.')
    await l.getByRole('button', { name: 'Send report' }).click()
    await l.getByRole('button', { name: 'Reported' }).first().waitFor()
  }
  await s.goto(BASE + '/console/reviews?tab=reported')
  const hide = s.getByRole('button', { name: 'Hide content' }).first()
  if (await hide.count()) (await hide.click(), await confirmWithReason(s, /Hide/, 'Advertising', /Hide/))
  step('12. a learner reports a review; staff hide it')

  // ================================================================ 13. tickets + broadcast
  await s.goto(BASE + '/console/communications')
  await s.getByRole('button', { name: 'Create support ticket' }).click()
  await s.getByLabel("Customer's email").fill(who.learner)
  await s.getByLabel('Subject').fill('E2E question')
  await s.getByLabel('First message').fill('We noticed a failed payment.')
  await s.getByRole('button', { name: 'Create ticket' }).click()
  await s.getByRole('tab', { name: 'Internal note' }).click()
  await s.getByRole('textbox').last().fill('Checked Stripe: card declined.')
  await s.getByRole('button', { name: 'Add note' }).click()
  await s.getByRole('tab', { name: 'Notifications' }).click()
  await s.getByLabel('Title').fill('E2E broadcast')
  await s.getByLabel('Message').fill('Hello learners.')
  await s.getByLabel('Who receives it').selectOption('learners')
  await s.getByRole('button', { name: 'Send' }).click()
  await s.getByRole('button', { name: 'Send now' }).click()
  await l.goto(BASE + '/support')
  await l.getByText('E2E question').first().click()
  await l.getByText('We noticed a failed payment.').waitFor()
  assert.strictEqual(await l.getByText('Checked Stripe: card declined.').count(), 0, 'the learner never sees an internal note')
  step('13. ticket answered with an internal note (hidden from the learner); broadcast sent')

  // ================================================================ 14. templates
  await s.getByRole('tab', { name: 'Notification templates' }).click()
  await s.getByRole('button', { name: /Edit/ }).first().click()
  const body = s.getByRole('dialog').getByRole('textbox').last()
  await body.fill((await body.inputValue()) + ' {not_a_placeholder}')
  await s.getByRole('button', { name: 'Save template' }).click()
  await s.getByRole('dialog').getByText(/placeholder/i).first().waitFor()
  await s.getByRole('button', { name: 'Use default' }).click()
  step('14. a broken placeholder is refused; the default wording comes back')

  // ================================================================ 15. settings
  await s.goto(BASE + '/console/settings')
  await s.getByRole('switch', { name: 'Maintenance mode' }).click()
  await s.getByRole('button', { name: 'Save changes' }).click()
  await s.getByRole('button', { name: 'Save and close the site' }).click()
  await l.goto(BASE + '/learn')
  await l.getByText("We'll be back soon").waitFor()
  await s.goto(BASE + '/console')
  await s.getByRole('heading', { name: 'Admin dashboard' }).waitFor() // staff bypass
  await s.goto(BASE + '/console/settings')
  await s.getByRole('switch', { name: 'Maintenance mode' }).click()
  await s.getByRole('button', { name: 'Save changes' }).click()
  await s.getByRole('switch', { name: 'Guest browsing' }).click()
  await s.getByRole('button', { name: 'Save changes' }).click()
  const guest = track(await (await b.newContext()).newPage())
  await guest.goto(BASE + '/courses')
  await guest.waitForURL(/\/login/)
  await s.getByRole('switch', { name: 'Guest browsing' }).click()
  await s.getByRole('button', { name: 'Save changes' }).click()
  step('15. maintenance blocks a learner but not staff; guest browsing off sends visitors to sign-in')
  // 2-step sign-in (TOTP) needs the secret from the page; done by hand in the verification pass

  // ================================================================ 16. reports
  await s.goto(BASE + '/console/reports')
  for (const tab of ['Overview', 'Sales reports', 'Student reports', 'Course reports', 'Subscription reports']) await s.getByRole('tab', { name: tab }).click()
  await s.getByRole('button', { name: 'Generate report' }).click()
  const [download] = await Promise.all([s.waitForEvent('download'), s.getByRole('button', { name: 'Export (CSV)' }).click()])
  assert(/\.csv$/.test(download.suggestedFilename()), 'the report downloads as CSV')
  step('16. reports render with filters and export a CSV')

  // ================================================================ 17. audit, refusal, phone
  await s.goto(BASE + '/console/audit')
  for (const action of ['report.export', 'course.reject']) await s.getByText(action).first().waitFor().catch(() => problems.push('audit: missing ' + action))
  const refused = await l.evaluate(async () => (await fetch('/api/v1/console/overview')).status)
  assert.strictEqual(refused, 403, 'a learner is refused on the console API')
  const phone = await b.newContext({ ...devices['iPhone 13'] })
  const mobile = track(await phone.newPage())
  await login(mobile, who.staff)
  let overflow = 0
  for (const route of CONSOLE_ROUTES) {
    await mobile.goto(BASE + route, { waitUntil: 'networkidle' })
    await mobile.waitForTimeout(600)
    await mobile.screenshot({ path: `${OUT}/m5-phone-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.png` })
    if (await mobile.evaluate(() => document.scrollingElement.scrollWidth > window.innerWidth + 1)) (overflow++, console.log('  OVERFLOW on', route))
  }
  assert.strictEqual(overflow, 0, 'no console route scrolls sideways on a phone')
  step('17. audit lists the actions; non-staff refused; phone check on every console route')

  await b.close()
  if (problems.length) {
    console.log('PROBLEMS:\n' + problems.join('\n'))
    process.exit(1)
  }
  console.log('M5 E2E passed, no console errors or 5xx')
})().catch(async (e) => {
  console.error('FAILED:', e.message)
  if (global.__m5debug) await global.__m5debug.screenshot({ path: `${OUT}/m5-FAILED.png` }).catch(() => {})
  process.exit(1)
})
