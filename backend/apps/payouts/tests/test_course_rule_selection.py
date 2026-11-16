"""A course exception can target one of several instructors."""

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from django.test import SimpleTestCase

from apps.payouts.services import match_rule


class CourseRuleSelectionTest(SimpleTestCase):
    def test_selected_instructor_rule_leaves_co_instructor_on_general_rule(self):
        course, first, second = uuid4(), uuid4(), uuid4()
        created = datetime(2026, 1, 1, tzinfo=UTC)
        general = SimpleNamespace(
            scope="course",
            target_id=course,
            instructor_id=None,
            priority=0,
            created_at=created,
            instructor_bps=3700,
        )
        specific = SimpleNamespace(
            scope="course",
            target_id=course,
            instructor_id=second,
            priority=0,
            created_at=created,
            instructor_bps=7000,
        )
        args = {"course_id": course, "category_id": None, "price_gbp_minor": 3499}

        self.assertIs(match_rule([specific, general], user_id=first, **args), general)
        self.assertIs(match_rule([general, specific], user_id=second, **args), specific)
