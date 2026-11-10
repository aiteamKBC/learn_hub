// Phone overflow check + light/dark screenshots for every business route, as the admin of a
// fresh company built by e2e_org.py (no seeded password needed).
//   node phone_business.js <out folder> [extra routes...]
const { spawnSync } = require('child_process')
const path = require('path')
const { py, lastLine, NEW_USER_PASSWORD } = require('./lib')

const [OUT = '../../shots/phone', ...extra] = process.argv.slice(2)
const org = JSON.parse(lastLine(py('e2e_org.py', NEW_USER_PASSWORD)))
const routes = [
  '/business', '/business/matrix', '/business/requirements', '/business/reports', '/business/people',
  `/business/people/${org.people.sara.member_id}`, '/business/units', '/business/invites', '/business/library',
  '/business/assign', '/business/billing', '/business/settings', '/invite/not-a-real-token', ...extra,
]
const r = spawnSync(process.execPath, [path.join(__dirname, 'phone_check.js'), OUT, ...routes], {
  stdio: 'inherit',
  env: { ...process.env, E2E_DEMO_EMAIL: org.admin, E2E_DEMO_PASSWORD: NEW_USER_PASSWORD, E2E_DEMO_ORG: org.org_name },
})
process.exit(r.status ?? 1)
