"""API root. Every domain app exposes `router` in apps/<domain>/api.py,
mounted here under /api/v1/<domain>/.
"""

import json

from django.conf import settings
from django.core.cache import cache
from django.db import connections
from ninja import NinjaAPI, Swagger
from ninja.openapi.docs import render_template

from core.errors import register_error_handlers
from core.renderers import ORJSONRenderer
from core.throttles import DEFAULT_THROTTLES


class SessionSwagger(Swagger):
    """Dev-only docs that send the CSRF token on writes. Ninja adds it only when the whole
    API has a CSRF auth; ours is set per router, so its check never sees it."""

    def render_page(self, request, api, **kwargs):
        self.settings["url"] = self.get_openapi_url(api, kwargs)
        context = {"swagger_settings": json.dumps(self.settings, indent=1), "api": api, "add_csrf": True}
        return render_template(request, self.template, self.template_cdn, context)


api = NinjaAPI(
    title="LMS API",
    version="1.0.0",
    urls_namespace="api",
    docs_url="/docs" if settings.DEBUG else None,  # no public API docs in production
    docs=SessionSwagger(),
    renderer=ORJSONRenderer(),
    throttle=DEFAULT_THROTTLES,
)
register_error_handlers(api)


@api.get("/v1/health", tags=["platform"], auth=None, throttle=[])
def health(request):
    """Liveness: the process is up. No dependencies checked (cheap, for the load balancer)."""
    return {"status": "ok"}


@api.get("/v1/ready", tags=["platform"], auth=None, throttle=[], response={200: dict, 503: dict})
def ready(request):
    """Readiness: database and cache reachable. Deploys wait for this before taking traffic."""
    checks = {}
    try:
        with connections["default"].cursor() as cur:
            cur.execute("SELECT 1")
        checks["database"] = "ok"
    except Exception:  # noqa: BLE001
        checks["database"] = "down"
    try:
        cache.set("ready:probe", 1, timeout=5)
        checks["cache"] = "ok" if cache.get("ready:probe") == 1 else "down"
    except Exception:  # noqa: BLE001
        checks["cache"] = "down"
    healthy = all(v == "ok" for v in checks.values())
    return (200 if healthy else 503), {"status": "ok" if healthy else "degraded", "checks": checks}


def _mount_domain_routers() -> None:
    from importlib import import_module

    for dotted in settings.DOMAIN_APPS:
        label = dotted.rsplit(".", 1)[-1]
        module = import_module(f"{dotted}.api")
        api.add_router(f"/v1/{label}/", module.router)
    # cross-domain areas with their own permission model
    from apps.catalog.studio import router as studio

    api.add_router("/v1/studio/", studio)
    from apps.platform.console import router as console

    api.add_router("/v1/console/", console)


_mount_domain_routers()
