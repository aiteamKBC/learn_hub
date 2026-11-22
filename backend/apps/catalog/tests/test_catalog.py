"""Catalog: private-content isolation, owner inheritance, versioning, answer hiding.

Runs as the real app role (lms_app) with request-like RLS context."""

import re

from django.db import IntegrityError, ProgrammingError, transaction

from apps.catalog import selectors, services
from apps.catalog.models import Course, CourseVersion, Lecture, MediaAsset, QuizOption, VideoLibrary
from apps.commerce.models import CoursePrice
from apps.identity.models import User
from apps.org import services as org_services
from core.errors import ServiceError
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class CatalogTestBase(SchemaTransactionTestCase):
    def setUp(self):
        self.hr = User.objects.create_user("hr@acme-demo.com", "x")
        self.bob = User.objects.create_user("bob@beta-demo.com", "x")
        self.teacher = User.objects.create_user("teacher@learnhub-demo.com", "x")
        self.staff = User.objects.create_user("staff@learnhub-demo.com", "x", is_staff=True)
        self.acme = org_services.create_organization(name="Acme", slug="acme", owner=self.hr)
        self.beta = org_services.create_organization(name="Beta", slug="beta", owner=self.bob)
        with tenant_context(user_id=self.staff.id, staff=True):
            self.library = VideoLibrary.objects.create(
                name="Standard (test)",
                environment="test",
                bunny_library_id=1,
                cdn_hostname="vz.test",
                is_default=True,
            )

    def video(self, user, org=None, status=MediaAsset.Status.READY):
        return services.create_media(
            kind="video",
            status=status,
            library=self.library,
            uploaded_by=user,
            owner_org_id=org,
            duration_sec=300,
        )

    def full_course(self, *, ownership, user, org=None, slug="fire-safety"):
        """A course with a video, a reading, a quiz (choice + matching + fill blank) and an assignment."""
        course = services.create_course(
            title="Fire Safety", slug=slug, ownership=ownership, created_by=user, owner_org_id=org
        )
        v1 = course.versions.get()
        sec = services.add_section(version=v1, title="Basics")
        services.add_lecture(
            section=sec, kind="video", title="Intro", video=self.video(user, org), duration_sec=300
        )
        services.add_lecture(section=sec, kind="article", title="Reading", body="<p>Exits</p>")
        quiz_lec = services.add_lecture(section=sec, kind="quiz", title="Check")
        services.add_question(
            quiz=quiz_lec.quiz,
            kind="single_choice",
            prompt="Extinguisher for oil?",
            options=[{"body": "Water"}, {"body": "Wet chemical", "is_correct": True}],
        )
        services.add_question(
            quiz=quiz_lec.quiz,
            kind="matching",
            prompt="Match class to fire",
            options=[{"body": "Class A", "match_text": "Wood"}, {"body": "Class B", "match_text": "Petrol"}],
        )
        services.add_question(
            quiz=quiz_lec.quiz,
            kind="fill_blank",
            prompt="Call ___ in an emergency",
            options=[{"body": "999", "is_correct": True}],
        )
        assignment_lec = services.add_lecture(section=sec, kind="assignment", title="Plan your exit")
        services.update_assignment(
            assignment=assignment_lec.assignment, instructions="Draw your floor's exit route."
        )
        # Public courses must make an explicit paid/free choice before they can be
        # submitted. Keep this reusable "complete course" fixture genuinely publishable.
        if ownership in (Course.Ownership.PLATFORM, Course.Ownership.INSTRUCTOR):
            with tenant_context(user_id=self.staff.id, staff=True):
                CoursePrice.objects.create(course=course, is_free=True)
        return course, v1


class PrivateContentIsolationTest(CatalogTestBase):
    def test_company_course_is_invisible_to_other_companies(self):
        with tenant_context(org_id=self.acme.id, user_id=self.hr.id):
            course, v1 = self.full_course(ownership="organization", user=self.hr, org=self.acme.id)
            self.assertEqual(Lecture.objects.filter(version=v1).count(), 4)
        with tenant_context(org_id=self.beta.id, user_id=self.bob.id):
            self.assertFalse(Course.objects.filter(pk=course.pk).exists())
            self.assertEqual(Lecture.objects.filter(version_id=v1.id).count(), 0)
            self.assertEqual(QuizOption.objects.count(), 0)
        with tenant_context(user_id=self.bob.id):  # personal space
            self.assertFalse(Course.objects.filter(pk=course.pk).exists())

    def test_marketplace_course_is_visible_everywhere(self):
        with tenant_context(user_id=self.teacher.id):
            course, _ = self.full_course(ownership="instructor", user=self.teacher)
        for ctx in ({"user_id": self.bob.id}, {"org_id": self.beta.id, "user_id": self.bob.id}):
            with tenant_context(**ctx):
                self.assertTrue(Course.objects.filter(pk=course.pk).exists())

    def test_children_inherit_owner_from_the_course(self):
        with tenant_context(org_id=self.acme.id, user_id=self.hr.id):
            course, v1 = self.full_course(ownership="organization", user=self.hr, org=self.acme.id)
            owners = set(Lecture.objects.filter(version=v1).values_list("owner_org_id", flat=True))
            owners |= set(QuizOption.objects.values_list("owner_org_id", flat=True))
        self.assertEqual(owners, {self.acme.id})

    def test_cannot_create_private_course_for_another_company(self):
        with tenant_context(org_id=self.acme.id, user_id=self.hr.id):
            with self.assertRaisesMessage(ProgrammingError, "row-level security"), transaction.atomic():
                services.create_course(
                    title="Hack",
                    slug="hack",
                    ownership="organization",
                    created_by=self.hr,
                    owner_org_id=self.beta.id,
                )


class VersioningTest(CatalogTestBase):
    def test_publish_copy_republish_keeps_lecture_keys(self):
        with tenant_context(org_id=self.acme.id, user_id=self.hr.id):
            course, v1 = self.full_course(ownership="organization", user=self.hr, org=self.acme.id)
            services.submit(version=v1, by=self.hr)  # company content publishes directly
            course.refresh_from_db()
            self.assertEqual(
                (course.live_version_id, course.status, course.lecture_count), (v1.id, "published", 4)
            )
            keys_v1 = set(v1.lectures.values_list("lecture_key", flat=True))

            v2 = services.create_draft(course=course, by=self.hr)
            self.assertEqual(v2.number, 2)
            self.assertEqual(set(v2.lectures.values_list("lecture_key", flat=True)), keys_v1)
            quiz2 = v2.lectures.get(kind="quiz").quiz
            self.assertEqual(quiz2.questions.count(), 3)
            self.assertEqual(QuizOption.objects.filter(question__quiz=quiz2).count(), 5)
            self.assertIn("exit route", v2.lectures.get(kind="assignment").assignment.instructions)
            self.assertEqual(
                services.create_draft(course=course, by=self.hr).pk, v2.pk
            )  # one draft at a time

            services.add_lecture(
                section=v2.sections.get(),
                kind="external_link",
                title="HSE",
                external_url="https://www.hse.gov.uk/",
            )
            with self.assertRaises(ServiceError):  # live version is locked
                services.add_section(version=v1, title="Nope")
            services.submit(version=v2, by=self.hr, requires_recompletion=True)
            course.refresh_from_db()
            v1.refresh_from_db()
            self.assertEqual((course.live_version_id, v1.status, course.lecture_count), (v2.id, "retired", 5))

    def test_marketplace_update_needs_review(self):
        with tenant_context(user_id=self.teacher.id):
            course, v1 = self.full_course(ownership="instructor", user=self.teacher, slug="mkt")
            services.submit(version=v1, by=self.teacher)
            v1.refresh_from_db()
            course.refresh_from_db()
            self.assertEqual((v1.status, course.live_version_id), ("in_review", None))
        with tenant_context(user_id=self.staff.id, staff=True):
            services.approve(version=v1, reviewer=self.staff)
            course.refresh_from_db()
            self.assertEqual(course.live_version_id, v1.id)

    def test_checklist_blocks_broken_content(self):
        with tenant_context(user_id=self.teacher.id):
            course = services.create_course(
                title="Bad", slug="bad", ownership="instructor", created_by=self.teacher
            )
            v1 = course.versions.get()
            sec = services.add_section(version=v1, title="S")
            services.add_lecture(
                section=sec,
                kind="video",
                title="No upload yet",
                video=self.video(self.teacher, status=MediaAsset.Status.PROCESSING),
            )
            q = services.add_lecture(section=sec, kind="quiz", title="Q").quiz
            services.add_question(
                quiz=q, kind="single_choice", prompt="?", options=[{"body": "a"}, {"body": "b"}]
            )
            # Pricing is valid here so this test remains focused on its two broken
            # curriculum items (unfinished video and an answerless quiz).
            with tenant_context(user_id=self.staff.id, staff=True):
                CoursePrice.objects.create(course=course, is_free=True)
            problems = services.publish_checklist(v1)
            self.assertEqual(len(problems), 2, problems)
            with self.assertRaises(ServiceError):
                services.submit(version=v1, by=self.teacher)

    def test_database_allows_only_one_open_version(self):
        with tenant_context(user_id=self.teacher.id):
            course = services.create_course(
                title="C", slug="c", ownership="instructor", created_by=self.teacher
            )
            with self.assertRaises(IntegrityError), transaction.atomic(), services.authoring():
                CourseVersion.objects.create(course=course, number=2)


class AnswerHidingTest(CatalogTestBase):
    def test_learner_quiz_has_no_answers(self):
        with tenant_context(user_id=self.teacher.id):
            _, v1 = self.full_course(ownership="instructor", user=self.teacher, slug="quiz")
            quiz = v1.lectures.get(kind="quiz").quiz
            data = selectors.learner_quiz(quiz, seed=1)
        text = str(data)
        self.assertNotIn("is_correct", text)
        self.assertNotIn("match_text", text)
        matching = next(q for q in data["questions"] if q["kind"] == "matching")
        self.assertEqual(sorted(matching["right"]), ["Petrol", "Wood"])  # shown, but never paired
        self.assertNotIn("options", matching)
        fill = next(q for q in data["questions"] if q["kind"] == "fill_blank")
        self.assertEqual(fill["blanks"], 1)
        # the hidden answer must not leak (ids are removed first: a random uuid can contain "999")
        self.assertNotIn("999", re.sub(r"[0-9a-f]{8}-[0-9a-f-]{27}", "", text))
