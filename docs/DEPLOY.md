# Deploying LearnHub to production

Production is **learnhub.abcsolutions.ai** on a VPS at **72.62.133.105**, reached over SSH
as `root`. LiteSpeed serves the built frontend and proxies `/api`, `/_allauth`, `/admin`,
`/static` and `/media` to Django. The database is a Neon **production** branch — a different
branch from dev, with its own credentials in the server's `backend/.env`.

There is no deploy automation. CI (`.github/workflows/ci.yml`) only lints, checks and builds.

---

## Before you start

Find these out on the server once and note them here for next time:

```bash
ssh root@72.62.133.105

# Where the site lives (look for the directory holding index.html + assets/)
ls /var/www /home/*/public_html /usr/local/lsws/*/html 2>/dev/null

# Where Django lives and how it is started
systemctl list-units --type=service | grep -iE "gunicorn|learnhub|django|lsws"
ps aux | grep -E "gunicorn|lswsgi" | grep -v grep
```

Fill in once known:

- Frontend web root: `________`
- Backend checkout: `________`
- Django service name: `________`

---

## 1. Fix `DEBUG=True` first

Production is currently running with `DEBUG` on. The 404 page publishes the whole URL map,
and any unhandled exception renders a traceback with settings values in it. Treat this as the
first change, independent of the code update.

On the server, in the backend's `.env`:

```
DJANGO_SETTINGS_MODULE=config.settings.prod
DJANGO_DEBUG=0
```

`config/settings/prod.py` refuses to start when anything security-critical is missing, so
expect it to complain the first time. Each message names exactly what to set. The values it
insists on:

- `DJANGO_SECRET_KEY` — random, 50+ characters
- `DJANGO_ALLOWED_HOSTS` — `learnhub.abcsolutions.ai`
- `REDIS_URL` — required in production (cache, sessions, rate limits, Celery)
- `DATABASE_URL` — Neon **pooled** host (`-pooler`), role `lms_app`
- `DATABASE_URL_OWNER` — Neon **direct** host (no `-pooler`), role `lms_owner`
- `FRONTEND_URL` — `https://learnhub.abcsolutions.ai` (every email link uses it)
- `STRIPE_WEBHOOK_SECRET` — required whenever `STRIPE_SECRET_KEY` is set
- `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` — `https://learnhub.abcsolutions.ai`

Verify before restarting:

```bash
cd <backend>
source venv/bin/activate
DJANGO_SETTINGS_MODULE=config.settings.prod python manage.py check --deploy
```

---

## 2. Back up

Neon keeps history, but take a restore point you can name:

- Neon console → the **production** branch → create a branch from "now", call it
  `pre-deploy-<date>`. That is the rollback for the database.

And on the server:

```bash
cd <web root>/.. && tar czf ~/frontend-backup-$(date +%F).tar.gz <web root>
cd <backend>  && git rev-parse HEAD > ~/backend-sha-$(date +%F).txt
```

Write down the current frontend bundle name so you can confirm the swap later. Today it is
`index-CKPHxJ9h.js` (built 10 November).

---

## 3. Deploy the backend

Order matters: **migrations run before the new code is serving**, because the new code
expects the new tables.

```bash
cd <backend>
git fetch origin && git checkout main && git pull
source venv/bin/activate
pip install -r requirements.txt
```

Check what is pending — this is the real list, not a guess:

```bash
python manage.py showmigrations --database owner | grep -v "\[X\]"
```

Expect these nine, all additive (new tables, columns and rows only):

| App | Migration |
|---|---|
| commerce | `0011_b2c_course_instalments` |
| commerce | `0012_plan_live_seat_cap` |
| commerce | `0013_plan_live_seat_cap_effective_at` |
| engagement | `0009_course_instalment_notice` |
| learning | `0006_fixed_instalment_enrollment_source` |
| corporate | `0016_recorded_stage_instalments` |
| corporate | `0018_partial_staged_settlement` |
| corporate | `0019_provider_neutral_stage_payments` |
| corporate | `0020_team_live_included_bookings` |

Read the SQL before running it. Neon production may only **gain** tables, columns and rows —
if `sqlmigrate` shows a `DROP`, an `ALTER ... TYPE` or a rewrite, stop and ask:

```bash
python manage.py sqlmigrate commerce 0011 --database owner   # repeat per migration
```

Then apply. Migrations go through the **owner** connection, and never with `--fake`:

```bash
python manage.py migrate --database owner
python manage.py collectstatic --noinput
```

Restart Django and confirm it came back:

```bash
systemctl restart <service>     # or: touch tmp/restart.txt for LSAPI/Passenger
systemctl status <service> --no-pager
```

---

## 4. Deploy the frontend

Built locally with `npm run build` in `frontend/`. No environment variables are needed:
`src/lib/env.ts` falls back to an empty `API_BASE_URL`, so the app calls its own origin.

**Do not delete `.htaccess`.** It is not part of the build, and it carries both the rules that
send `/api` and `/_allauth` to Django and the single-page-app fallback that makes `/login` and
email links work. Deleting it takes the whole site down.

From your machine:

```bash
cd frontend && npm run build
scp -r dist/* root@72.62.133.105:<web root>/
```

Safer, because it removes stale hashed chunks without touching `.htaccess`:

```bash
rsync -av --delete --exclude='.htaccess' frontend/dist/ root@72.62.133.105:<web root>/
```

---

## 5. Verify

```bash
# New bundle is being served (must NOT be index-CKPHxJ9h.js)
curl -s https://learnhub.abcsolutions.ai/ | grep -o 'index-[^."]*\.js'

# SPA deep links still work — this proves .htaccess survived
curl -o /dev/null -w "%{http_code}\n" https://learnhub.abcsolutions.ai/login

# API is up and now has the new endpoints (expect ~452 paths, not 322)
curl -s https://learnhub.abcsolutions.ai/api/openapi.json \
  | python -c "import json,sys; d=json.load(sys.stdin); p=list(d['paths']); \
print(len(p), 'paths;', len([x for x in p if 'instalment' in x]), 'instalment;', \
len([x for x in p if 'pricing/token' in x]), 'token pricing')"

# DEBUG is off: this must be a plain 'Not Found', with no URL list
curl -s https://learnhub.abcsolutions.ai/api/v1/zzz | head -5
```

Then click through by hand: log in, open a course, start a lecture (Bunny video), and
check the admin console loads.

---

## 6. Rollback

- **Frontend** — unpack the tar from step 2 over the web root.
- **Backend** — `git checkout <sha from step 2>`, `pip install -r requirements.txt`, restart.
- **Database** — the migrations are additive, so old code runs fine against the new schema.
  Leave them. Only if something is genuinely wrong, restore the Neon `pre-deploy-<date>` branch.

---

## Still outstanding after this deploy

From `docs/build-status.md`, unrelated to the code but needed for features to work end to end:

- **Azure Blob CORS** — storage account → Resource sharing (CORS) → Blob service: allow
  `https://learnhub.abcsolutions.ai`, methods PUT/GET/HEAD, headers `*`. Without it, browser
  file uploads fail (assignment hand-ins, studio files).
- **Bunny allowed referrers** — add `learnhub.abcsolutions.ai` to the pull zone, or video
  thumbnails stay blank.
- **Stripe webhook** — already pointed at
  `https://learnhub.abcsolutions.ai/api/v1/commerce/webhooks/stripe`; confirm the signing
  secret on the server matches that endpoint.
- **Google / Microsoft sign-in** — the app registrations need
  `https://learnhub.abcsolutions.ai` as a redirect URI; the buttons appear once the client
  IDs are set.
