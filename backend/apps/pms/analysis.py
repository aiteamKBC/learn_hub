"""Review AI analysis.

`generate` assembles a context snapshot for a review (scores, gaps, objectives) and
turns it into a short development narrative. Two back-ends:

  * Claude API — used only when the `anthropic` SDK is installed AND an API key is
    configured. Model: `claude-opus-5-5`.
  * Heuristic — a deterministic, rule-based analyser used otherwise. It produces a
    genuinely useful summary from the numbers, so the feature works end to end with
    no external dependency or key.

Per decision P5 this never raises into the request: any Claude error falls back to the
heuristic, and if even that cannot run the row is saved with status `failed`.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import PerformanceReview, ReviewAnalysis

log = logging.getLogger(__name__)

HEURISTIC_MODEL = "heuristic-local-1"
CLAUDE_MODEL = "claude-opus-5-5"


# ---------------------------------------------------------------- context
def build_context(*, org_id: UUID, review: PerformanceReview) -> dict:
    """A JSON-safe snapshot of what the analysis reasons over."""
    from apps.frameworks.scoring import evidenced_levels

    member = review.member
    gaps = []
    try:
        levels = evidenced_levels(org_id=org_id, user_id=member.user_id)
        # Report competencies evidenced below Practitioner (3) as development areas.
        from apps.frameworks.models import Competency

        if levels:
            comps = {str(c.id): c for c in Competency.objects.filter(id__in=list(levels.keys()))}
            for cid, level in levels.items():
                c = comps.get(cid)
                if c and level < 3:
                    gaps.append({"code": c.code, "name": c.name, "level": level})
    except Exception:  # pragma: no cover - evidence is best-effort context
        log.exception("evidence context failed for review %s", review.id)

    objectives = [
        {"title": o.title, "status": o.status, "progress_pct": o.progress_pct, "priority": o.priority}
        for o in review.objectives.all()
    ]
    return {
        "competence_score": _f(review.competence_score),
        "kpi_score": _f(review.kpi_score),
        "wellbeing_score": _f(review.wellbeing_score),
        "overall_rating": review.overall_rating,
        "gaps": gaps,
        "objectives": objectives,
        "strengths_note": review.strengths,
        "development_note": review.development_areas,
    }


def _f(v):
    return None if v is None else float(v)


# ---------------------------------------------------------------- heuristic
def _heuristic(ctx: dict) -> dict:
    strengths: list[str] = []
    development: list[str] = []
    actions: list[str] = []

    comp = ctx.get("competence_score")
    kpi = ctx.get("kpi_score")
    wb = ctx.get("wellbeing_score")

    if comp is not None:
        if comp >= 70:
            strengths.append(f"Strong evidenced competence ({comp:.0f}/100).")
        elif comp < 50:
            development.append(f"Competence evidence is low ({comp:.0f}/100); build workplace evidence.")
            actions.append("Agree two competencies to evidence next quarter with the line manager.")
    if kpi is not None:
        if kpi >= 80:
            strengths.append(f"KPIs are on track ({kpi:.0f}% attainment).")
        elif kpi < 60:
            development.append(f"KPI attainment is behind target ({kpi:.0f}%).")
            actions.append("Review the lowest-attainment KPI and set a recovery action with a date.")
    if wb is not None and wb < 55:
        development.append(f"Wellbeing is low ({wb:.0f}/100); check workload and support.")
        actions.append("Hold a supportive one-to-one focused on workload and wellbeing.")

    for g in ctx.get("gaps", [])[:3]:
        development.append(f"{g['code']} {g['name']} evidenced at level {g['level']} — below Practitioner.")
        actions.append(f"Complete a course or task that evidences {g['code']} at level 3+.")

    open_objs = [o for o in ctx.get("objectives", []) if o["status"] == "open"]
    if open_objs:
        actions.append(f"Progress {len(open_objs)} open objective(s) before the next cycle.")

    if not strengths:
        strengths.append("Engaged with the review process and recorded their own reflections.")
    if not development:
        development.append("No pressing development gap in the data; keep consolidating current strengths.")
    if not actions:
        actions.append("Set one stretch objective for the coming quarter.")

    parts = []
    if comp is not None:
        parts.append(f"competence {comp:.0f}/100")
    if kpi is not None:
        parts.append(f"KPI attainment {kpi:.0f}%")
    if wb is not None:
        parts.append(f"wellbeing {wb:.0f}/100")
    headline = ", ".join(parts) if parts else "limited quantitative data this cycle"
    summary = (
        f"This review shows {headline}. "
        f"{len(strengths)} strength(s) and {len(development)} development area(s) were identified "
        "from the available evidence, with suggested actions for the coming quarter."
    )
    return {
        "summary": summary,
        "strengths": strengths,
        "development": development,
        "suggested_actions": actions,
        "model_id": HEURISTIC_MODEL,
    }


# ---------------------------------------------------------------- claude
def _claude_available() -> bool:
    if not getattr(settings, "PMS_AI_USE_CLAUDE", True):
        return False
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    # The SDK resolves credentials from the environment; require a key to be present.
    import os

    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _via_claude(ctx: dict) -> dict | None:
    """Return an analysis dict from the Claude API, or None to fall back."""
    try:
        import anthropic

        client = anthropic.Anthropic()
        system = (
            "You are an HR analyst. Given a staff member's quarterly performance data, "
            "write a concise, fair, strengths-first development analysis. Be specific and "
            "actionable; never invent facts not supported by the data. Respond with a single "
            'JSON object with keys: "summary" (string), "strengths" (string array), '
            '"development" (string array), "suggested_actions" (string array). No prose outside the JSON.'
        )
        msg = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=2000,
            output_config={"effort": "low"},
            system=system,
            messages=[{"role": "user", "content": json.dumps(ctx)}],
        )
        if getattr(msg, "stop_reason", None) == "refusal":
            return None
        text = "".join(b.text for b in msg.content if getattr(b, "type", None) == "text").strip()
        data = json.loads(text)
        return {
            "summary": str(data.get("summary", "")),
            "strengths": [str(x) for x in data.get("strengths", [])],
            "development": [str(x) for x in data.get("development", [])],
            "suggested_actions": [str(x) for x in data.get("suggested_actions", [])],
            "model_id": CLAUDE_MODEL,
        }
    except Exception:
        log.exception("Claude analysis failed; falling back to heuristic")
        return None


# ---------------------------------------------------------------- entry point
@transaction.atomic
def generate(*, org_id: UUID, review: PerformanceReview, by_user_id: UUID | None) -> ReviewAnalysis:
    """Generate (or regenerate) the analysis for a review. Never raises on model error."""
    ctx = build_context(org_id=org_id, review=review)

    result = None
    if _claude_available():
        result = _via_claude(ctx)
    if result is None:
        try:
            result = _heuristic(ctx)
        except Exception:
            log.exception("heuristic analysis failed for review %s", review.id)
            result = None

    defaults = {
        "member_id": review.member_id,
        "input_context": ctx,
        "generated_by_id": by_user_id,
        "generated_at": timezone.now(),
    }
    if result is None:
        defaults.update(
            status=ReviewAnalysis.Status.FAILED,
            model_id="",
            summary="",
            strengths=[],
            development=[],
            suggested_actions=[],
            error="Analysis could not be generated.",
        )
    else:
        defaults.update(
            status=ReviewAnalysis.Status.OK,
            model_id=result["model_id"],
            summary=result["summary"],
            strengths=result["strengths"],
            development=result["development"],
            suggested_actions=result["suggested_actions"],
            error="",
        )

    analysis, _ = ReviewAnalysis.objects.update_or_create(org_id=org_id, review=review, defaults=defaults)
    return analysis
