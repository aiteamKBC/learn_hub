// M3 end-to-end: the business (company) workspace. A fresh company (tools/harness/e2e_org.py)
// is used throughout so the run never touches seeded data. Covers the M3 brief's acceptance
// list 1-10 (docs/milestones/M3-business.md); #11 (M1/M2 still pass) is checked by running
// those scripts separately, not from here.
//
// Two pieces of harness-only plumbing this script depends on (see their own file headers):
//   - tools/harness/e2e_wsgi.py  captures invite tokens to invite.log (the real mail backend
//     never logs a link, on purpose - see core/mail.py).
//   - tools/harness/e2e_verify_key.py  recomputes the real allauth email-confirmation key for
//     an address, so the script can go through the real signup + verify screens.
//
// SELECTOR STATUS when this draft was written (reconcile before trusting a red run):
//   CONFIRMED against the built page: ComplianceDashboard, MatrixPage, PersonRequirements,
//   RequirementsPage + RequirementForm, UnitsPage, InvitesPage, InvitePage, LibraryPage,
//   ReportsPage, UserMenu, BusinessLayout.
//   ASSUMED (page still being written when this draft was written): /business/assign,
//   /business/billing, /business/settings. Each assumed block below says exactly what it
//   expects to find.
const { chromium, devices } = require('playwright')
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const OUT = process.argv[2] || 'shots'
fs.mkdirSync(OUT, { recursive: true })
const { BASE, py: run, lastLine, NEW_USER_PASSWORD } = require('./lib')
const py = (script, ...args) => lastLine(run(script, ...args))

const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { /* ignore */ } }

/** The one-time invite token e2e_wsgi.py captured for this email (see its header comment). */
function readInviteToken(email, timeoutMs = 10_000) {
  const file = path.join(__dirname, 'invite.log')
  const start = Date.now()
  do {
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
      for (let i = lines.length - 1; i >= 0; i--) {
        const tab = lines[i].indexOf('\t')
        if (tab > -1 && lines[i].slice(0, tab) === email) return lines[i].slice(tab + 1)
      }
    }
    sleepSync(150)
  } while (Date.now() - start < timeoutMs)
  throw new Error(`invite token for ${email} not found in tools/harness/invite.log within ${timeoutMs}ms`)
}

const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const dash = '–' // the en dash the matrix cell aria-labels use, e.g. "Sara Ahmed – Fire Safety: ..."
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Requirement statuses are computed by a Celery task, not inline: poll (with reloads)
 * until a condition becomes true instead of asserting immediately after creating one. */
async function waitForCondition(page, fn, { tries = 10, delayMs = 1000 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true
    await page.waitForTimeout(delayMs)
    await page.reload({ waitUntil: 'networkidle' })
  }
  return false
}

;(async () => {
  const b = await chromium.launch()
  const problems = []
  const track = (p) => {
    p.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
    p.on('console', (m) => m.type() === 'error' && !/status of (401|404)/.test(m.text()) && problems.push('console: ' + m.text()))
    p.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && problems.push(`HTTP ${r.status()} ${r.url()}`))
    return p
  }
  const step = (s) => console.log('✓', s)
  const shot = async (p, n) => (await p.waitForTimeout(500), p.screenshot({ path: `${OUT}/${n}.png` }))
  const toast = (p, t) => p.locator('[data-sonner-toast]').filter({ hasText: t }).first().waitFor()

  // -------------------------------------------------------------- fixture
  const org = JSON.parse(py('e2e_org.py', NEW_USER_PASSWORD))
  console.log('  company:', org.org_name, ' admin:', org.admin)

  const login = async (p, email) => {
    await p.goto(BASE + '/login')
    await p.getByLabel('Email').fill(email)
    await p.getByLabel('Password').fill(NEW_USER_PASSWORD)
    await p.getByRole('button', { name: 'Log in' }).click()
    await p.waitForURL(/\/learn$/)
  }

  /** The UI workspace switcher (UserMenu "<company> dashboard" item), not direct localStorage
   * writes: it both selects the company and proves the switcher works for this role. */
  const openWorkspace = async (p) => {
    await p.getByRole('button', { name: 'Account menu' }).click()
    await p.getByRole('menuitem', { name: new RegExp(`${esc(org.org_name)} dashboard`) }).click()
    await p.waitForURL(/\/business$/)
  }

  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const p = track(await ctx.newPage())
  global.__m3debug = p

  await login(p, org.admin)
  await openWorkspace(p)
  await p.getByRole('heading', { name: 'Compliance overview' }).waitFor()
  await shot(p, 'm3-01-overview')
  step('admin signs in; workspace switcher selects the company; overview loads')

  // ================================================================ 1. matrix: filters + URL
  await p.goto(BASE + '/business/matrix')
  await p.getByRole('heading', { name: 'Training matrix' }).waitFor()
  await p.getByLabel('Location or team').selectOption(org.units.leeds)
  await p.waitForFunction((v) => new URL(location.href).searchParams.get('unit') === v, org.units.leeds)
  await p.getByLabel('Status', { exact: true }).selectOption('overdue')
  await p.waitForFunction(() => new URL(location.href).searchParams.get('status') === 'overdue')
  assert(/unit=/.test(p.url()) && /status=overdue/.test(p.url()), 'matrix filters are reflected in the URL')
  await shot(p, 'm3-02-matrix-filtered')
  await p.getByRole('button', { name: 'Clear filters' }).first().click()
  await p.waitForFunction(() => !new URL(location.href).search)
  step('matrix: filtered by unit and status, the URL updated, then cleared')

  // open a cell, extend the due date, the cell itself updates. The fixture's "Fire Safety"
  // requirement is created synchronously, but its per-person statuses (and so the matrix
  // cells) are filled in by the same Celery task as new requirements - poll for it first.
  const fireCell = (name) => p.getByRole('button', { name: new RegExp(`${esc(name)} ${dash} Fire Safety:`) })
  const matrixReady = await waitForCondition(p, async () => (await fireCell(org.people.sara.name).count()) > 0)
  assert(matrixReady, 'Fire Safety statuses were computed for Sara within the poll window')
  const originalTitle = await fireCell(org.people.sara.name).getAttribute('title')
  await fireCell(org.people.sara.name).click()
  const sheet = p.getByRole('dialog', { name: org.people.sara.name })
  await sheet.waitFor()
  await sheet.getByRole('button', { name: 'Extend', exact: true }).click()
  const extendForm = sheet.getByRole('form', { name: 'Extend the due date' })
  await extendForm.getByLabel('New due date').fill(inDays(60))
  await extendForm.getByRole('button', { name: 'Extend', exact: true }).click()
  await toast(p, 'Due date moved to')
  await sheet.getByText('Extended to').waitFor()
  await p.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden' })
  await p.waitForFunction(
    ([n, orig]) => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith(n) && b.getAttribute('aria-label')?.includes('Fire Safety'))
      return btn && btn.getAttribute('title') !== orig
    },
    [org.people.sara.name, originalTitle],
  )
  step('matrix cell: extend due date updates the sheet and the cell itself')

  // ================================================================ 2. exempt/revoke, record/void
  await fireCell(org.people.omar.name).click()
  const omarSheet = p.getByRole('dialog', { name: org.people.omar.name })
  await omarSheet.waitFor()
  await omarSheet.getByRole('button', { name: 'Exempt', exact: true }).click()
  const exemptForm = omarSheet.getByRole('form', { name: 'Exempt from this requirement' })
  await exemptForm.getByLabel('Reason').fill('Signed off by occupational health.')
  await exemptForm.getByRole('button', { name: 'Exempt', exact: true }).click()
  await toast(p, 'Exemption granted')
  await omarSheet.getByText('Exempt', { exact: true }).first().waitFor()
  await shot(p, 'm3-03-exempt')
  await omarSheet.getByRole('button', { name: /Revoke the exemption from/ }).click()
  await omarSheet.getByRole('form', { name: 'Revoke this exemption?' }).getByRole('button', { name: 'Revoke' }).click()
  await toast(p, 'Exemption revoked')
  await p.keyboard.press('Escape')
  await omarSheet.waitFor({ state: 'hidden' })
  step('exempt granted then revoked')

  await fireCell(org.people.lee.name).click()
  const leeSheet = p.getByRole('dialog', { name: org.people.lee.name })
  await leeSheet.waitFor()
  await leeSheet.getByRole('button', { name: 'Record completion' }).click()
  const recordForm = leeSheet.getByRole('form', { name: 'Record a completion' })
  await recordForm.getByLabel('Note').fill('Certificate seen, number E2E-001.')
  await recordForm.getByRole('button', { name: 'Record', exact: true }).click()
  await toast(p, 'Completion recorded')
  await leeSheet.getByText('Compliant', { exact: true }).first().waitFor()
  await shot(p, 'm3-04-record-completion')
  await leeSheet.getByRole('button', { name: /Void the completion of/ }).click()
  const voidForm = leeSheet.getByRole('form', { name: /Void the completion of/ })
  await voidForm.getByLabel('Reason').fill('Entered against the wrong person.')
  await voidForm.getByRole('button', { name: 'Void record' }).click()
  await toast(p, 'Record voided')
  await leeSheet.getByText('Void', { exact: true }).waitFor()
  await p.keyboard.press('Escape')
  step('completion recorded then voided; status recalculated both times')

  // ================================================================ 3. new requirement targets one unit
  await p.goto(BASE + '/business/requirements')
  await p.getByRole('heading', { name: 'Requirements' }).waitFor()
  await p.getByRole('button', { name: 'New requirement' }).click()
  const reqDialog = p.getByRole('dialog', { name: 'New requirement' })
  await reqDialog.getByLabel('Course').selectOption(org.courses.hand.id)
  await reqDialog.getByLabel('Name').fill('Hand Hygiene')
  await reqDialog.getByRole('radio', { name: 'Locations and teams' }).click()
  await reqDialog.getByRole('checkbox', { name: 'South' }).check()
  await reqDialog.getByRole('button', { name: 'Create requirement' }).click()
  await toast(p, 'Requirement created')
  await p.getByText('Hand Hygiene').first().waitFor()
  step('requirement "Hand Hygiene" created, targeting South only')

  // it shows in the matrix for South (Omar) but not for Leeds (Sara/Lee). Statuses are
  // computed by a Celery task after creation, so poll (with reloads) before asserting.
  await p.goto(`${BASE}/business/matrix?unit=${org.units.south}`)
  const reachedSouth = await waitForCondition(p, async () => (await p.getByText(org.people.omar.name).count()) > 0 && (await p.getByRole('columnheader', { name: 'Hand Hygiene' }).count()) > 0)
  assert(reachedSouth, 'Hand Hygiene requirement reached Omar in South within the poll window')
  await shot(p, 'm3-requirement-south')
  await p.goto(`${BASE}/business/matrix?unit=${org.units.leeds}`)
  await p.getByLabel('Requirement').selectOption({ label: 'Hand Hygiene' })
  await p.getByText('Nobody matches these filters').waitFor()
  step('new requirement reaches South only, not Leeds')

  // ================================================================ 4. invite -> signup -> verify -> accept -> required training
  const stamp = Date.now()
  const inviteEmail = `e2e.invitee.${stamp}@learnhub.example.com`
  await p.goto(BASE + '/business/invites')
  await p.getByRole('heading', { name: 'Invitations' }).waitFor()
  await p.getByLabel('Email addresses').fill(inviteEmail)
  await p.getByLabel('Unit (optional)').selectOption(org.units.leeds)
  await p.getByRole('button', { name: 'Send invitation' }).click()
  await toast(p, 'Invitation sent')
  await p.getByText(inviteEmail).waitFor() // in the pending table
  step('invited a new learner to Leeds')

  const token = readInviteToken(inviteEmail)
  const inviteCtx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  const ip = track(await inviteCtx.newPage())
  await ip.goto(`${BASE}/invite/${token}`)
  await ip.getByRole('heading', { name: org.org_name }).waitFor()
  await ip.getByText(/invited to join/).waitFor()
  await shot(ip, 'm3-05-invite-preview')
  await ip.getByRole('link', { name: 'Create an account' }).click()
  await ip.waitForURL(/\/signup/)
  await ip.getByLabel('Email').fill(inviteEmail)
  await ip.getByLabel('Password').fill(NEW_USER_PASSWORD)
  await ip.getByRole('button', { name: 'Create account' }).click()
  await ip.getByText('We sent a confirmation link to').waitFor()
  step('signed up as the invited address through the real signup page')

  const verifyKey = py('e2e_verify_key.py', inviteEmail)
  await ip.goto(`${BASE}/account/verify-email/${verifyKey}`)
  await ip.getByText('Your email is confirmed.').waitFor()
  // the invite page remembered itself in localStorage when "Create an account" was clicked
  await ip.getByRole('link', { name: 'Continue to your invitation' }).click()
  await ip.waitForURL(new RegExp(`/invite/${token}`))
  step('verified the email through the real confirmation screen, back at the invitation')

  await ip.getByText(`Signed in as ${inviteEmail}`).waitFor()
  await ip.getByRole('button', { name: 'Accept and join' }).click()
  await toast(ip, `Welcome to ${org.org_name}`)
  await ip.waitForURL(/\/learn$/)
  await ip.goto(BASE + '/learn/required')
  await ip.getByText('Fire Safety', { exact: true }).waitFor()
  await shot(ip, 'm3-06-required-training')
  step('accepted the invite; required training (company-wide "Fire Safety") shows for the new learner')

  // ================================================================ 5. assign a course to a unit -> notification + My learning
  // AssignPage: ?course= pre-selects the course and starts the stepper on step 2 ("People
  // and units"); the unit checkbox label is "<name> <people-count>", so match the name at
  // the start; the final step's button is "Assign course".
  await p.goto(`${BASE}/business/assign?course=${org.courses.hand.id}`)
  await p.getByRole('heading', { name: 'Assign training' }).waitFor()
  await p.getByRole('checkbox', { name: new RegExp(`^${esc('Leeds')}`) }).check()
  await p.getByRole('button', { name: 'Next', exact: true }).click()
  await p.getByText(/will get this course/).waitFor() // the dry-run count; Assign is disabled until it loads
  await p.getByRole('button', { name: 'Assign course' }).click()
  await p.getByText('Training assigned').waitFor()
  step('assigned Hand Hygiene to the Leeds unit')

  await ip.goto(BASE + '/learn')
  const bell = ip.getByRole('button', { name: /Notifications, \d+ unread/ })
  await bell.waitFor()
  await bell.click()
  await ip.getByText(/Hand Hygiene/).first().waitFor()
  await ip.goto(BASE + '/learn')
  await ip.getByText('Hand Hygiene').first().waitFor()
  await inviteCtx.close()
  step('the assigned member is notified and the course appears in My learning')

  // ================================================================ 6. a manager sees only their own unit
  await p.goto(BASE + '/business/units')
  await p.getByRole('heading', { name: 'Locations & teams' }).waitFor()
  await p.getByRole('button', { name: /^South/ }).click()
  await p.getByRole('button', { name: 'Assign managers' }).click()
  const managersSheet = p.getByRole('dialog', { name: 'Managers of South' })
  await managersSheet.getByLabel('Search people').fill(org.people.omar.name)
  await managersSheet.getByRole('checkbox', { name: new RegExp(esc(org.people.omar.name)) }).check()
  await managersSheet.getByRole('button', { name: 'Save managers' }).click()
  await toast(p, 'Managers saved')
  step('Omar made a manager of South')

  const mgrCtx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  const mp = track(await mgrCtx.newPage())
  await login(mp, org.people.omar.email)
  await openWorkspace(mp)
  await mp.goto(BASE + '/business/people')
  await mp.getByText(org.people.omar.name).first().waitFor()
  assert.strictEqual(await mp.getByText(org.people.sara.name).count(), 0, 'a manager must not see people outside their unit')
  assert.strictEqual(await mp.getByText(org.people.lee.name).count(), 0, 'a manager must not see people outside their unit')
  assert.strictEqual(await mp.getByRole('button', { name: 'Invite people' }).count(), 0, 'inviting is admin-only')
  await mp.goto(BASE + '/business/requirements')
  assert.strictEqual(await mp.getByRole('button', { name: 'New requirement' }).count(), 0, 'creating requirements is admin-only')
  await mp.goto(BASE + '/business/matrix')
  await mp.getByRole('button', { name: new RegExp(`${esc(org.people.omar.name)} ${dash} Fire Safety:`) }).click()
  const mgrSheet = mp.getByRole('dialog', { name: org.people.omar.name })
  await mgrSheet.waitFor()
  assert.strictEqual(await mgrSheet.getByRole('button', { name: 'Extend', exact: true }).count(), 0, 'a manager must not see Extend')
  assert.strictEqual(await mgrSheet.getByRole('button', { name: 'Exempt', exact: true }).count(), 0, 'a manager must not see Exempt')
  assert.strictEqual(await mgrSheet.getByRole('button', { name: 'Record completion' }).count(), 0, 'a manager must not see Record completion')
  await mgrSheet.getByRole('button', { name: 'Send reminder' }).waitFor()
  await shot(mp, 'm3-07-manager-scoped')
  await mgrCtx.close()
  step('manager: scoped to South, no admin-only buttons, can still remind')

  // ================================================================ 7. reports: CSV header + audit trail
  await p.goto(BASE + '/business/reports')
  await p.getByRole('heading', { name: 'Reports' }).waitFor()
  const [download] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Export CSV' }).click()])
  const csvPath = await download.path()
  const header = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/)[0]
  assert.strictEqual(header, 'Name,Email,Employee ref,Requirement,Status,Due (UTC),Completed,Expires')
  step('CSV export header row is correct')
  await p.getByRole('tab', { name: /Audit trail/ }).click()
  await p.getByText('Extended a due date').first().waitFor()
  await p.getByText('Granted an exemption').first().waitFor()
  await shot(p, 'm3-08-reports-audit')
  step('audit trail lists the actions taken above')

  // ================================================================ 8. billing shows seats; settings saves branding
  await p.goto(BASE + '/business/billing')
  await p.getByRole('heading', { name: 'Billing' }).waitFor()
  await p.getByRole('heading', { name: 'Seats' }).waitFor()
  await p.getByText(/\/ (no limit|\d+)/).first().waitFor()
  await shot(p, 'm3-09-billing')
  step('billing shows seats')

  await p.goto(BASE + '/business/settings')
  await p.getByRole('heading', { name: 'Company settings' }).waitFor()
  await p.getByLabel('Main colour', { exact: true }).fill('#1d4ed8')
  await p.getByRole('button', { name: 'Save branding' }).click()
  await toast(p, 'Branding saved')
  // the whole workspace (including this page) is wrapped in brandStyle(); the custom
  // property is inherited by descendants such as <header>.
  await p.waitForFunction(() => getComputedStyle(document.querySelector('header')).getPropertyValue('--brand-accent').trim() === '#1d4ed8')
  await shot(p, 'm3-10-settings-branding')
  step('branding saved and the workspace header picks up the new accent colour')

  // ================================================================ 9. a learner with no role is refused /business
  const learnerCtx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  const lp = track(await learnerCtx.newPage())
  await login(lp, org.people.lee.email)
  await lp.goto(BASE + '/business')
  await lp.waitForURL(/\/learn$/)
  step('a learner without a role is redirected away from /business')

  // ================================================================ 10. phone: matrix list + person sheet, no horizontal scroll
  const phone = await b.newContext({ ...devices['iPhone 13'], storageState: await ctx.storageState() })
  const mobile = track(await phone.newPage())
  const routes = ['/business', '/business/matrix', '/business/requirements', '/business/reports', '/business/people',
    `/business/people/${org.people.sara.member_id}`, '/business/units', '/business/invites', '/business/library',
    '/business/assign', '/business/billing', '/business/settings']  // fmt: skip
  let overflow = 0
  for (const route of routes) {
    await mobile.goto(BASE + route, { waitUntil: 'networkidle' })
    await mobile.waitForTimeout(600)
    const name = `m3-phone-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}`
    await mobile.screenshot({ path: `${OUT}/${name}.png` })
    const wide = await mobile.evaluate(() => document.scrollingElement.scrollWidth > window.innerWidth + 1)
    if (wide) { overflow++; console.log('  OVERFLOW on', route) }
  }
  // the matrix becomes a list of people with their worst status; tapping one opens the sheet
  await mobile.goto(BASE + '/business/matrix', { waitUntil: 'networkidle' })
  await mobile.getByRole('button', { name: new RegExp(org.people.sara.name) }).click()
  await mobile.getByRole('dialog', { name: org.people.sara.name }).waitFor()
  await mobile.waitForTimeout(400)
  await mobile.screenshot({ path: `${OUT}/m3-phone-matrix-person-sheet.png` })
  await phone.close()
  assert.strictEqual(overflow, 0, 'no horizontal scroll on any /business route on a phone')
  step('phone: matrix list view, person sheet, no route scrolls sideways')

  await b.close()
  if (problems.length) {
    console.log('PROBLEMS:\n' + problems.join('\n'))
    process.exit(1)
  }
  console.log('M3 E2E passed, no console errors or 5xx')
})().catch(async (e) => {
  console.error('FAILED:', e.message)
  if (global.__m3debug) await global.__m3debug.screenshot({ path: `${OUT}/m3-FAILED.png` }).catch(() => {})
  process.exit(1)
})
