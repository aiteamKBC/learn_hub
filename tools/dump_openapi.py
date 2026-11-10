"""Write the OpenAPI document to logs/openapi.json without running the server (used by
/sync-types). Run with the backend venv's python; it prints nothing secret."""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
os.chdir(ROOT / "backend")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

import django  # noqa: E402

django.setup()
from core.api import api  # noqa: E402

(ROOT / "logs").mkdir(exist_ok=True)
(ROOT / "logs" / "openapi.json").write_text(json.dumps(api.get_openapi_schema(), default=str))
print("written")
