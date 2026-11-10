"""Scalability guard: the main pages run a FIXED number of queries however much data
they show. Each page is measured small, the data grows, and it is measured again: a
loop that queries per row (an N+1) makes the second number bigger and fails the test.
The ceilings stop slow creep."""

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.catalog import services as cat
from apps.catalog.models import CourseVersion
from apps.commerce import services as shop
from apps.compliance import engine
from apps.identity.models import InstructorProfile, User
from apps.learning import services as learning
from apps.learning.models import Enrollment
from apps.org import services as org_services
from apps.org.models import OrgMember, OrgUnit
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase


class QueryBudgetTest(SchemaTransactionTestCase):
    def count(self, path, **headers) -> int:
        with CaptureQueriesContext(connection) as ctx:
            r = self.client.get(path, **headers)
        self.assertEqual(r.status_code, 200, path)
        return len(ctx)

    def assertConstant(self, pages: dict, grow, ceiling: int = 25, **headers):
        before = {p: self.count(p, **headers) for p in pages}
        grow()
        for path, name in pages.items():
            after = self.count(path, **headers)
            self.assertEqual(
                after, before[path], f"{name}: queries grow with data ({before[path]} -> {after})"
            )
            self.assertLessEqual(after, ceiling, f"{name}: {after} queries")

    def test_pages_do_not_query_per_row(self):
        staff, teacher, sara, _ = f.users()
        category = f.money(staff)
        InstructorProfile.objects.create(user=teacher, status="approved", headline="T")
        paid = [f.course(staff=staff, owner=teacher, slug=f"c{i}", title=f"Course {i}", category=category)
                for i in range(4)]  # fmt: skip
        free = [
            f.course(staff=staff, owner=teacher, slug=f"f{i}", title=f"Free {i}", free=True) for i in range(4)
        ]

        def add(n_from, n_to):
            with tenant_context(user_id=sara.id):
                for c in paid[n_from:n_to]:
                    shop.add_to_cart(user=sara, course_id=c.id)
                    shop.toggle_wishlist(user=sara, course_id=c.id)
                for c in free[n_from:n_to]:
                    learning.enrol(user=sara, course=c, source="free")

        # learner pages
        add(0, 1)
        self.client.force_login(sara)
        with tenant_context(user_id=sara.id):
            eid = Enrollment.objects.filter(user=sara).values_list("id", flat=True).first()
        self.assertConstant({
            "/api/v1/commerce/cart": "cart", "/api/v1/commerce/wishlist": "wishlist",
            "/api/v1/learning/my/courses": "my learning", "/api/v1/catalog/courses": "catalog",
            f"/api/v1/learning/enrollments/{eid}": "course player outline",
        }, lambda: add(1, 4))  # fmt: skip

        # the course builder: more sections, quizzes, questions and files
        self.client.force_login(teacher)
        course = paid[0]
        draft = self.client.post(f"/api/v1/studio/courses/{course.id}/draft").json()["version_id"]

        def grow_course():
            with tenant_context(user_id=teacher.id):
                v = CourseVersion.objects.get(pk=draft)
                for i in range(3):
                    s = cat.add_section(version=v, title=f"Part {i}")
                    quiz = cat.add_lecture(section=s, kind="quiz", title="Check").quiz
                    for _ in range(2):
                        cat.add_question(quiz=quiz, kind="single_choice", prompt="?",
                                         options=[{"body": "a", "is_correct": True}, {"body": "b"}])  # fmt: skip
                    cat.add_lecture(section=s, kind="article", title="Read", body="<p>x</p>")

        self.assertConstant({f"/api/v1/studio/courses/{course.id}": "course builder",
                             "/api/v1/studio/courses": "my courses (studio)"}, grow_course)  # fmt: skip

        # company pages: more people
        hr = User.objects.create_user("hana@acme.example.com", "x", full_name="Hana")
        acme = org_services.create_organization(name="Acme", slug="acme", owner=hr)
        H = {"HTTP_X_ORG_ID": str(acme.id)}
        fire = f.course(staff=staff, owner=staff, slug="fire", title="Fire", ownership="platform")
        self.client.force_login(hr)
        self.client.post("/api/v1/compliance/requirements", content_type="application/json",
                         data={"course_id": str(fire.id), "name": "Fire", "targets": [{}]}, **H)  # fmt: skip

        self.hire(acme, hr, 1, "first")
        with tenant_context(org_id=acme.id, user_id=hr.id):
            me = OrgMember.objects.get(org=acme, user=hr).id
        self.assertConstant({
            "/api/v1/org/people": "people", "/api/v1/compliance/matrix": "compliance matrix",
            "/api/v1/compliance/dashboard": "compliance dashboard", "/api/v1/org/units": "units",
            "/api/v1/org/library": "library", "/api/v1/identity/me": "me",
            f"/api/v1/compliance/people/{me}": "person view", f"/api/v1/org/assignments?course_id={fire.id}": "assignments",
        }, lambda: self.hire(acme, hr, 6, "more"), **H)  # fmt: skip

    def hire(self, acme, hr, n, prefix):
        with tenant_context(org_id=acme.id, user_id=hr.id):
            root = OrgUnit.objects.get(org=acme, parent__isnull=True)
            for i in range(n):
                u = User.objects.create_user(f"{prefix}{i}@acme.example.com", "x", full_name=f"{prefix} {i}")
                m = OrgMember.objects.create(org=acme, user=u, joined_at=timezone.now())
                org_services.add_member_to_unit(member=m, unit=root, primary=True)
        with tenant_context(staff=True):
            engine.refresh_org(acme.id)
