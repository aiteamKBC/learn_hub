// HARNESS ONLY: screenshots of every screen for the tester guide.
//   1) cd backend; python ..\tools\harness\tester_accounts.py > ..\shots\tester-accounts.json
//   2) $env:TESTER_PASSWORD = "<the seeded demo password>"
//   3) node tools\harness\tester_shots.js shots\tester shots\tester-accounts.json
// Needs the app running (runserver + npm run dev). Only navigates and switches tabs:
// it never submits a form, buys, deletes or sends anything. Waits 10 s before every shot.
const { chromium, devices } = require('playwright')
const fs = require('fs')
const path = require('path')
const { BASE } = require('./lib')

const [OUT = 'shots/tester', ACC = 'shots/tester-accounts.json'] = process.argv.slice(2)
const PASSWORD = process.env.TESTER_PASSWORD
if (!PASSWORD) throw new Error('set TESTER_PASSWORD (the seeded demo password)')
const acc = JSON.parse(fs.readFileSync(ACC, 'utf8'))
fs.mkdirSync(OUT, { recursive: true })
const WAIT = 10_000
const index = [] // {file, role, route, tab}
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50) || 'home'
let n = 0

async function shot(p, role, label, tab = '') {
  await p.waitForTimeout(WAIT)
  const file = `${String(++n).padStart(3, '0')}-${role}-${slug(label)}${tab ? '--' + slug(tab) : ''}.png`
  await p.screenshot({ path: path.join(OUT, file), fullPage: true })
  index.push({ file, role, route: new URL(p.url()).pathname + new URL(p.url()).search, label, tab })
  console.log('shot', file)
}

/** Screenshot the page, then every tab in its first visible tab list (one level). */
async function capture(p, role, label, { tabs = true } = {}) {
  await shot(p, role, label)
  if (!tabs) return
  const list = p.locator('main [role="tablist"]').first()
  if (!(await list.count())) return
  const names = (await list.locator('[role="tab"]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
  for (let i = 1; i < names.length; i++) {
    const name = names[i] || `tab ${i + 1}`
    try {
      await list.locator('[role="tab"]').nth(i).click({ timeout: 5000 })
      await shot(p, role, label, name)
    } catch (e) {
      console.log('  (tab skipped)', label, name, e.message.split('\n')[0])
    }
  }
}

async function visit(p, role, route, label = route, opts) {
  try {
    await p.goto(BASE + route, { waitUntil: 'domcontentloaded' })
    await capture(p, role, label, opts)
  } catch (e) {
    console.log('  (route failed)', route, e.message.split('\n')[0])
  }
}

/** Follow the first link on `from` whose href starts with `prefix` (and doesn't match `skip`). */
async function follow(p, role, from, prefix, label, skip = /$^/) {
  try {
    await p.goto(BASE + from, { waitUntil: 'domcontentloaded' })
    await p.waitForTimeout(WAIT)
    const hrefs = await p.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')))
    const href = hrefs.find((h) => h && h.startsWith(prefix) && !skip.test(h))
    if (!href) return console.log('  (no link)', prefix, 'on', from), null
    await visit(p, role, href, label)
    return href
  } catch (e) {
    console.log('  (follow failed)', prefix, e.message.split('\n')[0])
    return null
  }
}

async function session(b, email, opts = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await b.newContext(opts)
  await ctx.addInitScript(() => localStorage.setItem('theme', 'light'))
  const p = await ctx.newPage()
  if (email) {
    await p.goto(BASE + '/login')
    await p.getByLabel('Email').fill(email)
    await p.getByLabel('Password').fill(PASSWORD)
    await p.getByRole('button', { name: 'Log in' }).click()
    await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  }
  return { ctx, p }
}

;(async () => {
  const b = await chromium.launch()
  const company = acc.companies[0]
  const learner = acc.learners[0]?.email
  const staff = acc.staff.find((s) => s.email.startsWith('admin@'))?.email || acc.staff[0]?.email
  const teacher = acc.instructors.find((i) => i.email.startsWith('daniel.reeve'))?.email || acc.instructors[0]?.email
  const hr = company?.admins[0]?.email
  const manager = company?.managers[0]?.email
  const worker = company?.learners[0]?.email

  // ---------------- visitor (not signed in)
  {
    const { ctx, p } = await session(b, null)
    for (const r of ['/', '/courses', '/plans', '/verify', '/login', '/signup', '/this-page-does-not-exist'])
      await visit(p, 'visitor', r, r === '/this-page-does-not-exist' ? 'not-found' : r)
    await follow(p, 'visitor', '/courses', '/courses/', 'course-page')
    await ctx.close()
  }
  // ---------------- marketplace learner
  if (learner) {
    const { ctx, p } = await session(b, learner)
    for (const r of ['/learn', '/learn/certificates', '/learn/achievements', '/learn/required', '/notifications',
      '/wishlist', '/cart', '/account/orders', '/account', '/support', '/teach'])
      await visit(p, 'learner', r)
    await follow(p, 'learner', '/learn', '/learn/', 'player', /^\/learn\/(certificates|achievements|required)/)
    await follow(p, 'learner', '/support', '/support/', 'support-ticket')
    await follow(p, 'learner', '/learn/certificates', '/verify/', 'verify-certificate')
    await ctx.close()
    // phone views of the main learner screens
    const ph = await session(b, learner, devices['iPhone 14'])
    for (const r of ['/', '/courses', '/learn']) await visit(ph.p, 'learner-phone', r, r, { tabs: false })
    await follow(ph.p, 'learner-phone', '/learn', '/learn/', 'player', /^\/learn\/(certificates|achievements|required)/)
    await ph.ctx.close()
  }
  // ---------------- company admin (HR)
  if (hr) {
    const { ctx, p } = await session(b, hr)
    for (const r of ['/business', '/business/matrix', '/business/requirements', '/business/reports', '/business/people',
      '/business/units', '/business/invites', '/business/library', '/business/assign', '/business/billing', '/business/settings'])
      await visit(p, 'company-admin', r)
    await follow(p, 'company-admin', '/business/people', '/business/people/', 'person')
    await ctx.close()
  }
  // ---------------- company manager and company learner
  if (manager) {
    const { ctx, p } = await session(b, manager)
    for (const r of ['/business', '/business/matrix', '/business/people']) await visit(p, 'manager', r)
    await ctx.close()
  }
  if (worker) {
    const { ctx, p } = await session(b, worker)
    for (const r of ['/learn', '/learn/required']) await visit(p, 'company-learner', r)
    await ctx.close()
  }
  // ---------------- instructor
  if (teacher) {
    const { ctx, p } = await session(b, teacher)
    for (const r of ['/studio', '/studio/courses', '/studio/students', '/studio/grading', '/studio/questions',
      '/studio/revenue', '/studio/payouts'])
      await visit(p, 'instructor', r)
    const course = await follow(p, 'instructor', '/studio/courses', '/studio/courses/', 'course-builder-details')
    if (course) for (const t of ['curriculum', 'pricing', 'coupons', 'certificate', 'publish'])
      await visit(p, 'instructor', `${course.replace(/\/$/, '')}/${t}`, `course-builder-${t}`)
    await ctx.close()
  }
  // ---------------- platform staff (console)
  if (staff) {
    const { ctx, p } = await session(b, staff)
    for (const r of ['/console', '/console/courses', '/console/instructors', '/console/students', '/console/sales',
      '/console/subscriptions', '/console/pricing', '/console/promotions', '/console/commissions', '/console/payouts',
      '/console/reports', '/console/approvals', '/console/reviews', '/console/communications', '/console/certificates',
      '/console/companies', '/console/settings', '/console/audit'])
      await visit(p, 'staff', r)
    await ctx.close()
  }
  await b.close()
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1))
  console.log(`${index.length} screenshots in ${OUT}`)
})()
