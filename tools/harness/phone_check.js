// Phone overflow check + light/dark screenshots for the routes given on the command line.
//   node phone_check.js <out folder> /learn /account /business/matrix ...
// Signs in as the seeded demo admin (E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD); with
// E2E_DEMO_ORG set, switches to that company first (see phone_business.js).
const { chromium, devices } = require('playwright')
const fs = require('fs')
const { BASE, DEMO_EMAIL, DEMO_PASSWORD } = require('./lib')

const [OUT = 'shots/phone', ...routes] = process.argv.slice(2)
if (!routes.length) throw new Error('give at least one route, e.g. /learn')
if (!DEMO_PASSWORD) throw new Error('set E2E_DEMO_PASSWORD (ask the user)')
fs.mkdirSync(OUT, { recursive: true })

;(async () => {
  const b = await chromium.launch()
  const errors = []
  let overflow = 0
  for (const theme of ['light', 'dark']) {
    for (const [kind, opts] of [['phone', devices['iPhone 14']], ['desk', { viewport: { width: 1440, height: 900 } }]]) {
      const ctx = await b.newContext(opts)
      await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme)
      const p = await ctx.newPage()
      p.on('pageerror', (e) => errors.push(`${kind}/${theme}: ${e.message}`))
      p.on('console', (m) => m.type() === 'error' && !/status of (401|404)/.test(m.text()) && errors.push(`${kind}/${theme}: ${m.text()}`))
      await p.goto(BASE + '/login')
      await p.getByLabel('Email').fill(DEMO_EMAIL)
      await p.getByLabel('Password').fill(DEMO_PASSWORD)
      await p.getByRole('button', { name: 'Log in' }).click()
      await p.waitForURL(/learn|business/)
      if (process.env.E2E_DEMO_ORG) {
        // choose the company through the real account menu (same as a person would)
        await p.getByRole('button', { name: 'Account menu' }).click()
        await p.getByRole('menuitem', { name: `${process.env.E2E_DEMO_ORG} dashboard` }).click()
        await p.waitForURL(/\/business/)
      }
      for (const route of routes) {
        await p.goto(BASE + route, { waitUntil: 'networkidle' })
        await p.waitForTimeout(800) // let reveal / stagger animations settle
        const name = `${kind}-${theme}-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}`
        await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: kind === 'phone' })
        if (kind === 'phone') {
          const r = await p.evaluate(() => {
            const vw = document.documentElement.clientWidth
            const wide = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > vw + 1 && getComputedStyle(e).position !== 'fixed')
            const leaves = wide.filter((e) => ![...e.children].some((c) => wide.includes(c)))
            return { sw: document.documentElement.scrollWidth, vw, items: leaves.slice(0, 4).map((e) => e.tagName + '.' + (e.className?.toString?.() ?? '').slice(0, 80)) }
          })
          if (r.sw > r.vw) overflow++
          console.log(`${r.sw > r.vw ? 'OVERFLOW' : 'ok      '} ${theme.padEnd(5)} ${route}${r.sw > r.vw ? '  ' + JSON.stringify(r.items) : ''}`)
        }
      }
      await ctx.close()
    }
  }
  await b.close()
  console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors')
  console.log(`screenshots in ${OUT}`)
  process.exit(overflow || errors.length ? 1 : 0)
})()
