"""Studio API: who may author, the course builder, sanitising, Bunny upload sessions,
versions and review, company courses, coupons, grading and revenue."""

import hashlib
import os
from types import SimpleNamespace
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase
from django.utils import timezone

from apps.catalog import services as cat
from apps.catalog.models import Course, CourseVersion
from apps.identity.models import InstructorProfile, User
from apps.org import services as org_services
from apps.org.models import OrgMember
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1/studio"


class StudioApiTest(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()
        f.money(self.staff)
        InstructorProfile.objects.create(user=self.teacher, status="approved", headline="Teacher")

    def as_(self, user):
        self.client.force_login(user)

    def call(self, method, path, data=None, **headers):
        fn = getattr(self.client, method)
        if method in ("get", "delete"):
            return fn(API + path, **headers)
        return fn(API + path, data=data or {}, content_type="application/json", **headers)

    def test_build_upload_review_and_publish(self):
        # an unapproved user cannot create marketplace courses
        self.as_(self.omar)
        self.assertEqual(self.call("post", "/courses", {"title": "Hacking 101"}).status_code, 403)
        self.assertEqual(
            self.call("post", "/instructor-profile", {"headline": "Security trainer"}).json()["status"],
            "pending",
        )

        self.as_(self.teacher)
        c = self.call("post", "/courses", {"title": "Clean Code <b>Now</b>"}).json()
        course = self.call("get", f"/courses/{c['id']}").json()
        self.assertEqual(course["title"], "Clean Code Now")  # tags stripped from plain fields
        v = course["working_version"]["id"]
        sec = self.call("post", f"/versions/{v}/sections", {"title": "Basics"}).json()["id"]
        art = self.call("post", f"/sections/{sec}/lectures", {"kind": "article", "title": "Read",
                         "body": '<p onclick="steal()">Hi<script>alert(1)</script><a href="javascript:x">l</a></p>'}).json()  # fmt: skip
        self.call(
            "patch",
            f"/courses/{c['id']}",
            {"description": '<img src="https://x.test/a.png" onerror="steal()">'},
        )

        # video: we create it at Bunny, the browser gets a signature for that one video only
        with tenant_context(user_id=self.staff.id, staff=True):
            from apps.catalog.models import VideoLibrary

            VideoLibrary.objects.create(name="L", environment="test", bunny_library_id=77, cdn_hostname="vz.t",
                                        is_default=True)  # fmt: skip
        with mock.patch.dict(os.environ, {"BUNNY_STREAM_API_KEY": "secret-key"}), \
             mock.patch("apps.catalog.bunny.create_video", return_value="11111111-2222-3333-4444-555555555555"):  # fmt: skip
            up = self.call(
                "post", "/media/videos", {"course_id": c["id"], "title": "Intro", "size_bytes": 1000}
            ).json()
        h = up["upload"]["headers"]
        expected = hashlib.sha256(
            f"77secret-key{h['AuthorizationExpire']}{h['VideoId']}".encode()
        ).hexdigest()
        self.assertEqual(h["AuthorizationSignature"], expected)
        self.assertNotIn("secret-key", str(up))  # the API key itself never leaves the server
        self.assertEqual(self.call("get", f"/media/{up['asset_id']}").json()["status"], "awaiting_upload")
        # no webhook (e.g. a laptop): the status poll asks Bunny itself, forward-only
        cache.clear()
        with mock.patch(
            "apps.catalog.bunny.get_video", return_value={"status": 4, "encodeProgress": 100, "length": 95}
        ):
            st = self.call("get", f"/media/{up['asset_id']}").json()
        self.assertEqual((st["status"], st["duration_sec"]), ("ready", 95))
        self.assertTrue(st["preview_url"].startswith("https://iframe.mediadelivery.net/embed/77/"))

        # parts (Bunny chapters) and key moments (Bunny moments); each part runs to the next
        media_path = f"/media/{up['asset_id']}"
        body = {"parts": [{"title": "Setup", "start": 30}, {"title": "Intro <b>here</b>", "start": 0}],
                "moments": [{"label": "Key formula", "timestamp": 50}]}  # fmt: skip
        with mock.patch.dict(os.environ, {"BUNNY_STREAM_API_KEY": "secret-key"}),              mock.patch("apps.catalog.bunny.update_video") as upd:  # fmt: skip
            r = self.call("put", f"{media_path}/parts", body)
            self.assertEqual(r.status_code, 200, r.content)
            self.assertEqual(upd.call_args.kwargs["chapters"], [{"title": "Intro here", "start": 0, "end": 30},
                                                                {"title": "Setup", "start": 30, "end": 95}])  # fmt: skip
            late = {"parts": [{"title": "Late", "start": 120}], "moments": []}
            self.assertEqual(self.call("put", f"{media_path}/parts", late).status_code, 400)  # after the end
            twice = {"parts": [{"title": "A", "start": 5}, {"title": "B", "start": 5}], "moments": []}
            self.assertEqual(self.call("put", f"{media_path}/parts", twice).status_code, 400)
        details = self.call("get", f"{media_path}/details").json()
        self.assertEqual([p["title"] for p in details["parts"]], ["Intro here", "Setup"])
        self.assertEqual(details["moments"], [{"label": "Key formula", "timestamp": 50}])
        self.assertEqual(len(details["thumbnails"]["frames"]), 5)
        with mock.patch("apps.catalog.bunny.set_thumbnail") as thumb:
            self.assertEqual(
                self.call("put", f"{media_path}/thumbnail", {"choice": "thumbnail_3.jpg"}).status_code, 200
            )
            self.assertEqual(
                self.call("put", f"{media_path}/thumbnail", {"choice": "http://x.test/a.png"}).status_code,
                400,
            )
        self.assertEqual(thumb.call_count, 1)

        # subtitles: small .srt/.vtt text, forwarded to Bunny (base64 there), never stored by us
        vtt = "WEBVTT" + chr(10) * 2 + "00:00:01.000 --> 00:00:04.000" + chr(10) + "Hello"
        with (
            mock.patch("apps.catalog.bunny.add_caption") as cap,
            mock.patch("apps.catalog.bunny.delete_caption") as uncap,
        ):
            r = self.call(
                "post", f"{media_path}/captions", {"srclang": "en", "label": "English", "content": vtt}
            )
            self.assertEqual(r.status_code, 200, r.content)
            self.assertEqual(cap.call_args.kwargs["content"], vtt.encode())
            bad = {"srclang": "en", "label": "x", "content": "not a subtitle file at all"}
            self.assertEqual(self.call("post", f"{media_path}/captions", bad).status_code, 400)
            self.assertEqual(
                self.call("post", f"{media_path}/captions", {**bad, "srclang": "e n"}).status_code, 422
            )
            self.assertEqual(self.call("delete", f"{media_path}/captions/en").status_code, 200)
        self.assertEqual(uncap.call_args.args[2], "en")

        # an external link: Bunny fetches the file and hosts it like an upload
        with mock.patch("apps.catalog.bunny.fetch_video", return_value="99999999-2222-3333-4444-555555555555"),              mock.patch("apps.catalog.bunny.rename_video"):  # fmt: skip
            r = self.call(
                "post",
                "/media/videos/fetch",
                {"course_id": c["id"], "title": "Talk", "url": "https://cdn.test/talk.mp4"},
            )
            self.assertEqual(r.status_code, 200, r.content)
            self.assertEqual(self.call("post", "/media/videos/fetch",
                                       {"course_id": c["id"], "title": "Talk", "url": "http://cdn.test/talk.mp4"}).status_code, 400)  # fmt: skip
        self.assertEqual(self.call("get", f"/media/{r.json()['asset_id']}").json()["status"], "processing")
        self.as_(self.omar)  # someone else's video
        self.assertEqual(self.call("get", f"{media_path}/details").status_code, 404)
        self.assertEqual(self.call("put", f"{media_path}/parts", body).status_code, 404)
        self.as_(self.teacher)

        quiz_lecture = self.call(
            "post", f"/sections/{sec}/lectures", {"kind": "quiz", "title": "Check"}
        ).json()
        tree = self.call("get", f"/courses/{c['id']}").json()["working_version"]
        quiz_id = tree["sections"][0]["lectures"][1]["quiz"]["id"]
        self.call("post", f"/quizzes/{quiz_id}/questions", {"kind": "single_choice", "prompt": "Pick", "options": [
            {"body": "A", "is_correct": True}, {"body": "B"}]})  # fmt: skip
        r = self.call("put", f"/sections/{sec}/lectures/order", {"ids": [quiz_lecture["id"], art["id"]]})
        self.assertEqual(r.status_code, 200, r.content)
        tree = self.call("get", f"/courses/{c['id']}").json()
        lectures = tree["working_version"]["sections"][0]["lectures"]
        self.assertEqual([lec["kind"] for lec in lectures], ["quiz", "article"])
        body = lectures[1]["body"]
        for bad in ("onclick", "<script", "javascript:"):
            self.assertNotIn(bad, body)
        self.assertNotIn("onerror", tree["description"])
        self.assertTrue(
            lectures[0]["quiz"]["questions"][0]["options"][0]["is_correct"]
        )  # editors see answers
        self.assertEqual(tree["working_version"]["checklist"], [])

        # another instructor cannot see or touch it
        other = User.objects.create_user("ana@learnhub.example.com", "x")
        InstructorProfile.objects.create(user=other, status="approved")
        self.as_(other)
        self.assertEqual(self.call("get", f"/courses/{c['id']}").status_code, 404)
        self.assertEqual(self.call("delete", f"/lectures/{art['id']}").status_code, 404)

        # submit -> staff review -> live; the live version is then locked
        self.as_(self.teacher)
        tier = self.call("get", "/price-tiers").json()[4]["id"]
        self.call("put", f"/courses/{c['id']}/price", {"tier_id": tier})
        self.assertEqual(
            self.call("post", f"/versions/{v}/submit", {"change_summary": "v1"}).json()["status"], "in_review"
        )
        with tenant_context(user_id=self.staff.id, staff=True):
            cat.approve(version=CourseVersion.objects.get(pk=v), reviewer=self.staff)
        self.assertEqual(self.call("delete", f"/lectures/{art['id']}").status_code, 400)  # version_locked
        draft = self.call("post", f"/courses/{c['id']}/draft").json()
        self.assertNotEqual(draft["version_id"], v)
        self.assertEqual(Course.objects.get(pk=c["id"]).live_version_id.hex, v.replace("-", ""))

    def test_company_course_coupons_grading_and_revenue(self):
        hr = User.objects.create_user("hana@acme.example.com", "x")
        acme = org_services.create_organization(name="Acme", slug="acme", owner=hr)
        H = {"HTTP_X_ORG_ID": str(acme.id)}
        with tenant_context(org_id=acme.id, user_id=hr.id):
            OrgMember.objects.create(org=acme, user=self.omar, role="manager", joined_at=timezone.now())
        self.as_(hr)
        c = self.call("post", "/courses", {"title": "Acme Induction"}, **H).json()
        self.assertEqual(self.call("get", f"/courses/{c['id']}", **H).json()["ownership"], "organization")
        self.as_(self.omar)  # a manager is not a company author
        self.assertEqual(self.call("get", f"/courses/{c['id']}", **H).status_code, 403)

        # marketplace course with an assignment, bought by Sara
        course = f.course(staff=self.staff, owner=self.teacher, slug="py", title="Python")
        self.as_(self.teacher)
        self.assertEqual(self.call("post", f"/courses/{course.id}/coupons", {"code": "PY50", "percent_off": 50,
                                                                             "days": 7}).status_code, 200)  # fmt: skip
        self.assertEqual(self.call("post", f"/courses/{course.id}/coupons", {"code": "py50", "percent_off": 10,
                                                                             "days": 7}).status_code, 400)  # fmt: skip
        from apps.commerce import services as shop

        with mock.patch(
            "apps.commerce.gateway.create_checkout_session", return_value={"id": "cs_1", "url": "u"}
        ):
            with tenant_context(user_id=self.sara.id):
                order = shop.create_order(user=self.sara, course_ids=[course.id], currency="GBP")["order"]
        with tenant_context(user_id=self.staff.id, staff=True):
            shop.fulfil_order(
                order_id=order.id, payment_intent="pi_9", amount_minor=order.total_minor, currency="GBP"
            )
        self.assertGreater(self.call("get", "/revenue").json()["balance"]["pending"], 0)

        from apps.learning import services as learning
        from apps.learning.models import Enrollment

        with tenant_context(user_id=self.sara.id):
            e = Enrollment.objects.get(user=self.sara, course=course)
            a = course.live_version.lectures.get(kind="assignment").assignment
            learning.submit_assignment(enrollment=e, assignment=a, text_body="<p>done</p>")
        queue = self.call("get", "/grading").json()
        self.assertEqual(len(queue["submissions"]), 1)
        self.assertEqual(self.call("get", f"/courses/{course.id}/students").json()[0]["name"], "Sara Ahmed")
        other = User.objects.create_user("ana@learnhub.example.com", "x")
        self.as_(other)
        self.assertEqual(self.call("get", "/grading").json()["submissions"], [])  # nothing of Tom's
        self.assertEqual(self.call("post", f"/submissions/{queue['submissions'][0]['id']}/grade",
                                   {"score": 100}).status_code, 404)  # fmt: skip
        self.as_(self.teacher)
        r = self.call(
            "post", f"/submissions/{queue['submissions'][0]['id']}/grade", {"score": 80, "feedback": "Good"}
        )
        self.assertEqual(r.json(), {"status": "graded", "passed": True})

    def test_curriculum_maintenance_inbox_essay_grading_and_payouts(self):
        course = f.course(staff=self.staff, owner=self.teacher, slug="curriculum", title="Curriculum")
        self.as_(self.teacher)
        draft_id = self.call("post", f"/courses/{course.id}/draft").json()["version_id"]
        tree = self.call("get", f"/courses/{course.id}").json()["working_version"]
        sec_id = tree["sections"][0]["id"]

        # sections: reorder, rename, delete
        sec2 = self.call("post", f"/versions/{draft_id}/sections", {"title": "Extra"}).json()["id"]
        r = self.call("put", f"/versions/{draft_id}/sections/order", {"ids": [sec2, sec_id]})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.call("patch", f"/sections/{sec2}", {"title": "Renamed"}).status_code, 200)
        self.assertEqual(self.call("delete", f"/sections/{sec2}").status_code, 200)

        # quiz settings and questions: add, replace, delete
        quiz_lecture = next(lec for lec in tree["sections"][0]["lectures"] if lec["kind"] == "quiz")
        quiz_id = quiz_lecture["quiz"]["id"]
        first_question_id = quiz_lecture["quiz"]["questions"][0]["id"]
        self.assertEqual(self.call("patch", f"/quizzes/{quiz_id}", {"pass_mark_pct": 80}).status_code, 200)
        essay = self.call(
            "post", f"/quizzes/{quiz_id}/questions", {"kind": "essay", "prompt": "Explain", "options": []}
        ).json()
        self.assertEqual(
            self.call("put", f"/questions/{essay['id']}",
                      {"kind": "essay", "prompt": "Explain fully", "options": []}).status_code, 200,
        )  # fmt: skip
        self.assertEqual(self.call("delete", f"/questions/{first_question_id}").status_code, 200)

        # assignment settings
        assignment_lecture = next(
            lec for lec in tree["sections"][0]["lectures"] if lec["kind"] == "assignment"
        )
        self.assertEqual(
            self.call("patch", f"/assignments/{assignment_lecture['assignment']['id']}",
                      {"max_score": 150}).status_code, 200,
        )  # fmt: skip

        # coupons: list and deactivate
        coupon = self.call(
            "post", f"/courses/{course.id}/coupons", {"code": "EXTRA10", "percent_off": 10, "days": 5}
        ).json()
        self.assertEqual(
            [c["code"] for c in self.call("get", f"/courses/{course.id}/coupons").json()], ["EXTRA10"]
        )
        self.assertEqual(self.call("delete", f"/coupons/{coupon['id']}").status_code, 200)

        # publish so a learner can enrol and raise a question / review, and attempt the essay quiz
        self.call("post", f"/versions/{draft_id}/submit")
        with tenant_context(user_id=self.staff.id, staff=True):
            cat.approve(version=CourseVersion.objects.get(pk=draft_id), reviewer=self.staff)

        from apps.engagement.models import Question, Review
        from apps.learning import services as learning

        with tenant_context(user_id=self.sara.id):
            e = learning.enrol(user=self.sara, course=Course.objects.get(pk=course.id), source="free")
            Question.objects.create(user=self.sara, course_id=course.id, title="How long?", body="Ask")
            Review.objects.create(user=self.sara, course_id=course.id, rating=5, body="Great")
            quiz = quiz_id and Course.objects.get(pk=course.id).live_version.lectures.get(kind="quiz").quiz
            attempt = learning.start_attempt(enrollment=e, quiz=quiz)
            essay_question_id = next(q.id for q in quiz.questions.all() if q.kind == "essay")
            learning.submit_attempt(attempt=attempt, answers={str(essay_question_id): "My answer"})

        self.assertEqual([q["title"] for q in self.call("get", "/questions").json()], ["How long?"])
        self.assertEqual([rv["body"] for rv in self.call("get", "/reviews").json()], ["Great"])
        queue = self.call("get", "/grading").json()
        self.assertEqual(len(queue["attempts"]), 1)
        self.assertEqual([q["prompt"] for q in queue["attempts"][0]["essays"]], ["Explain fully"])
        r = self.call(
            "post",
            f"/attempts/{queue['attempts'][0]['id']}/grade",
            {"question_id": str(essay_question_id), "points": 1},
        )
        self.assertEqual(r.status_code, 200, r.content)

        # payouts and the payout account form
        self.assertEqual(self.call("get", "/payouts").json(), [])
        self.assertFalse(self.call("get", "/payout-account").json()["configured"])
        r = self.call(
            "put", "/payout-account", {"method": "paypal", "paypal_email": "tom@learnhub.example.com"}
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(self.call("get", "/payout-account").json()["configured"])

    def test_instructor_status_details_dashboard_and_marking_with_files(self):
        # /me tells "pending" apart from "approved"; only approved instructors use the studio
        self.client.force_login(self.omar)
        self.call("post", "/instructor-profile", {"headline": "Security trainer"})
        me = self.client.get("/api/v1/identity/me").json()
        self.assertEqual((me["instructor_status"], me["is_instructor"]), ("pending", False))
        # a rejected applicant who applies again goes back in the queue
        InstructorProfile.objects.filter(user=self.omar).update(status="rejected")
        self.assertEqual(
            self.call("post", "/instructor-profile", {"headline": "Again"}).json()["status"], "pending"
        )
        self.as_(self.teacher)
        me = self.client.get("/api/v1/identity/me").json()
        self.assertEqual((me["instructor_status"], me["is_instructor"]), ("approved", True))

        course = f.course(staff=self.staff, owner=self.teacher, slug="marking", title="Marking")
        r = self.call("patch", f"/courses/{course.id}",
                      {"outcomes": ["Write <b>tests</b>", "  ", "Ship"], "requirements": ["A laptop"]})  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        self.call("post", f"/courses/{course.id}/draft")
        row = next(r for r in self.call("get", "/courses").json() if r["id"] == str(course.id))
        self.assertEqual((row["has_draft"], row["draft_status"]), (True, "draft"))
        detail = self.call("get", f"/courses/{course.id}").json()
        self.assertEqual(
            (detail["outcomes"], detail["requirements"]), (["Write tests", "Ship"], ["A laptop"])
        )

        from apps.catalog.models import MediaAsset
        from apps.engagement.models import Question
        from apps.learning import services as learning
        from apps.learning.models import Submission, SubmissionFile

        live = Course.objects.get(pk=course.id).live_version
        assignment = live.lectures.get(kind="assignment").assignment
        with tenant_context(user_id=self.sara.id):
            e = learning.enrol(user=self.sara, course=Course.objects.get(pk=course.id), source="free")
            sub = learning.submit_assignment(enrollment=e, assignment=assignment, text_body="<p>Done</p>")
            Question.objects.create(user=self.sara, course_id=course.id, title="Why?", body="<p>Tell me</p>")
        with tenant_context(user_id=self.staff.id, staff=True):
            asset = MediaAsset.objects.create(kind="file", status="ready", uploaded_by=self.sara,
                                              storage_key="submissions/x/report.pdf", original_filename="Report.pdf",
                                              size_bytes=1234)  # fmt: skip
            sf = SubmissionFile.objects.create(submission=sub, asset=asset)

        dash = self.call("get", "/dashboard").json()
        self.assertEqual((dash["to_mark"], dash["unanswered"], dash["students"] >= 0), (1, 1, True))
        inbox = self.call("get", "/questions").json()
        self.assertEqual((inbox[0]["course_id"], inbox[0]["has_instructor_answer"]), (str(course.id), False))

        queue = self.call("get", "/grading").json()["submissions"]
        self.assertEqual(
            queue[0]["files"], [{"id": str(sf.id), "filename": "Report.pdf", "size_bytes": 1234}]
        )
        with mock.patch("core.storage.configured", return_value=True),              mock.patch("core.storage.download_url", return_value="https://blob.test/report.pdf?sig") as dl:  # fmt: skip
            r = self.call("get", f"/submission-files/{sf.id}/download")
        self.assertEqual(r.json()["url"], "https://blob.test/report.pdf?sig")
        self.assertEqual(dl.call_args.args, ("submissions/x/report.pdf", "report.pdf"))

        # another instructor can neither read the hand-in nor see the course
        InstructorProfile.objects.filter(user=self.omar).update(status="approved")
        self.as_(self.omar)
        self.assertEqual(self.call("get", f"/submission-files/{sf.id}/download").status_code, 404)
        self.assertEqual(self.call("get", f"/courses/{course.id}").status_code, 404)
        self.assertEqual(self.call("get", "/dashboard").json()["to_mark"], 0)

        # marking with rubric scores
        self.as_(self.teacher)
        r = self.call("post", f"/submissions/{sub.id}/grade",
                      {"score": assignment.max_score, "feedback": "<p>Good</p>",
                       "rubric_scores": [{"criterion": "Clarity", "points": 5}]})  # fmt: skip
        self.assertEqual(r.status_code, 200, r.content)
        with tenant_context(user_id=self.staff.id, staff=True):
            self.assertEqual(
                Submission.objects.get(pk=sub.id).rubric_scores, [{"criterion": "Clarity", "points": 5}]
            )
        self.assertEqual(self.call("get", "/dashboard").json()["to_mark"], 0)


class PrerequisiteTest(SchemaTransactionTestCase):
    """A lesson can require an earlier lesson: studio rules, the publish checklist and the
    learner lock (every lesson endpoint refuses until the earlier one is complete)."""

    def test_prerequisite_lesson_rules_and_learner_lock(self):
        from apps.commerce.models import CoursePrice
        from apps.learning import services as learning

        staff, teacher, sara, _ = f.users()
        f.money(staff)
        InstructorProfile.objects.create(user=teacher, status="approved")
        self.client.force_login(teacher)

        def call(method, path, data=None):
            return getattr(self.client, method)(API + path, data=data or {}, content_type="application/json")

        c = call("post", "/courses", {"title": "Steps"}).json()
        v = call("get", f"/courses/{c['id']}").json()["working_version"]["id"]
        sec = call("post", f"/versions/{v}/sections", {"title": "One"}).json()["id"]
        first, second = (
            call(
                "post", f"/sections/{sec}/lectures", {"kind": "article", "title": t, "body": "<p>x</p>"}
            ).json()
            for t in ("Basics", "Next step")
        )
        for lesson, key in (
            (first, second["key"]),
            (second, second["key"]),  # later lesson, itself,
            (second, "11111111-2222-3333-4444-555555555555"),
        ):  # not in this course
            r = call("patch", f"/lectures/{lesson['id']}", {"prerequisite_key": key})
            self.assertEqual(r.json()["error"]["code"], "bad_prerequisite")
        self.assertEqual(
            call("patch", f"/lectures/{second['id']}", {"prerequisite_key": first["key"]}).status_code, 200
        )
        tree = call("get", f"/courses/{c['id']}").json()["working_version"]
        self.assertEqual(tree["sections"][0]["lectures"][1]["prerequisite_key"], first["key"])

        # moving the lesson above its prerequisite blocks publishing until fixed
        call("put", f"/sections/{sec}/lectures/order", {"ids": [second["id"], first["id"]]})
        problems = call("get", f"/courses/{c['id']}").json()["working_version"]["checklist"]
        self.assertEqual(problems, ["Lesson 'Next step' needs a prerequisite that comes before it."])
        call("put", f"/sections/{sec}/lectures/order", {"ids": [first["id"], second["id"]]})
        self.assertEqual(call("post", f"/versions/{v}/submit").status_code, 200)
        with tenant_context(user_id=staff.id, staff=True):
            cat.approve(version=CourseVersion.objects.get(pk=v), reviewer=staff)
            course = Course.objects.get(pk=c["id"])
            CoursePrice.objects.create(course=course, is_free=True)
            enrol = learning.enrol(user=sara, course=course, source="free").id

        self.client.force_login(sara)
        base = f"/api/v1/learning/enrollments/{enrol}"
        lessons = self.client.get(base).json()["sections"][0]["lectures"]
        self.assertEqual(
            [(x["locked"], x["prerequisite_title"]) for x in lessons], [(False, None), (True, "Basics")]
        )
        r = self.client.get(f"{base}/lectures/{second['key']}")
        self.assertEqual((r.status_code, r.json()["error"]["message"]), (403, "Finish “Basics” first."))
        self.assertEqual(self.client.post(f"{base}/lectures/{second['key']}/complete").status_code, 403)
        self.client.post(f"{base}/lectures/{first['key']}/complete")
        self.assertEqual(self.client.get(f"{base}/lectures/{second['key']}").status_code, 200)
        self.assertFalse(self.client.get(base).json()["sections"][0]["lectures"][1]["locked"])


class ContentWriteLockTest(SchemaTransactionTestCase):
    def test_course_content_is_written_only_by_authoring_services(self):
        staff, teacher, sara, _ = f.users()
        f.money(staff)
        course = f.course(staff=staff, owner=teacher, slug="locked", title="Locked")
        from django.db import connection

        for who in (sara, teacher):  # even the course's own instructor, outside the services
            with tenant_context(user_id=who.id), connection.cursor() as cur:
                cur.execute("UPDATE catalog.courses SET title = 'pwned' WHERE id = %s", [course.id])
                self.assertEqual(cur.rowcount, 0)
                cur.execute(
                    "UPDATE catalog.lectures SET title = 'pwned' WHERE version_id = %s",
                    [course.live_version_id],
                )
                self.assertEqual(cur.rowcount, 0)
        with tenant_context(user_id=teacher.id):
            cat.update_course(course=Course.objects.get(pk=course.pk), subtitle="Through the service")
            self.assertEqual(Course.objects.get(pk=course.pk).subtitle, "Through the service")
            with connection.cursor() as cur:  # and the lock is closed again afterwards
                cur.execute("SELECT COALESCE(current_setting('app.author', true), '')")
                self.assertEqual(cur.fetchone()[0], "")


class BunnyNetworkTest(SimpleTestCase):
    def test_unreachable_video_service_is_a_clear_503_not_a_crash(self):
        import httpx

        from apps.catalog import bunny
        from core.errors import ServiceError

        library = SimpleNamespace(api_key_env="BUNNY_TEST_KEY", bunny_library_id=1)
        with mock.patch.dict(os.environ, {"BUNNY_TEST_KEY": "k"}), \
             mock.patch("httpx.Client.post", side_effect=httpx.ConnectTimeout("timed out")):  # fmt: skip
            with self.assertRaises(ServiceError) as ctx:
                bunny.create_video(library, "Intro")
        self.assertEqual((ctx.exception.code, ctx.exception.status), ("video_unreachable", 503))
