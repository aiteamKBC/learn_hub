"""Console: the platform staff back office. Mounted at /api/v1/console/.

Only staff accounts, and only on this path, get the staff RLS key (TenantMiddleware),
so staff powers never apply to ordinary pages. Every endpoint calls `common.staff` first,
and every change is written to the audit log. One module per console area (the nav).
Schema names start with `Console` (unique across the API).
"""

from . import (  # noqa: F401 - each module adds its routes to the shared router
    approvals,
    audit,
    certificates,
    commissions,
    communications,
    companies,
    courses,
    dashboard,
    moderation,
    payouts,
    people,
    platform_settings,
    pricing,
    promotions,
    reports,
    sales,
    search,
    subscriptions,
)
from .common import router

__all__ = ["router"]
