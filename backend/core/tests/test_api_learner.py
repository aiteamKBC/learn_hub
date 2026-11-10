"""The learner API end to end, through real sessions, middleware and RLS. Only Stripe
is faked (at the gateway). These are the calls the React app makes."""

from unittest import mock

from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.commerce import services as shop
from apps.commerce.models import Coupon
from apps.learning.models import Enrollment
from apps.org import services as org_services
from apps.org.models import OrgMember
from core.tenancy import tenant_context
from core.tests import factories as f
from core.tests.base import SchemaTransactionTestCase

API = "/api/v1"


def fake_session(**kw):
    return {"id": f"cs_{kw['metadata']['id']}", "url": "https://checkout.stripe.test/c"}


class ApiBase(SchemaTransactionTestCase):
    def setUp(self):
        self.staff, self.teacher, self.sara, self.omar = f.users()
        self.category = f.money(self.staff)
        self.django = f.course(staff=self.staff, owner=self.teacher, slug="django-apis", title="Django APIs",
                               category=self.category)  # fmt: skip
        self.react = f.course(staff=self.staff, owner=self.teacher, slug="react-basics", title="React Basics",
                              category=self.category, tier="Tier 2")  # fmt: skip
        self.git = f.course(
            staff=self.staff, owner=self.teacher, slug="git-basics", title="Git Basics", free=True
        )

    def login(self, user):
        self.client.force_login(user)

    def get(self, path, **headers):
        return self.client.get(API + path, **headers)

    def post(self, path, data=None, **headers):
        return self.client.post(API + path, data=data or {}, content_type="application/json", **headers)

    def put(self, path, data):
        return self.client.put(API + path, data=data, content_type="application/json")

    def buy(self, user, *courses, currency="GBP"):
        """Checkout through the API, then the (faked) Stripe confirmation."""
        self.login(user)
        with mock.patch("apps.commerce.gateway.create_checkout_session", side_effect=fake_session):
            r = self.post(
                "/commerce/checkout", {"course_ids": [str(c.id) for c in courses], "currency": currency}
            )
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        if body["checkout_url"]:
            with tenant_context(user_id=self.staff.id, staff=True):
                from apps.commerce.gateway import to_stripe_amount

                shop.fulfil_order(order_id=body["order_id"], payment_intent=f"pi_{body['order_id'][:8]}",
                                  amount_minor=to_stripe_amount(body["total_minor"], currency, 2), currency=currency)  # fmt: skip
        return body


class CatalogApiTest(ApiBase):
    def test_browse_search_detail_and_privacy(self):
        r = self.get("/catalog/courses?sort=newest&limit=2&currency=USD")
        self.assertEqual(r.status_code, 200)
        page = r.json()
        self.assertEqual(len(page["items"]), 2)
        self.assertEqual(page["items"][0]["price"]["currency"], "USD")
        nxt = self.get(f"/catalog/courses?sort=newest&limit=2&cursor={page['next_cursor']}").json()
        self.assertEqual(len(nxt["items"]), 1)  # the third course, no duplicates
        self.assertNotIn(nxt["items"][0]["id"], {c["id"] for c in page["items"]})

        hits = self.get("/catalog/courses?q=django").json()["items"]
        self.assertEqual([c["slug"] for c in hits], ["django-apis"])
        self.assertEqual(self.get("/catalog/courses?price=free").json()["items"][0]["slug"], "git-basics")

        with CaptureQueriesContext(connection) as q:
            self.get("/catalog/courses?limit=24")
        self.assertLessEqual(len(q), 8)  # page + instructors + one price quote, for any page size

        d = self.get("/catalog/courses/django-apis").json()
        self.assertEqual(d["price"]["list_minor"], 3499)
        self.assertEqual(len(d["sections"][0]["lectures"]), 4)
        self.assertEqual(d["viewer"], {"enrollment_id": None, "progress_pct": None, "in_cart": False,
                                       "in_wishlist": False, "is_instructor": False, "plan_access": False})  # fmt: skip
        key = d["sections"][0]["lectures"][0]["key"]
        self.assertEqual(
            self.get(f"/catalog/courses/django-apis/preview/{key}").json()["kind"], "placeholder"
        )
        not_preview = d["sections"][0]["lectures"][1]["key"]
        self.assertEqual(self.get(f"/catalog/courses/django-apis/preview/{not_preview}").status_code, 404)

        hr = self.omar
        acme = org_services.create_organization(name="Acme", slug="acme", owner=hr)
        f.course(staff=self.staff, owner=hr, slug="acme-induction", title="Acme Induction", ownership="organization",
                 org_id=acme.id)  # fmt: skip
        self.assertEqual(self.get("/catalog/courses/acme-induction").status_code, 404)  # signed out
        self.login(hr)
        self.assertEqual(
            self.get("/catalog/courses/acme-induction", HTTP_X_ORG_ID=str(acme.id)).status_code, 200
        )
        self.login(self.sara)
        self.assertEqual(
            self.get("/catalog/courses/acme-induction", HTTP_X_ORG_ID=str(acme.id)).status_code, 404
        )


class CommerceApiTest(ApiBase):
    def test_thank_you_page_completes_a_paid_order_without_the_webhook(self):
        self.login(self.sara)
        with mock.patch("apps.commerce.gateway.create_checkout_session", side_effect=fake_session):
            order = self.post(
                "/commerce/checkout", {"course_ids": [str(self.django.id)], "currency": "GBP"}
            ).json()
        path = f"/commerce/orders/{order['order_id']}"
        paid = {"id": "cs_1", "payment_status": "paid", "payment_intent": "pi_9", "amount_total": 3499,
                "currency": "gbp", "metadata": {"kind": "order", "id": order["order_id"]}}  # fmt: skip
        cache.clear()
        with mock.patch(
            "apps.commerce.gateway.retrieve_checkout_session", return_value={**paid, "amount_total": 1}
        ):
            self.assertEqual(self.get(path).json()["status"], "pending")  # a wrong amount is refused
        cache.clear()
        with mock.patch("apps.commerce.gateway.retrieve_checkout_session", return_value=paid) as stripe_call:
            self.assertEqual(self.get(path).json()["status"], "paid")
            self.assertEqual(self.get(path).json()["status"], "paid")  # no second Stripe call once paid
        self.assertEqual(stripe_call.call_count, 1)
        self.assertEqual(
            [c["slug"] for c in self.get("/learning/my/courses").json()["items"]], ["django-apis"]
        )

    def test_cart_coupon_checkout_webhook_and_refund(self):
        self.login(self.sara)
        self.post("/commerce/cart", {"course_id": str(self.django.id)})
        self.post("/commerce/cart", {"course_id": str(self.react.id)})
        cart = self.get("/commerce/cart?currency=GBP").json()
        self.assertEqual((cart["subtotal_minor"], cart["total_minor"]), (3499 + 1999, 3499 + 1999))
        with tenant_context(user_id=self.staff.id, staff=True):
            Coupon.objects.create(
                code="HALF", percent_off=50, starts_at=timezone.now(), created_by=self.staff
            )
        self.assertEqual(self.get("/commerce/cart?coupon=half").json()["total_minor"], 1749 + 999)
        bad = self.get("/commerce/cart?coupon=NOPE").json()
        self.assertEqual((bad["coupon_error"], bad["total_minor"]), ("This coupon is not valid.", 5498))

        with mock.patch("apps.commerce.gateway.create_checkout_session", side_effect=fake_session):
            r = self.post("/commerce/checkout", {"course_ids": [str(self.django.id)], "currency": "GBP",
                                                 "price": 1})  # a price from the browser is ignored  # fmt: skip
        order = r.json()
        self.assertEqual((order["status"], order["total_minor"]), ("pending", 3499))
        unpaid = {"payment_status": "unpaid", "metadata": {}}
        with mock.patch("apps.commerce.gateway.retrieve_checkout_session", return_value=unpaid):
            self.assertEqual(self.get(f"/commerce/orders/{order['order_id']}").json()["status"], "pending")
        self.assertEqual(self.get("/learning/my/courses").json()["items"], [])  # not until paid
        with tenant_context(user_id=self.staff.id, staff=True):
            shop.fulfil_order(
                order_id=order["order_id"], payment_intent="pi_1", amount_minor=3499, currency="gbp"
            )
        self.assertEqual(self.get(f"/commerce/orders/{order['order_id']}").json()["status"], "paid")
        mine = self.get("/learning/my/courses").json()["items"]
        self.assertEqual([c["slug"] for c in mine], ["django-apis"])
        self.assertEqual(len(self.get("/learning/my/courses?slug=django-apis").json()["items"]), 1)
        self.assertEqual(self.get("/learning/my/courses?slug=git-basics").json()["items"], [])
        self.assertEqual(len(self.get("/commerce/cart").json()["lines"]), 1)  # bought item left the cart

        self.login(self.omar)  # someone else's order is invisible
        self.assertEqual(self.get(f"/commerce/orders/{order['order_id']}").status_code, 404)
        self.login(self.sara)
        item = self.get("/commerce/orders").json()["items"][0]["items"][0]
        self.assertTrue(item["refundable"])
        with mock.patch("apps.commerce.gateway.refund", return_value="re_1"):
            self.assertEqual(
                self.post(f"/commerce/orders/items/{item['id']}/refund", {"reason": "no"}).status_code, 200
            )
        self.assertEqual(self.get("/learning/my/courses").json()["items"], [])

    def test_free_course_needs_no_payment(self):
        body = self.buy(self.sara, self.git)
        self.assertIsNone(body["checkout_url"])
        self.assertEqual(body["status"], "paid")


class PlayerApiTest(ApiBase):
    def test_player_quiz_assignment_notes_and_certificate(self):
        self.buy(self.sara, self.django)
        self.login(self.sara)
        enrol = self.get("/learning/my/courses").json()["items"][0]["enrollment_id"]
        player = self.get(f"/learning/enrollments/{enrol}").json()
        video, article, quiz, assignment = (lec["key"] for lec in player["sections"][0]["lectures"])

        v = self.get(f"/learning/enrollments/{enrol}/lectures/{video}").json()
        self.assertEqual((v["video"]["kind"], v["next_key"]), ("placeholder", article))
        self.assertEqual(self.post(f"/learning/enrollments/{enrol}/heartbeat",
                                   {"lecture_key": video, "position_sec": 120, "watched_sec": 30}).status_code, 200)  # fmt: skip
        # quizzes complete by passing, never by hand
        self.assertEqual(
            self.post(f"/learning/enrollments/{enrol}/lectures/{quiz}/complete").status_code, 400
        )
        self.assertEqual(
            self.post(f"/learning/enrollments/{enrol}/lectures/{article}/complete").json()["progress_pct"],
            25.0,
        )
        # a video with nothing uploaded yet can be ticked off by hand
        self.assertEqual(
            self.post(f"/learning/enrollments/{enrol}/lectures/{video}/complete").json()["progress_pct"],
            50.0,
        )

        attempt = self.post(f"/learning/enrollments/{enrol}/quizzes/{quiz}/attempts").json()
        self.assertNotIn("is_correct", str(attempt))  # questions never carry the answers
        answers = {}
        for q in attempt["quiz"]["questions"]:
            right = {"2+2?": "4", "Sky is green": "False"}[q["prompt"]]
            answers[q["id"]] = next(o["id"] for o in q["options"] if o["body"] == right)
        result = self.post(f"/learning/attempts/{attempt['id']}/submit", {"answers": answers}).json()
        self.assertEqual((result["passed"], result["score_pct"]), (True, 100.0))
        self.assertEqual(len(result["review"]), 2)  # revealed after submitting (quiz setting)
        first = result["review"][0]
        self.assertTrue(first["prompt"])  # the review page can be reloaded on its own
        if first["kind"] in ("single_choice", "true_false"):
            self.assertEqual(len(first["correct_option_ids"]), 1)
        self.assertNotIn("is_correct", str(result["review"]))
        self.assertEqual(
            self.post(f"/learning/attempts/{attempt['id']}/submit", {"answers": answers}).status_code, 400
        )

        sub = self.post(f"/learning/enrollments/{enrol}/assignments/{assignment}/submissions",
                        {"text": "<p>My work</p>"}).json()  # fmt: skip
        self.assertEqual(sub["status"], "submitted")
        self.assertEqual(self.post(f"/learning/enrollments/{enrol}/assignments/{assignment}/submissions",
                                   {"url": "http://insecure.test"}).status_code, 400)  # fmt: skip

        note = self.post(f"/learning/enrollments/{enrol}/notes", {"lecture_key": video, "timestamp_sec": 42,
                                                                  "body": "Remember this"}).json()  # fmt: skip
        self.assertEqual(len(self.get(f"/learning/enrollments/{enrol}/notes").json()), 1)

        def patch(body):
            return self.client.patch(
                f"{API}/learning/notes/{note['id']}", body, content_type="application/json"
            )

        self.assertEqual(patch({"timestamp_sec": 75}).json()["timestamp_sec"], 75)  # moved to another moment
        self.assertEqual(patch({"clear_timestamp": True}).json()["timestamp_sec"], None)
        self.assertEqual(patch({"body": " Edited "}).json()["body"], "Edited")

        # nobody else can play, submit, or delete notes on Sara's enrolment
        self.login(self.omar)
        self.assertEqual(self.get(f"/learning/enrollments/{enrol}").status_code, 404)
        self.assertEqual(
            self.post(f"/learning/attempts/{attempt['id']}/submit", {"answers": {}}).status_code, 404
        )
        self.assertEqual(self.client.delete(f"{API}/learning/notes/{note['id']}").status_code, 404)
        self.assertEqual(patch({"timestamp_sec": 1}).status_code, 404)

        # finish the course: the instructor grades the assignment and the video is watched
        from apps.learning import services as learning
        from apps.learning.models import Submission

        with tenant_context(user_id=self.sara.id):
            e = Enrollment.objects.get(pk=enrol)
            learning.complete_lecture(enrollment=e, lecture_key=video)
        with tenant_context(user_id=self.teacher.id, staff=True):
            learning.grade_submission(
                submission=Submission.objects.get(pk=sub["id"]), score=90, grader=self.teacher
            )
        self.login(self.sara)
        certs = self.get("/learning/my/certificates").json()
        self.assertEqual(len(certs), 1)
        kinds = {n["kind"]: n["url"] for n in self.get("/engagement/notifications").json()["items"]}
        self.assertEqual(kinds["certificate_issued"], "/learn/certificates")
        self.assertEqual(kinds["work_marked"], f"/learn/django-apis/lecture/{assignment}")
        earned = [b["code"] for b in self.get("/engagement/my/badges").json() if b["earned_at"]]
        self.assertIn("first-course", earned)  # personal completions earn badges too
        self.client.logout()
        check = self.get(f"/learning/verify/{certs[0]['verification_code'].lower()}")
        self.assertEqual(check.status_code, 200)
        self.assertNotIn("email", check.json())

    def test_company_admin_cannot_play_as_a_member(self):
        hr = self.omar
        acme = org_services.create_organization(name="Acme", slug="acme", owner=hr)
        with tenant_context(org_id=acme.id, user_id=hr.id):
            OrgMember.objects.create(org=acme, user=self.sara, joined_at=timezone.now())
            from apps.learning import services as learning

            e = learning.enrol(user=self.sara, course=self.django, source="organization",
                                                  org_id=acme.id)  # fmt: skip
        self.login(hr)
        self.assertEqual(
            self.get(f"/learning/enrollments/{e.id}", HTTP_X_ORG_ID=str(acme.id)).status_code, 404
        )
        self.login(self.sara)
        mine = self.get("/learning/my/courses").json()["items"]
        self.assertEqual((mine[0]["org_name"], mine[0]["source"]), ("Acme", "organization"))


class EngagementApiTest(ApiBase):
    def test_reviews_questions_notifications_tickets_and_profile(self):
        self.buy(self.sara, self.django)
        self.login(self.sara)
        self.assertEqual(
            self.put(
                f"/engagement/courses/{self.django.id}/review", {"rating": 5, "body": "Great"}
            ).status_code,
            200,
        )
        mine = self.get(f"/engagement/courses/{self.django.id}/my-review").json()
        self.assertEqual((mine["can_review"], mine["review"]["rating"]), (True, 5))
        self.login(self.omar)  # not enrolled: no review, may not write one
        self.assertEqual(
            self.get(f"/engagement/courses/{self.django.id}/my-review").json(),
            {"can_review": False, "review": None},
        )
        self.assertIsInstance(self.get("/engagement/my/badges").json(), list)
        self.client.logout()
        reviews = self.get(f"/engagement/courses/{self.django.id}/reviews").json()["items"]
        self.assertEqual((reviews[0]["rating"], reviews[0]["author"]["name"]), (5, "Sara Ahmed"))
        self.assertNotIn("email", str(reviews))

        self.login(self.sara)
        q = self.post(
            f"/engagement/courses/{self.django.id}/questions", {"title": "Why ORM?", "body": "?"}
        ).json()
        self.login(self.teacher)
        self.post(f"/engagement/questions/{q['id']}/answers", {"body": "Because"})
        self.login(self.omar)  # not enrolled: cannot ask or answer
        self.assertEqual(
            self.post(f"/engagement/questions/{q['id']}/answers", {"body": "x"}).status_code, 403
        )
        self.login(self.sara)
        detail = self.get(f"/engagement/questions/{q['id']}").json()
        self.assertEqual((detail["answer_count"], detail["answers"][0]["is_instructor"]), (1, True))

        inbox = self.get("/engagement/notifications").json()
        self.assertGreaterEqual(inbox["unread"], 1)
        self.post("/engagement/notifications/read", {"ids": None})
        self.assertEqual(self.get("/engagement/notifications/unread-count").json()["unread"], 0)

        t = self.post(
            "/engagement/tickets", {"subject": "Help", "category": "technical", "body": "It broke"}
        ).json()
        self.assertEqual(len(self.get(f"/engagement/tickets/{t['id']}").json()["messages"]), 1)
        self.post(f"/engagement/tickets/{t['id']}/messages", {"body": "Still broken"})
        self.post(f"/engagement/tickets/{t['id']}/close")
        self.assertEqual(self.get("/engagement/tickets").json()[0]["status"], "closed")
        self.login(self.omar)
        self.assertEqual(self.get(f"/engagement/tickets/{t['id']}").status_code, 404)

        self.login(self.sara)
        me = self.client.patch(f"{API}/identity/me", data={"preferred_currency": "usd"},
                               content_type="application/json").json()  # fmt: skip
        self.assertEqual(me["preferred_currency"], "USD")
        self.assertEqual(self.get("/catalog/courses/react-basics").json()["price"]["currency"], "USD")
        bad = self.client.patch(
            f"{API}/identity/me", data={"timezone": "Mars/Base"}, content_type="application/json"
        )
        self.assertEqual(bad.status_code, 400)
        named = self.client.patch(f"{API}/identity/me", data={"full_name": " <b>Sara</b> Ahmed "},
                                  content_type="application/json").json()  # fmt: skip
        self.assertEqual(named["full_name"], "Sara Ahmed")
        blank = self.client.patch(
            f"{API}/identity/me", data={"full_name": "  "}, content_type="application/json"
        )
        self.assertEqual(blank.status_code, 400)
