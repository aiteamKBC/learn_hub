"""Run a long check quietly: full output goes to logs/<name>.log, only a short summary
is printed. Keeps Claude Code's context (and usage) small while tests run.

    python tools/run_check.py <name> -- <command ...>
    python tools/run_check.py backend-tests -- python manage.py test core apps --keepdb --noinput --cwd backend

Prints: PASS/FAIL, duration, the result lines (e.g. "Ran 102 tests", "OK") and, on failure,
only the failure headers and the end of the log. Exit code = the command's exit code.
Read logs/<name>.log yourself only when the summary is not enough, and then only the
part you need (e.g. search for the failing test name)."""

import re
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
ROOT = Path(__file__).resolve().parent.parent
args = sys.argv[1:]
if len(args) < 3 or args[1] != "--":
    sys.exit(__doc__)
name, cmd = args[0], args[2:]
cwd = ROOT
if "--cwd" in cmd:
    i = cmd.index("--cwd")
    cwd = ROOT / cmd[i + 1]
    cmd = cmd[:i] + cmd[i + 2 :]

logs = ROOT / "logs"
logs.mkdir(exist_ok=True)
log = logs / f"{name}.log"
start = time.time()
with log.open("w", encoding="utf-8", errors="replace") as out:
    code = subprocess.call(cmd, cwd=cwd, stdout=out, stderr=subprocess.STDOUT, shell=(sys.platform == "win32"))
secs = int(time.time() - start)
text = log.read_text(encoding="utf-8", errors="replace").splitlines()

KEY = re.compile(r"^(Ran \d+ tests|OK\b|FAILED|M\d+ E2E passed|no console errors|PROBLEMS|✓|FAILED:|OVERFLOW|ok\s{2,}|Found \d+ error|All checks passed|\d+ files? (already formatted|would be reformatted)|No changes detected|error TS|✓ built|dist/assets/index-)")
FAIL = re.compile(r"^(FAIL:|ERROR:|Traceback|FAILED|AssertionError|.*Error:|error TS|OVERFLOW|PROBLEMS)")
summary = [l for l in text if KEY.search(l.strip())][-25:]
print(f"{'PASS' if code == 0 else 'FAIL'}  {name}  ({secs // 60}m {secs % 60}s, exit {code})  full log: logs/{name}.log")
for l in summary:
    print("  " + l[:200])
if code != 0:
    fails = [l for l in text if FAIL.search(l.strip())][:30]
    if fails:
        print("  -- failures --")
        for l in fails:
            print("  " + l[:200])
    print("  -- end of log --")
    for l in text[-15:]:
        print("  " + l[:200])
sys.exit(code)
