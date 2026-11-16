"""Private file storage on Azure Blob.

The browser never sees a key. The app signs in as its own Entra app registration
(client credentials, role "Storage Blob Data Contributor" on the storage account),
asks Azure for a user delegation key, and signs short-lived SAS links with it:

    upload_url(path)    PUT only, 15 minutes, for one blob
    download_url(path)  GET only, 1 hour, optional download file name

Tokens and the delegation key are cached; nothing here is ever logged.
"""

import base64
import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from urllib.parse import quote, urlencode

import httpx
from django.conf import settings
from django.core.cache import cache

API_VERSION = "2022-11-02"
TOKEN_KEY = "storage:azure:token"  # noqa: S105 - a cache key name
DELEGATION_KEY = "storage:azure:udk"


class StorageNotConfigured(RuntimeError):
    pass


def _cfg() -> dict:
    cfg = settings.AZURE_STORAGE
    missing = [
        k for k in ("ACCOUNT", "CONTAINER", "TENANT_ID", "CLIENT_ID", "CLIENT_SECRET") if not cfg.get(k)
    ]
    if missing:
        raise StorageNotConfigured("AZURE_STORAGE settings missing: " + ", ".join(missing))
    return cfg


def configured() -> bool:
    try:
        _cfg()
    except StorageNotConfigured:
        return False
    return True


def account_url() -> str:
    return f"https://{_cfg()['ACCOUNT']}.blob.core.windows.net"


def blob_url(path: str) -> str:
    return f"{account_url()}/{_cfg()['CONTAINER']}/{quote(path)}"


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


transport = None  # tests inject an httpx.MockTransport


def client() -> httpx.Client:
    return httpx.Client(timeout=20, transport=transport)


def token(http: httpx.Client) -> str:
    cached = cache.get(TOKEN_KEY)
    if cached:
        return cached
    cfg = _cfg()
    r = http.post(
        f"https://login.microsoftonline.com/{cfg['TENANT_ID']}/oauth2/v2.0/token",
        data={
            "client_id": cfg["CLIENT_ID"],
            "client_secret": cfg["CLIENT_SECRET"],
            "scope": "https://storage.azure.com/.default",
            "grant_type": "client_credentials",
        },
    )
    r.raise_for_status()
    body = r.json()
    cache.set(TOKEN_KEY, body["access_token"], timeout=max(60, int(body.get("expires_in", 3600)) - 300))
    return body["access_token"]


def auth_headers(http: httpx.Client) -> dict:
    return {"Authorization": f"Bearer {token(http)}", "x-ms-version": API_VERSION}


def _delegation_key(http: httpx.Client) -> dict:
    cached = cache.get(DELEGATION_KEY)
    if cached:
        return cached
    now = datetime.now(UTC)
    start, expiry = now - timedelta(minutes=5), now + timedelta(days=2)
    body = f"<?xml version='1.0' encoding='utf-8'?><KeyInfo><Start>{_iso(start)}</Start><Expiry>{_iso(expiry)}</Expiry></KeyInfo>"
    r = http.post(
        f"{account_url()}/?restype=service&comp=userdelegationkey", headers=auth_headers(http), content=body
    )
    r.raise_for_status()
    import xml.etree.ElementTree as ET  # noqa: S405 - response from Azure over TLS

    root = ET.fromstring(r.text)  # noqa: S314
    key = {tag: root.findtext(tag) for tag in (
        "SignedOid", "SignedTid", "SignedStart", "SignedExpiry", "SignedService", "SignedVersion", "Value")}  # fmt: skip
    cache.set(DELEGATION_KEY, key, timeout=int(timedelta(days=1).total_seconds()))
    return key


def _sas(path: str, permissions: str, lifetime: timedelta, filename: str | None = None) -> str:
    cfg = _cfg()
    with client() as http:
        key = _delegation_key(http)
    now = datetime.now(UTC)
    st, se = _iso(now - timedelta(minutes=5)), _iso(now + lifetime)
    rscd = f'attachment; filename="{filename}"' if filename else ""
    resource = f"/blob/{cfg['ACCOUNT']}/{cfg['CONTAINER']}/{path}"
    to_sign = "\n".join([
        permissions, st, se, resource,
        key["SignedOid"], key["SignedTid"], key["SignedStart"], key["SignedExpiry"],
        key["SignedService"], key["SignedVersion"],
        "", "", "",  # authorized oid, unauthorized oid, correlation id
        "", "https", API_VERSION, "b", "", "",  # ip, protocol, version, resource, snapshot, encryption scope
        "", rscd, "", "", "",  # rscc, rscd, rsce, rscl, rsct
    ])  # fmt: skip
    sig = base64.b64encode(
        hmac.new(base64.b64decode(key["Value"]), to_sign.encode(), hashlib.sha256).digest()
    ).decode()
    params = {
        "sp": permissions, "st": st, "se": se,
        "skoid": key["SignedOid"], "sktid": key["SignedTid"], "skt": key["SignedStart"],
        "ske": key["SignedExpiry"], "sks": key["SignedService"], "skv": key["SignedVersion"],
        "sv": API_VERSION, "sr": "b", "spr": "https",
        **({"rscd": rscd} if rscd else {}),
        "sig": sig,
    }  # fmt: skip
    return f"{blob_url(path)}?{urlencode(params, quote_via=quote)}"


def upload_url(path: str) -> str:
    """Create-or-write a single blob for 15 minutes."""
    return _sas(path, "cw", timedelta(minutes=15))


def download_url(path: str, filename: str | None = None) -> str:
    return _sas(path, "r", timedelta(hours=1), filename)


def properties(path: str) -> dict | None:
    """Size and type of an uploaded blob, or None when nothing was uploaded."""
    with client() as http:
        r = http.head(blob_url(path), headers=auth_headers(http))
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return {
        "size": int(r.headers.get("content-length", 0)),
        "content_type": r.headers.get("content-type", ""),
    }


def read(path: str, limit: int) -> bytes:
    """The first `limit` bytes of a blob (to check what an upload really is)."""
    with client() as http:
        r = http.get(blob_url(path), headers={**auth_headers(http), "x-ms-range": f"bytes=0-{limit - 1}"})
    r.raise_for_status()
    return r.content[:limit]


def delete(path: str) -> None:
    with client() as http:
        r = http.delete(blob_url(path), headers=auth_headers(http))
        if r.status_code not in (202, 404):
            r.raise_for_status()
