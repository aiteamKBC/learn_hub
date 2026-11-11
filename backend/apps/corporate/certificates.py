"""B2B-07: Live training certificate framework.

Recorded certificates: reuse existing learning.issue_certificate() — no changes needed.
Certificate auto-issues on course completion for corporate enrollments as it does for personal.

Live certificates: BLOCKED until G01 (attendance threshold criteria) is resolved.
Raises ConfigurationBlocked on any attempt to issue a live certificate.
"""

from __future__ import annotations

from core.errors import ServiceError


class ConfigurationBlocked(ServiceError):
    """Raised when a feature requires a policy gate decision that hasn't been made."""

    def __init__(self, gate: str, message: str):
        super().__init__(
            code="configuration_blocked",
            message=f"[{gate}] {message}",
            status=501,
        )


def issue_live_certificate(enrollment_id, cohort_id) -> None:
    raise ConfigurationBlocked(
        "G01",
        "Live certificate criteria not resolved. "
        "Attendance threshold, tutor approval, or graded assessment? "
        "Owner decision required before live certificates can be issued.",
    )
