"""HARNESS ONLY: run a manage.py command against the e2e Neon branch.

    python tools/harness/on_e2e.py showmigrations --database owner
    python tools/harness/on_e2e.py migrate --database owner

The database URLs come from backend/.env.e2e (as in serve.py); everything else from
backend/.env. Nothing here prints a connection string or any other secret."""

import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
PY = next(
    (
        BACKEND / d / s
        for d in ("venv", ".venv")
        for s in ("Scripts/python.exe", "bin/python")
        if (BACKEND / d / s).exists()
    ),
    Path(sys.executable),
)


def e2e_env() -> dict:
    f = BACKEND / ".env.e2e"
    if not f.exists():
        sys.exit("backend/.env.e2e is missing - see tools/harness/README.md.")
    env = {}
    for line in f.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip("'\"")
    if not env.get("DATABASE_URL") or not env.get("DATABASE_URL_OWNER"):
        sys.exit("backend/.env.e2e needs DATABASE_URL and DATABASE_URL_OWNER.")
    return env


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    env = {**os.environ, **e2e_env()}
    sys.exit(
        subprocess.call([str(PY), "manage.py", *sys.argv[1:]], cwd=BACKEND, env=env)
    )
