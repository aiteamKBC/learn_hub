"""Short cache for the public catalogue (course lists and categories).

The catalogue is read far more than it changes, and every query goes to a remote
database, so a page of courses is kept for a minute. The key includes the company
context (private courses are visible only inside their company), the currency and the
full query string. Any save or delete of a catalogue or company-offering row bumps a
version number, so admins and instructors see their change straight away.
"""

from __future__ import annotations

import hashlib
from functools import wraps

from django.core.cache import cache

TTL = 60
VERSION_KEY = "catalog-cache:version"
# models whose changes show in course cards: courses, prices, categories, offerings...
WATCHED_APPS = ("catalog",)
WATCHED_MODELS = (("corporate", "CorporateOffering"), ("corporate", "LiveCourseTerms"))


def _version() -> int:
    v = cache.get(VERSION_KEY)
    if v is None:
        cache.add(VERSION_KEY, 1, timeout=None)
        v = cache.get(VERSION_KEY) or 1
    return v


def bump(*_args, **_kwargs) -> None:
    """Clear the catalogue cache once the change is committed (so nobody re-caches the
    old rows in between). Call it after bulk .update() calls too: they send no signals."""
    from django.db import transaction

    transaction.on_commit(_bump_now)


def _bump_now() -> None:
    try:
        cache.incr(VERSION_KEY)
    except ValueError:  # not set yet
        cache.set(VERSION_KEY, 2, timeout=None)


def cached(prefix: str):
    """Cache an anonymous-safe endpoint's result per company, currency and query."""

    def deco(fn):
        @wraps(fn)
        def wrapper(request, *args, **kwargs):
            org = getattr(request, "org_id", None) or "-"
            user = getattr(request, "user", None)
            cur = (getattr(user, "preferred_currency", "") if user and user.is_authenticated else "") or ""
            raw = f"{org}|{cur}|{request.get_full_path()}"
            key = f"catalog:{prefix}:{_version()}:{hashlib.sha1(raw.encode()).hexdigest()}"  # noqa: S324
            hit = cache.get(key)
            if hit is not None:
                return hit
            out = fn(request, *args, **kwargs)
            if not isinstance(out, dict | list):  # querysets: make them plain before caching
                out = list(out)
            cache.set(key, out, TTL)
            return out

        return wrapper

    return deco


def connect() -> None:
    from django.apps import apps
    from django.db.models.signals import post_delete, post_save

    models = [m for a in WATCHED_APPS for m in apps.get_app_config(a).get_models()]
    models += [apps.get_model(a, m) for a, m in WATCHED_MODELS]
    for m in models:
        post_save.connect(bump, sender=m, dispatch_uid=f"catalog-cache-{m._meta.label}-save")
        post_delete.connect(bump, sender=m, dispatch_uid=f"catalog-cache-{m._meta.label}-del")
