"""The platform switches the backend enforces (console > Settings). Staff always bypass.

* maintenance mode: every API call from anyone but staff gets 503 (sign-in, the public
  settings, the site banner, branding files and provider webhooks still work, so staff
  can sign in and the React app can show the maintenance page);
* guest browsing off: the catalogue API needs a signed-in person (401);
* instructor applications off: nobody new can apply to teach;
* 2-step sign-in switched off: nobody can turn it on (existing ones keep working);
* "staff must use 2-step sign-in": a staff member without it is refused on the console.

Runs after AuthenticationMiddleware and before TenantMiddleware. Settings are cached
(60 s, cleared at once when changed), so this costs no query on most requests.
"""

from django.http import JsonResponse

from .services import get_setting

OPEN_DURING_MAINTENANCE = (
    "/_allauth/",
    "/api/v1/platform/settings",
    "/api/v1/platform/banner",
    "/api/v1/platform/branding/",
    "/api/v1/platform/webhooks/",
    "/api/v1/commerce/webhooks/",
    "/api/v1/identity/me",
    "/api/v1/identity/csrf",
    "/api/docs",
    "/api/openapi.json",
)
CATALOGUE = "/api/v1/catalog/"
APPLY = "/api/v1/studio/instructor-profile"
MFA_SETUP = "/_allauth/browser/v1/account/authenticators/"
CONSOLE = "/api/v1/console/"


def _refuse(status: int, code: str, message: str) -> JsonResponse:
    return JsonResponse({"error": {"code": code, "message": message, "details": None}}, status=status)


class AccessSwitchMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path
        if not (path.startswith("/api/") or path.startswith("/_allauth/")):
            return self.get_response(request)
        user = getattr(request, "user", None)
        signed_in = bool(user and user.is_authenticated)
        is_staff = signed_in and user.is_staff
        if is_staff:
            if path.startswith(CONSOLE) and get_setting("security.mfa_required_for_staff"):
                from allauth.mfa.models import Authenticator

                if not Authenticator.objects.filter(user_id=user.id, type="totp").exists():
                    return _refuse(
                        403, "mfa_required", "Turn on 2-step sign-in in your account to use the console."
                    )
            return self.get_response(request)
        if get_setting("access.maintenance_mode") and not path.startswith(OPEN_DURING_MAINTENANCE):
            return _refuse(503, "maintenance", get_setting("access.maintenance_message"))
        if not signed_in and path.startswith(CATALOGUE) and not get_setting("access.guest_browsing"):
            return _refuse(401, "sign_in_required", "Sign in to browse courses.")
        if (
            signed_in
            and request.method == "POST"
            and path.startswith(APPLY)
            and not get_setting("access.instructor_applications")
        ):
            from apps.identity.models import InstructorProfile
            from core.tenancy import tenant_context

            with tenant_context(user_id=user.id):
                applied = (
                    InstructorProfile.objects.filter(user_id=user.id).exclude(status="rejected").exists()
                )
            if not applied:
                return _refuse(
                    403, "applications_closed", "We are not taking new instructor applications right now."
                )
        if (
            request.method in ("POST", "PUT")
            and path.startswith(MFA_SETUP)
            and not get_setting("security.mfa_enabled")
        ):
            return _refuse(403, "mfa_disabled", "2-step sign-in is switched off on this platform.")
        return self.get_response(request)
