"""Regenerate frontend/src/api/schema.d.ts from the backend, without a running server.

    python tools/gen_types.py        (with the backend venv active)

Dumps the OpenAPI document (tools/dump_openapi.py) and runs openapi-typescript on it.
The new file replaces the old one in one step, so a parallel `tsc` never reads half a
file. Prints nothing secret."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
subprocess.run([sys.executable, str(ROOT / "tools" / "dump_openapi.py")], check=True)
tmp = FRONTEND / "src" / "api" / f"schema.{os.getpid()}.tmp.d.ts"
cmd = ["npx", "--yes", "-p", "openapi-typescript@7.13.0", "-p", "typescript@5.9", "openapi-typescript",
       str(ROOT / "logs" / "openapi.json"), "-o", str(tmp)]  # fmt: skip
subprocess.run(cmd, cwd=FRONTEND, check=True, shell=(sys.platform == "win32"), stdout=subprocess.DEVNULL)
os.replace(tmp, FRONTEND / "src" / "api" / "schema.d.ts")
print("schema.d.ts updated")
