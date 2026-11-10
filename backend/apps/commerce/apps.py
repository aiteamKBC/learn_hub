from django.apps import AppConfig


def _remember_buyer_country(sender, environ=None, scope=None, **kwargs):
    """Every request starts with the buyer's country (regional prices, pricing.py)."""
    from .pricing import BUYER_COUNTRY, country_from_headers

    if environ is not None:
        headers = environ
    elif scope is not None and scope.get("type") == "http":
        headers = {
            "HTTP_" + k.decode("latin-1").upper().replace("-", "_"): v.decode("latin-1")
            for k, v in scope.get("headers", [])
        }
    else:
        headers = {}
    BUYER_COUNTRY.set(country_from_headers(headers))


class CommerceConfig(AppConfig):
    name = "apps.commerce"
    label = "commerce"
    verbose_name = "Commerce"

    def ready(self):
        from django.core.signals import request_started

        request_started.connect(_remember_buyer_country, dispatch_uid="commerce.buyer_country")
