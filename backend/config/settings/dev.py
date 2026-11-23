import socket

from .base import *  # noqa: F401,F403
from .base import MIDDLEWARE

DEBUG = True

# Phones open the Vite dev server through this computer's current LAN address. DHCP can
# change that address between sessions, so trust the machine's active addresses
# automatically in development instead of leaving mobile sign-in tied to a stale IP.
_LAN_HOSTS = sorted(
    {
        info[4][0]
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
        if info[4][0] != "127.0.0.1"
    }
)
ALLOWED_HOSTS = list(dict.fromkeys([*ALLOWED_HOSTS, *_LAN_HOSTS]))
CORS_ALLOWED_ORIGINS = list(
    dict.fromkeys([*CORS_ALLOWED_ORIGINS, *(f"http://{host}:5173" for host in _LAN_HOSTS)])
)
CSRF_TRUSTED_ORIGINS = list(
    dict.fromkeys([*CSRF_TRUSTED_ORIGINS, *(f"http://{host}:5173" for host in _LAN_HOSTS)])
)

# Warn on N+1 queries and slow requests while developing (adds X-DB-Queries header).
MIDDLEWARE = [*MIDDLEWARE[:-1], "core.middleware.QueryBudgetMiddleware", MIDDLEWARE[-1]]

# Dev can run without built static files.
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
