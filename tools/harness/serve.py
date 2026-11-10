"""HARNESS ONLY: start everything the E2E scripts need, against the disposable e2e database.

    python tools/harness/serve.py          # start (leaves the processes running)

- Django on :8000 with Stripe replaced by a local fake (e2e_wsgi.py), served by waitress
  (works on Windows; `pip install waitress` into the backend venv once).
- A Celery worker when REDIS_URL is set (badges, emails).
- The built frontend on :5173 (`vite preview`, proxies /api to :8000).

Database URLs come from backend/.env.e2e (never the shared dev branch). The rest of the
settings come from backend/.env as usual. Nothing here prints a secret.
"""

import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
BACKEND, FRONTEND = ROOT / "backend", ROOT / "frontend"
WIN = os.name == "nt"
PY = next((BACKEND / d / s for d in ("venv", ".venv") for s in ("Scripts/python.exe", "bin/python") if (BACKEND / d / s).exists()), Path(sys.executable))


def e2e_env() -> dict:
    f = BACKEND / ".env.e2e"
    if not f.exists():
        sys.exit("backend/.env.e2e is missing - see tools/harness/README.md. E2E never uses the shared dev database.")
    env = {}
    for line in f.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip("'\"")
    if not env.get("DATABASE_URL") or not env.get("DATABASE_URL_OWNER"):
        sys.exit("backend/.env.e2e needs DATABASE_URL and DATABASE_URL_OWNER for the e2e branch.")
    return env


def up(url: str) -> bool:
    try:
        urllib.request.urlopen(url, timeout=2)
        return True
    except Exception:
        return False


def start(cmd, cwd, env, log):
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if WIN else 0
    out = open(HERE / log, "w")
    return subprocess.Popen(cmd, cwd=cwd, env=env, stdout=out, stderr=subprocess.STDOUT, creationflags=flags, start_new_session=not WIN)


env = {**os.environ, **e2e_env(), "PYTHONPATH": f"{BACKEND}{os.pathsep}{HERE}", "DJANGO_SETTINGS_MODULE": "config.settings.dev"}

if not up("http://127.0.0.1:8000/api/v1/identity/csrf"):
    start([str(PY), "-m", "waitress", "--listen=127.0.0.1:8000", "--threads=8", "e2e_wsgi:application"], BACKEND, env, "django.log")
def defines(key: str) -> bool:
    """Django reads backend/.env itself, so REDIS_URL is often not in this process's env.
    Only key names are checked here; no value is read out or printed."""
    if env.get(key):
        return True
    f = BACKEND / ".env"
    return f.exists() and any(
        line.split("=", 1)[0].strip() == key and line.split("=", 1)[1].strip().strip("'\"")
        for line in f.read_text(encoding="utf-8").splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    )


if defines("REDIS_URL"):  # Celery is eager without Redis; with it, a worker must run
    pool = ["--pool=solo"] if WIN else ["-c", "2"]
    start([str(PY), "-m", "celery", "-A", "config", "worker", "-l", "warning", *pool], BACKEND, env, "celery.log")
if not up("http://localhost:5173/"):
    npx = "npx.cmd" if WIN else "npx"
    subprocess.run([npx, "vite", "build"], cwd=FRONTEND, check=True)
    start([npx, "vite", "preview", "--port", "5173", "--strictPort"], FRONTEND, env, "vite.log")

for _ in range(40):
    if up("http://127.0.0.1:8000/api/v1/identity/csrf") and up("http://localhost:5173/"):
        print("harness up: http://localhost:5173 (logs in tools/harness/*.log)")
        break
    time.sleep(1)
else:
    sys.exit("harness did not start - see tools/harness/django.log and vite.log")
