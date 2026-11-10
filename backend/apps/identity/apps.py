from django.apps import AppConfig


class IdentityConfig(AppConfig):
    name = "apps.identity"
    label = "identity"
    verbose_name = "Identity"

    def ready(self):
        from . import signals  # noqa: F401  (session length, 2-step notices)
