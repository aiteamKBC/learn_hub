"""Learning: privacy between personal and company learning, grading of every question
type, attempt and time limits, assignments, progress buffering, completion, certificates.
Runs as the real app role (lms_app) with request-like RLS context."""

from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.utils import timezone

from apps.catalog import services as cat
from apps.catalog.models import VideoLibrary
from apps.identity.models import User
from apps.learning import progress, services
from apps.learning.models import Certificate, Enrollment, LectureProgress, QuizAttempt, Submission
from apps.org import services as org_services
from apps.org.models import OrgMember
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class LearningBase(SchemaTransactionTestCase):
    def setUp(self):
        self.hr = User.objects.create_user("hr@acme-demo.com", "x", full_name="Hana HR")
        self.sara = User.objects.create_user("sara@acme-demo.com", "x", full_name="Sara Ahmed")
        self.bob = User.objects.create_user("bob@beta-demo.com", "x")
        self.teacher = User.objects.create_user("teacher@learnhub-demo.com", "x", full_name="Tom Teacher")
        self.staff = User.objects.create_user("staff@learnhub-demo.com", "x", is_staff=True)
        self.acme = org_services.create_organization(name="Acme", slug="acme", owner=self.hr)
        self.beta = org_services.create_organization(name="Beta", slug="beta", owner=self.bob)
        with tenant_context(org_id=self.acme.id, user_id=self.hr.id):
            OrgMember.objects.create(org=self.acme, user=self.sara, role="learner", joined_at=timezone.now())
        with tenant_context(user_id=self.staff.id, staff=True):
            self.library = VideoLibrary.objects.create(
                name="Std", environment="test", bunny_library_id=1, cdn_hostname="vz.test", is_default=True
            )
        self.ACME = {"org_id": self.acme.id, "user_id": self.hr.id}
        self.SARA_IN_ACME = {"org_id": self.acme.id, "user_id": self.sara.id}
        self.SARA = {"user_id": self.sara.id}

    def build_course(self, *, ownership, user, org=None, slug):
        course = cat.create_course(
            title="Fire Safety", slug=slug, ownership=ownership, created_by=user, owner_org_id=org
        )
        v = course.versions.get()
        sec = cat.add_section(version=v, title="Basics")
        video = cat.create_media(
            kind="video",
            status="ready",
            library=self.library,
            uploaded_by=user,
            owner_org_id=org,
            duration_sec=100,
        )
        lectures = {
            "video": cat.add_lecture(section=sec, kind="video", title="Intro", video=video, duration_sec=100),
            "article": cat.add_lecture(section=sec, kind="article", title="Read", body="<p>Exits</p>"),
            "quiz": cat.add_lecture(section=sec, kind="quiz", title="Check"),
            "assignment": cat.add_lecture(section=sec, kind="assignment", title="Plan"),
        }
        quiz = lectures["quiz"].quiz
        q = {}
        q["single"] = cat.add_question(
            quiz=quiz,
            kind="single_choice",
            prompt="Oil fire?",
            options=[{"body": "Water"}, {"body": "Wet chemical", "is_correct": True}],
        )
        q["multi"] = cat.add_question(
            quiz=quiz,
            kind="multiple_choice",
            prompt="Exits?",
            options=[{"body": "A", "is_correct": True}, {"body": "B", "is_correct": True}, {"body": "C"}],
        )
        q["tf"] = cat.add_question(
            quiz=quiz,
            kind="true_false",
            prompt="Use lifts in a fire?",
            options=[{"body": "True"}, {"body": "False", "is_correct": True}],
        )
        q["match"] = cat.add_question(
            quiz=quiz,
            kind="matching",
            prompt="Match",
            options=[{"body": "Class A", "match_text": "Wood"}, {"body": "Class B", "match_text": "Petrol"}],
        )
        q["fill"] = cat.add_question(
            quiz=quiz,
            kind="fill_blank",
            prompt="Call ___ then ___",
            options=[
                {"body": "999", "is_correct": True, "blank_index": 0},
                {"body": "112", "is_correct": True, "blank_index": 0},
                {"body": "your manager", "is_correct": True, "blank_index": 1},
            ],
        )
        q["short"] = cat.add_question(
            quiz=quiz,
            kind="short_answer",
            prompt="Assembly point?",
            options=[{"body": "car park", "is_correct": True}],
        )
        q["essay"] = cat.add_question(quiz=quiz, kind="essay", prompt="Describe your exit route", points=4)
        a = lectures["assignment"].assignment
        cat.update_assignment(
            assignment=a, instructions="Draw the route", max_score=100, pass_score=60, max_resubmissions=1
        )
        cat.submit(version=v, by=user)
        if ownership == "instructor":
            with tenant_context(user_id=self.staff.id, staff=True):
                cat.approve(version=v, reviewer=self.staff)
        course.refresh_from_db()
        return course, lectures, q

    def correct_answers(self, q):
        opt = lambda question, **f: str(question.options.get(**f).id)  # noqa: E731
        return {
            str(q["single"].id): opt(q["single"], is_correct=True),
            str(q["multi"].id): [str(o.id) for o in q["multi"].options.filter(is_correct=True)],
            str(q["tf"].id): opt(q["tf"], is_correct=True),
            str(q["match"].id): {str(o.id): o.match_text for o in q["match"].options.all()},
            str(q["fill"].id): [" 112 ", "Your Manager"],
            str(q["short"].id): "Car  Park",
            str(q["essay"].id): "Down the stairs to the car park.",
        }


class PrivacyTest(LearningBase):
    def test_company_never_sees_personal_learning(self):
        with tenant_context(**self.ACME):
            company_course, *_ = self.build_course(
                ownership="organization", user=self.hr, org=self.acme.id, slug="fs"
            )
        with tenant_context(user_id=self.teacher.id):
            personal_course, *_ = self.build_course(ownership="instructor", user=self.teacher, slug="py")
        with tenant_context(**self.ACME):
            services.enrol(user=self.sara, course=company_course, source="organization", org_id=self.acme.id)
        with tenant_context(**self.SARA):
            services.enrol(user=self.sara, course=personal_course, source="purchase")

        with tenant_context(**self.ACME):  # HR at Acme
            self.assertEqual(list(Enrollment.objects.values_list("course__slug", flat=True)), ["fs"])
        with tenant_context(**self.SARA):  # Sara, personal space: both are hers
            self.assertEqual(Enrollment.objects.count(), 2)
        with tenant_context(org_id=self.beta.id, user_id=self.bob.id):  # another company
            self.assertEqual(Enrollment.objects.count(), 0)

    def test_progress_events_are_isolated_and_partitions_closed(self):
        with tenant_context(**self.ACME):
            course, lectures, _ = self.build_course(
                ownership="organization", user=self.hr, org=self.acme.id, slug="fs"
            )
            e = services.enrol(user=self.sara, course=course, source="organization", org_id=self.acme.id)
        progress.record_heartbeat(
            enrollment=e, lecture_key=lectures["video"].lecture_key, position_sec=30, watched_delta_sec=30
        )
        from apps.learning.models import ProgressEvent

        with tenant_context(**self.ACME):
            self.assertEqual(ProgressEvent.objects.count(), 1)
        with tenant_context(org_id=self.beta.id, user_id=self.bob.id):
            self.assertEqual(ProgressEvent.objects.count(), 0)


class QuizGradingTest(LearningBase):
    def setUp(self):
        super().setUp()
        with tenant_context(**self.ACME):
            self.course, self.lectures, self.q = self.build_course(
                ownership="organization", user=self.hr, org=self.acme.id, slug="fs"
            )
            self.e = services.enrol(
                user=self.sara, course=self.course, source="organization", org_id=self.acme.id
            )
        self.quiz = self.lectures["quiz"].quiz

    def test_every_question_type_and_manual_essay(self):
        with tenant_context(**self.SARA_IN_ACME):
            attempt = services.start_attempt(enrollment=self.e, quiz=self.quiz)
            attempt = services.submit_attempt(attempt=attempt, answers=self.correct_answers(self.q))
        self.assertEqual(attempt.status, "needs_grading")
        self.assertIsNone(attempt.passed)
        auto = {k: v["points"] for k, v in attempt.results.items() if k != str(self.q["essay"].id)}
        self.assertTrue(all(Decimal(p) == 1 for p in auto.values()), auto)
        with tenant_context(**self.ACME):
            attempt = services.grade_manual(
                attempt=attempt, question_id=self.q["essay"].id, points=3, feedback="Good", grader=self.hr
            )
        self.assertEqual(
            (attempt.status, attempt.passed, attempt.score_points, attempt.max_points),
            ("graded", True, Decimal(9), 10),
        )
        with tenant_context(**self.SARA_IN_ACME):
            self.assertTrue(
                LectureProgress.objects.filter(
                    enrollment=self.e,
                    lecture_key=self.lectures["quiz"].lecture_key,
                    completed_at__isnull=False,
                ).exists()
            )

    def test_partial_credit_and_wrong_answers(self):
        with tenant_context(**self.ACME):  # building the answer sheet reads Acme-private options
            answers = self.correct_answers(self.q)
            left = list(self.q["match"].options.all())
            answers[str(self.q["match"].id)] = {str(left[0].id): left[0].match_text, str(left[1].id): "Wrong"}
        answers[str(self.q["fill"].id)] = ["999", "nobody"]
        answers[str(self.q["multi"].id)] = answers[str(self.q["multi"].id)][:1]  # incomplete selection
        with tenant_context(**self.SARA_IN_ACME):
            attempt = services.submit_attempt(
                attempt=services.start_attempt(enrollment=self.e, quiz=self.quiz), answers=answers
            )
        r = attempt.results
        self.assertEqual(Decimal(r[str(self.q["match"].id)]["points"]), Decimal("0.50"))
        self.assertEqual(Decimal(r[str(self.q["fill"].id)]["points"]), Decimal("0.50"))
        self.assertEqual(Decimal(r[str(self.q["multi"].id)]["points"]), 0)

    def test_attempt_limit_and_time_limit(self):
        self.quiz.max_attempts, self.quiz.time_limit_sec = 1, 60
        with tenant_context(**self.ACME):
            with cat.authoring():  # test setup: change settings on the live quiz directly
                self.quiz.save()
        with tenant_context(**self.SARA_IN_ACME):
            attempt = services.start_attempt(enrollment=self.e, quiz=self.quiz)
            QuizAttempt.objects.filter(pk=attempt.pk).update(expires_at=timezone.now() - timedelta(minutes=5))
            attempt = services.submit_attempt(attempt=attempt, answers=self.correct_answers(self.q))
            self.assertEqual(
                Decimal(attempt.results[str(self.q["single"].id)]["points"]), 0
            )  # too late: nothing counts
            with self.assertRaises(ServiceError):
                services.submit_attempt(attempt=attempt, answers={})  # no double submit
            with self.assertRaises(ServiceError):
                services.start_attempt(enrollment=self.e, quiz=self.quiz)  # out of attempts


class AssignmentTest(LearningBase):
    def test_submit_return_resubmit_pass(self):
        with tenant_context(**self.ACME):
            course, lectures, _ = self.build_course(
                ownership="organization", user=self.hr, org=self.acme.id, slug="fs"
            )
            e = services.enrol(user=self.sara, course=course, source="organization", org_id=self.acme.id)
        a = lectures["assignment"].assignment
        with tenant_context(**self.SARA_IN_ACME):
            s1 = services.submit_assignment(enrollment=e, assignment=a, text_body="Stairs")
            with self.assertRaises(ServiceError):
                services.submit_assignment(
                    enrollment=e, assignment=a, text_body="Again"
                )  # still being graded
            with self.assertRaises(ServiceError):
                services.submit_assignment(
                    enrollment=e, assignment=a, url="https://x.test"
                )  # links not allowed
        with tenant_context(**self.ACME):
            s1 = services.grade_submission(
                submission=s1,
                score=40,
                grader=self.hr,
                feedback="Add the assembly point",
                return_for_resubmission=True,
            )
            self.assertEqual((s1.status, s1.passed), ("returned", False))
        with tenant_context(**self.SARA_IN_ACME):
            s2 = services.submit_assignment(enrollment=e, assignment=a, text_body="Stairs, then car park")
        with tenant_context(**self.ACME):
            s2 = services.grade_submission(submission=s2, score=85, grader=self.hr)
        with tenant_context(**self.SARA_IN_ACME):
            self.assertEqual((s2.attempt_no, s2.passed), (2, True))
            self.assertTrue(
                LectureProgress.objects.filter(
                    enrollment=e, lecture_key=lectures["assignment"].lecture_key, completed_at__isnull=False
                ).exists()
            )
            self.assertEqual(Submission.objects.filter(enrollment=e).count(), 2)


class CompletionTest(LearningBase):
    def test_full_course_completion_issues_verifiable_certificate(self):
        with tenant_context(**self.ACME):
            course, lectures, q = self.build_course(
                ownership="organization", user=self.hr, org=self.acme.id, slug="fs"
            )
            e = services.enrol(user=self.sara, course=course, source="organization", org_id=self.acme.id)
        key = lectures["video"].lecture_key
        progress.record_heartbeat(
            enrollment=e, lecture_key=key, position_sec=50, watched_delta_sec=1000
        )  # capped at 70
        with tenant_context(**self.SARA_IN_ACME):
            p = LectureProgress.objects.get(enrollment=e, lecture_key=key)
            self.assertEqual((p.watched_sec, p.completed_at), (70, None))  # 70 < 90% of 100 s
        progress.record_heartbeat(enrollment=e, lecture_key=key, position_sec=100, watched_delta_sec=30)
        with tenant_context(**self.SARA_IN_ACME):
            self.assertIsNotNone(LectureProgress.objects.get(enrollment=e, lecture_key=key).completed_at)
            services.complete_lecture(enrollment=e, lecture_key=lectures["article"].lecture_key)
            answers = self.correct_answers(q)
            answers.pop(str(q["essay"].id))
            attempt = services.submit_attempt(
                attempt=services.start_attempt(enrollment=e, quiz=lectures["quiz"].quiz), answers=answers
            )
            sub = services.submit_assignment(
                enrollment=e, assignment=lectures["assignment"].assignment, text_body="Route"
            )
        with tenant_context(**self.ACME):
            services.grade_manual(
                attempt=attempt, question_id=q["essay"].id, points=4, feedback="", grader=self.hr
            )
            services.grade_submission(submission=sub, score=90, grader=self.hr)
        with tenant_context(**self.SARA_IN_ACME):
            e.refresh_from_db()
            self.assertEqual(
                (e.status, e.progress_pct, e.completed_version_id),
                ("completed", Decimal("100.00"), course.live_version_id),
            )
            cert = Certificate.objects.get(enrollment=e)
            self.assertEqual((cert.recipient_name, cert.course_title), ("Sara Ahmed", "Fire Safety"))
        public = services.verify_certificate(cert.verification_code.lower())  # no RLS context at all
        self.assertEqual((public["recipient_name"], public["is_revoked"]), ("Sara Ahmed", False))
        self.assertNotIn("user_id", public)
        self.assertIsNone(services.verify_certificate("LH-NOPE-NOPE-NOPE"))


class HeartbeatFlushTest(LearningBase):
    def test_redis_buffer_flushes_in_one_batch(self):
        import fakeredis

        fake = fakeredis.FakeRedis()
        with tenant_context(**self.ACME):
            course, lectures, _ = self.build_course(
                ownership="organization", user=self.hr, org=self.acme.id, slug="fs"
            )
            e = services.enrol(user=self.sara, course=course, source="organization", org_id=self.acme.id)
        key = lectures["video"].lecture_key
        with mock.patch.object(progress, "_redis", return_value=fake):
            for pos in (30, 60, 95):
                progress.record_heartbeat(
                    enrollment=e, lecture_key=key, position_sec=pos, watched_delta_sec=30
                )
            with tenant_context(**self.SARA_IN_ACME):
                self.assertFalse(
                    LectureProgress.objects.filter(enrollment=e).exists()
                )  # buffered, not written
            self.assertEqual(progress.flush_heartbeats(), 1)  # 3 heartbeats -> 1 row
            self.assertEqual(progress.flush_heartbeats(), 0)
        with tenant_context(**self.SARA_IN_ACME):
            p = LectureProgress.objects.get(enrollment=e, lecture_key=key)
            self.assertEqual((p.last_position_sec, p.watched_sec), (95, 90))
            self.assertIsNotNone(p.completed_at)  # 90 s of a 100 s video at 90%

    def test_end_of_video_beat_is_written_at_once(self):
        import fakeredis

        fake = fakeredis.FakeRedis()
        with tenant_context(**self.ACME):
            course, lectures, _ = self.build_course(
                ownership="organization", user=self.hr, org=self.acme.id, slug="fs"
            )
            e = services.enrol(user=self.sara, course=course, source="organization", org_id=self.acme.id)
        video = lectures["video"].lecture_key
        with mock.patch.object(progress, "_redis", return_value=fake):
            progress.record_heartbeat(enrollment=e, lecture_key=video, position_sec=60, watched_delta_sec=60)
            progress.record_heartbeat(
                enrollment=e, lecture_key=video, position_sec=100, watched_delta_sec=30, ended=True
            )  # 60 buffered + 30 now = 90 s of 100 s: complete without waiting for the flush
            with tenant_context(**self.SARA_IN_ACME):
                p = LectureProgress.objects.get(enrollment=e, lecture_key=video)
                self.assertEqual((p.last_position_sec, p.watched_sec), (100, 90))
                self.assertTrue(progress.is_complete(e, video))
            self.assertEqual(progress.flush_heartbeats(), 0)  # nothing left buffered for it

    def test_skipping_to_the_end_does_not_complete(self):
        import fakeredis

        with tenant_context(**self.ACME):
            course, lectures, _ = self.build_course(
                ownership="organization", user=self.hr, org=self.acme.id, slug="fs"
            )
            e = services.enrol(user=self.sara, course=course, source="organization", org_id=self.acme.id)
        video = lectures["video"].lecture_key
        with mock.patch.object(progress, "_redis", return_value=fakeredis.FakeRedis()):
            progress.record_heartbeat(
                enrollment=e, lecture_key=video, position_sec=100, watched_delta_sec=10, ended=True
            )
        with tenant_context(**self.SARA_IN_ACME):
            self.assertFalse(progress.is_complete(e, video))
            self.assertEqual(LectureProgress.objects.get(enrollment=e, lecture_key=video).watched_sec, 10)

    def test_lecture_without_a_length_uses_bunnys(self):
        """A video attached before Bunny finished encoding was saved with length 0: it
        still completes, measured against the video's length from Bunny."""
        from apps.catalog import media
        from apps.catalog.models import Lecture
        from apps.catalog.services import authoring

        with tenant_context(**self.ACME):
            course, lectures, _ = self.build_course(
                ownership="organization", user=self.hr, org=self.acme.id, slug="fs"
            )
            e = services.enrol(user=self.sara, course=course, source="organization", org_id=self.acme.id)
            lec = lectures["video"]
            with authoring():
                Lecture.objects.filter(pk=lec.pk).update(duration_sec=0)
        progress.record_heartbeat(
            enrollment=e, lecture_key=lec.lecture_key, position_sec=50, watched_delta_sec=50
        )
        with tenant_context(**self.SARA_IN_ACME):
            self.assertFalse(progress.is_complete(e, lec.lecture_key))  # 50 s of Bunny's 100 s
        progress.record_heartbeat(
            enrollment=e, lecture_key=lec.lecture_key, position_sec=100, watched_delta_sec=40
        )
        with tenant_context(**self.SARA_IN_ACME):
            self.assertTrue(progress.is_complete(e, lec.lecture_key))
        with tenant_context(staff=True):
            self.assertEqual(
                media.fill_lecture_lengths(lec.video_id, 100), 1
            )  # the lecture gets Bunny's length
            self.assertEqual(Lecture.objects.get(pk=lec.pk).duration_sec, 100)
            self.assertEqual(media.fill_lecture_lengths(lec.video_id, 120), 0)  # a known length is kept
