# LMS demo

Udemy-style marketplace + business compliance workspace.
Django 5.2 (LTS) + Django Ninja API, React 19 + Vite frontend, Neon Postgres 18, Bunny Stream video.

```
lms-demo/
  backend/     Django project (API at /api, admin at /admin)
  frontend/    React + Vite + TypeScript
  db/          SQL applied outside Django (foundation: schemas, roles, grants)
  docs/        Structure and conventions
```

## First-time setup (Windows, PowerShell)

### Backend
```powershell
cd backend
py -3.12 -m venv .venv          # Python 3.12+ required
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
copy .env.example .env          # then fill in the Neon URLs and passwords
python manage.py check
```

Optional but recommended: Redis for cache, sessions, rate limits and background jobs.
```powershell
docker compose up -d redis      # then set REDIS_URL=redis://localhost:6379/0 in backend\.env
celery -A config worker -l info --pool=solo   # --pool=solo is needed on Windows
celery -A config beat -l info                 # the timetable: video progress every minute, outbox every 30 s, nightly jobs
```
Without Redis everything still runs: in-memory cache, database sessions, and tasks run inline.

Migrations always go through the **owner** connection (direct host, `lms_owner`):
```powershell
python manage.py makemigrations
python manage.py migrate --database owner
python manage.py createsuperuser --database owner
python manage.py runserver      # http://localhost:8000/api/docs
```

### Frontend
```powershell
cd frontend
npm install
npm run dev                     # http://localhost:5173 (proxies /api to :8000)
npm run gen:api                 # regenerate TypeScript types from the API (server running)
```

## Database connections

| Alias | Host | Role | Used for |
|---|---|---|---|
| `default` | Neon **pooled** (`-pooler`) | `lms_app` | The running app. Cannot bypass RLS, cannot change tables |
| `owner` | Neon **direct** | `lms_owner` | `migrate` only |

Always run migrations on the `dev` branch first, then `production`.

## Built-in safeguards

| Area | What is in place |
|---|---|
| Security | Production settings refuse to start if unsafe; HTTPS, HSTS, secure cookies; Argon2 passwords; session + CSRF auth; login rate limit; global API rate limits; RLS tenant isolation; webhook HMAC checks; 5 MB request limit; no API docs in production |
| Performance | orjson responses; keyset pagination; optional read replica (`core.db.replica()`); versioned cache helper; Redis sessions; dev warning header `X-DB-Queries` when a request exceeds the query budget |
| Scalability | Stateless web tier (Gunicorn); Celery workers scale separately; `/api/v1/health` (liveness) and `/api/v1/ready` (database + cache); request IDs on every log line |
| Quality | Ruff lint/format, pre-commit hooks with secret scanning (gitleaks), GitHub Actions CI |

Before the first commit: `pip install pre-commit` and `pre-commit install` in the repo root.
