// Local, read-only page audit. Credentials come from the environment.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
(async () => {
  if (!process.env.AUDIT_EMAIL || !process.env.AUDIT_PASSWORD) throw Error('Set AUDIT_EMAIL and AUDIT_PASSWORD');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push({ type: 'javascript', message: e.message }));
  page.on('response', async r => { if (r.status() >= 500) { const body=await r.text().catch(()=> ''); const detail=body.match(/<pre class="exception_value">([\s\S]*?)<\/pre>/)?.[1] || body.slice(0,500); errors.push({type:'http', status:r.status(), url:r.url(),detail}); } });
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);
  console.log('HOME', (await page.locator('body').innerText()).slice(0,180));
  const login = await page.evaluate(async ({email,password}) => {
    await fetch('/api/v1/identity/csrf');
    const token = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)?.[1] || '';
    const response = await fetch('/_allauth/browser/v1/auth/login', {method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':decodeURIComponent(token)},body:JSON.stringify({email,password})});
    return {status:response.status};
  }, {email:process.env.AUDIT_EMAIL,password:process.env.AUDIT_PASSWORD});
  console.log('LOGIN', login);
  if (login.status !== 200) throw Error('Login failed');
  const routes = process.env.AUDIT_ROUTES ? process.env.AUDIT_ROUTES.split(',') : ['/', '/courses', '/plans', '/learn', '/account', '/console', '/console/courses', '/console/students', '/console/companies', '/console/pricing', '/console/subscriptions', '/console/reports', '/console/settings', '/console/workforce', '/business'];
  const pages=[];
  for (const route of routes) {
    const start=errors.length;
    await page.goto('http://localhost:5173'+route);
    await page.waitForTimeout(2500);
    const body=await page.locator('body').innerText();
    const result={route,url:page.url(),errors:errors.slice(start),message:body.match(/.{0,50}(Couldn't load|Something went wrong|Request failed|Not found).{0,120}/gi)};
    pages.push(result); console.log(JSON.stringify(result));
  }
  fs.mkdirSync('../../logs',{recursive:true});
  fs.writeFileSync('../../logs/runtime-audit.json',JSON.stringify({login,pages,errors},null,2));
  await browser.close();
  if (errors.length || pages.some(p => p.message)) process.exitCode = 1;
})().catch(e=>{console.error(e);process.exit(1)});
