"""HARNESS ONLY: stop what serve.py started (Django on :8000, vite preview on :5173, and
the harness Celery worker), so the next serve.py run picks up new code.

    python tools/harness/stop.py

Only processes listening on those two ports, plus Celery workers whose command line runs
from this repo's backend, are stopped; nothing else is touched."""

import os
import re
import subprocess
import sys
from pathlib import Path

BACKEND = str(Path(__file__).resolve().parents[2] / "backend").lower()
PORTS = (8000, 5173)


def pids_on_ports() -> set[int]:
    if os.name != "nt":
        out = subprocess.run(["lsof", "-ti", *[f"tcp:{p}" for p in PORTS], "-sTCP:LISTEN"], capture_output=True, text=True).stdout
        return {int(x) for x in out.split()}
    out = subprocess.run(["netstat", "-ano", "-p", "tcp"], capture_output=True, text=True).stdout
    found = set()
    for line in out.splitlines():
        m = re.match(r"\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)", line)
        if m and int(m.group(1)) in PORTS:
            found.add(int(m.group(2)))
    return found


def celery_pids() -> set[int]:
    if os.name != "nt":
        return set()
    cmd = ["powershell", "-NoProfile", "-Command",
           "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"]  # fmt: skip
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    found = set()
    for line in out.splitlines():
        pid, _, cmdline = line.partition("\t")
        low = cmdline.lower()
        if "celery" in low and "worker" in low and BACKEND in low and pid.strip().isdigit():
            found.add(int(pid))
    return found


pids = pids_on_ports() | celery_pids()
for pid in sorted(pids):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        os.kill(pid, 15)
print(f"stopped {len(pids)} harness process(es)" if pids else "nothing to stop")
sys.exit(0)
