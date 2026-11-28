"""HARNESS ONLY: a free marketplace course with one lecture of every kind, for the M2 E2E.
Built through the real catalogue services (the same path the studio uses)."""
import os
import time
from datetime import timedelta

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
import django  # noqa: E402

django.setup()
from django.utils import timezone  # noqa: E402

from apps.catalog import services as cat  # noqa: E402
from apps.catalog.models import Course, VideoLibrary  # noqa: E402
from apps.commerce.models import CoursePrice  # noqa: E402
from apps.identity.models import User  # noqa: E402
from core.tenancy import tenant_context  # noqa: E402

from apps.identity.models import InstructorProfile  # noqa: E402

# any approved instructor from the seed owns the course; any staff user approves it
with tenant_context(staff=True):
    owner = User.objects.filter(email__startswith="daniel.reeve").first() or User.objects.get(
        pk=InstructorProfile.objects.filter(status="approved").values_list("user_id", flat=True)[:1]
    )
    staff = User.objects.filter(is_staff=True).first()
slug = f"e2e-every-lecture-{int(time.time())}"
ARTICLE = "<h2>Why it matters</h2><p>Reading lessons use <strong>rich text</strong> with <a href='https://example.com'>links</a>.</p><ul><li>Lists</li><li>work</li></ul><blockquote>Quotes stand out.</blockquote><pre><code>print('code blocks')</code></pre>" * 3
with tenant_context(user_id=owner.id):
    c = cat.create_course(title="Every Lecture Type (E2E)", slug=slug, ownership="instructor", created_by=owner,
                          subtitle="One of each lecture kind", description="<p>Harness course.</p>")
    v = c.versions.get()
    s1 = cat.add_section(version=v, title="Watch and read")
    with tenant_context(user_id=staff.id, staff=True):
        lib = VideoLibrary.objects.filter(is_default=True).first() or VideoLibrary.objects.first()
    video = cat.create_media(kind="video", status="ready", library=lib, uploaded_by=owner, duration_sec=240)
    cat.add_lecture(section=s1, kind="video", title="Welcome video", video=video, duration_sec=240, is_preview=True)
    cat.add_lecture(section=s1, kind="article", title="A reading", body=ARTICLE, duration_sec=300)
    cat.add_lecture(section=s1, kind="external_link", title="Official docs", external_url="https://docs.djangoproject.com/")
    s2 = cat.add_section(version=v, title="Practise")
    cat.add_lecture(section=s2, kind="live_session", title="Live Q&A", live_starts_at=timezone.now() + timedelta(minutes=10),
                    live_duration_min=45, live_join_url="https://meet.example.com/e2e")
    quiz = cat.add_lecture(section=s2, kind="quiz", title="Knowledge check").quiz
    cat.update_quiz(quiz=quiz, reveal_answers="after_submit", time_limit_sec=600, pass_mark_pct=50, max_attempts=3)
    cat.add_question(quiz=quiz, kind="single_choice", prompt="<p>2 + 2 = ?</p>", explanation="<p>Basic sums.</p>",
                     options=[{"body": "3"}, {"body": "4", "is_correct": True}, {"body": "5"}])
    cat.add_question(quiz=quiz, kind="multiple_choice", prompt="<p>Which are Python web frameworks?</p>",
                     options=[{"body": "Django", "is_correct": True}, {"body": "Flask", "is_correct": True}, {"body": "Excel"}])
    cat.add_question(quiz=quiz, kind="true_false", prompt="<p>HTTP is stateless.</p>",
                     options=[{"body": "True", "is_correct": True}, {"body": "False"}])
    cat.add_question(quiz=quiz, kind="matching", prompt="<p>Match the status codes.</p>",
                     options=[{"body": "200", "match_text": "OK"}, {"body": "404", "match_text": "Not Found"}])
    cat.add_question(quiz=quiz, kind="fill_blank", prompt="<p>The ___ method sends data to the server.</p>",
                     options=[{"body": "POST", "is_correct": True, "blank_index": 0}])
    a = cat.add_lecture(section=s2, kind="assignment", title="Mini project").assignment
    cat.update_assignment(assignment=a, instructions="<p>Describe your API design in a few lines, or share a link.</p>",
                          submission_types=["text", "url"], rubric=[{"criterion": "Clear design", "points": 60}, {"criterion": "Good naming", "points": 40}])
    # The publication checklist requires a deliberate free/cash choice before submit.
    with tenant_context(user_id=staff.id, staff=True):
        CoursePrice.objects.create(course=c, is_free=True, tier=None)
    cat.submit(version=v, by=owner)
with tenant_context(user_id=staff.id, staff=True):
    cat.approve(version=v, reviewer=staff)
print(slug)
