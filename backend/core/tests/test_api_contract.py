"""The API contract the frontend is generated from. Two request/response classes with
the same name collide in the OpenAPI document (one silently replaces the other), which
gives the frontend wrong types for an endpoint. Names must be unique across the API."""

import ast
from collections import defaultdict
from pathlib import Path

from django.test import SimpleTestCase

from core.api import api

ROOT = Path(__file__).resolve().parents[2]
BASES = {"Schema", "ModelSchema"}


class ApiContractTest(SimpleTestCase):
    def test_schema_class_names_are_unique(self):
        seen = defaultdict(list)
        known = set(BASES)
        files = sorted([*ROOT.glob("apps/**/*.py"), *ROOT.glob("core/*.py")])
        for _ in range(3):  # also catch subclasses of our own schemas
            for path in files:
                if "migrations" in path.parts or "tests" in path.parts:
                    continue
                for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                    if isinstance(node, ast.ClassDef) and any(
                        getattr(b, "id", None) in known for b in node.bases
                    ):
                        known.add(node.name)
        for path in files:
            if "migrations" in path.parts or "tests" in path.parts:
                continue
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if isinstance(node, ast.ClassDef) and any(
                    getattr(b, "id", None) in known for b in node.bases
                ):
                    seen[node.name].append(str(path.relative_to(ROOT)))
        dupes = {name: where for name, where in seen.items() if len(where) > 1}
        self.assertEqual(dupes, {})


# Areas whose screens are built: every operation must declare its response shape, so
# the generated frontend types can never drift from what the server returns. Each
# milestone adds its areas here.
TYPED_PREFIXES = (
    "/api/v1/commerce/", "/api/v1/catalog/", "/api/v1/compliance/dashboard", "/api/v1/compliance/summary",  # M1
    "/api/v1/learning/", "/api/v1/engagement/", "/api/v1/identity/", "/api/v1/compliance/my",  # M2
    "/api/v1/org/", "/api/v1/compliance/",  # M3
    "/api/v1/studio/",  # M4
    "/api/v1/console/", "/api/v1/platform/", "/api/v1/payouts/",  # M5
    "/api/v1/corporate/",  # B2B
)  # fmt: skip
NOT_JSON = {  # files and webhooks
    "/api/v1/commerce/webhooks/stripe",
    "/api/v1/learning/certificates/{certificate_id}/pdf",
    "/api/v1/compliance/export.csv",
    "/api/v1/console/reports/export.csv",
    "/api/v1/console/certificates/templates/{template_id}/preview.pdf",
    "/api/v1/console/certificates/issued.csv",
    "/api/v1/console/certificates/{certificate_id}/pdf",
}


def ok_schema(op: dict):
    responses = op.get("responses", {})
    ok = responses.get(200) or responses.get("200") or {}
    return ok.get("content", {}).get("application/json", {}).get("schema")


class TypedResponsesTest(SimpleTestCase):
    def test_built_areas_declare_every_response(self):
        missing = [
            f"{method.upper()} {path}"
            for path, ops in api.get_openapi_schema()["paths"].items()
            if path.startswith(TYPED_PREFIXES) and path not in NOT_JSON
            for method, op in ops.items()
            if not ok_schema(op)
        ]
        self.assertEqual(missing, [])
