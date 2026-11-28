"""Database-free regression coverage for Reports projections and export safety."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace as NS
from unittest import TestCase
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.db.models.query import ModelIterable

from apps.platform.console import metrics, report_data, reports
from apps.platform.console.common import kpi
from core.errors import ServiceError

AT = datetime(2026, 11, 10, 12, tzinfo=UTC)


def queryset(rows):
    query = MagicMock()
    query._iterable_class = ModelIterable
    query.__iter__.side_effect = lambda: iter(rows)
    query.iterator.side_effect = lambda **kwargs: iter(rows)
    for method in ("filter", "select_related", "prefetch_related", "none"):
        getattr(query, method).return_value = query
    return query


class ReportProjectionsTest(TestCase):
    def test_half_open_days_do_not_add_midnight(self):
        start = AT.replace(hour=0)
        self.assertEqual(metrics.days(start, start + timedelta(days=1)), [start.date()])

    def test_zero_baseline_has_no_invented_percentage(self):
        self.assertIsNone(kpi(500, 0)["change_pct"])
        self.assertIsNone(kpi(0, 0)["change_pct"])
        self.assertEqual(kpi(0, 500)["change_pct"], -100)

    def test_csv_formula_injection(self):
        for value in ("=SUM(A1)", "+cmd", "-cmd", "@SUM(A1)", "  =1+1", "\n=1+1", "\t@cmd"):
            self.assertTrue(reports._cell(value).startswith("'"), value)
        self.assertEqual(reports._cell("Course title"), "Course title")
        self.assertEqual(reports._cell(None), "")
        self.assertEqual(reports._pounds(100000000000001), "1000000000000.01")

    def test_unknown_scope_and_future_range_rejected(self):
        with self.assertRaises(ServiceError):
            reports.Filters("30d", None, None, None, None, "unknown")
        tomorrow = (datetime.now(UTC) + timedelta(days=2)).date()
        with self.assertRaises(ServiceError):
            reports.Filters("custom", tomorrow, tomorrow, None, None)

    def test_scope_predicates(self):
        personal = reports.Filters("30d", None, None, None, None, "personal")
        company = reports.Filters("30d", None, None, None, None, "company")
        self.assertEqual(personal.scope_q("order__").children, [("order__org__isnull", True)])
        self.assertEqual(company.scope_q().children, [("org__isnull", False)])

    def test_series_reconciles_unknown_fx_and_order_count(self):
        rows = [
            {"at": AT, "kind": "order", "gbp_minor": 500},
            {"at": AT, "kind": "subscription", "gbp_minor": 300},
            {"at": AT, "kind": "subscription", "gbp_minor": None},
        ]
        start, end = AT - timedelta(hours=12), AT + timedelta(hours=12)
        self.assertEqual(sum(x["value"] for x in report_data.series(start, end, rows)), 800)
        self.assertEqual(
            sum(x["value"] for x in report_data.series(start, end, rows, kind="order", counts=True)), 1
        )
        self.assertEqual(len(report_data.series(start, end, rows)), 1)

    def test_receipts_use_frozen_allocations_and_paid_amounts(self):
        buyer = NS(full_name="Learner", email="learner@example.test")
        course = NS(title="Course")
        line = NS(gross_minor=800, gbp_gross_minor=400, list_minor=1000, discount_minor=200, course=course)
        order = NS(
            id=uuid4(),
            total_minor=800,
            gbp_total_minor=400,
            subtotal_minor=1000,
            discount_minor=200,
            currency=NS(exponent=2),
            currency_id="USD",
            fx_rate=Decimal(2),
            report_items=[line],
            user=buyer,
            card_brand="",
            card_last4="",
            payment_method_type="",
            paid_at=AT,
            status="partially_refunded",
        )
        plan = NS(id=uuid4(), name="Personal")
        invoices = [
            NS(
                id=uuid4(),
                number="INV1",
                user_id=uuid4(),
                user=buyer,
                amount_minor=199,
                currency_id=code,
                currency=NS(exponent=2),
                issued_at=AT,
                status="paid",
                subscription=NS(plan=plan, plan_id=plan.id),
                subscription_id=uuid4(),
            )
            for code in ("GBP", "USD")
        ]
        refund = NS(item=NS(order=order, gross_minor=800, gbp_gross_minor=400), amount_minor=200)
        f = reports.Filters("30d", None, None, None, None)
        currency = MagicMock()
        currency.values_list.return_value = [("GBP", 2), ("USD", 2)]
        paid = queryset([order])
        invoice_q = queryset(invoices)
        with (
            patch.object(report_data.Currency, "objects", currency),
            patch.object(report_data.OrderItem, "objects", queryset([])),
            patch.object(metrics, "paid_orders", return_value=paid),
            patch.object(metrics, "subscription_invoices", return_value=invoice_q),
            patch.object(report_data.CourseInstalment, "objects", queryset([])),
            patch.object(report_data.Refund, "objects", queryset([refund])) as refunds,
            patch.object(report_data.TokenGrant, "objects", queryset([])) as grants,
        ):
            grants.count.return_value = 1
            data = report_data.financials(f, AT - timedelta(days=1), AT + timedelta(days=1), detail_limit=1)
        self.assertEqual(data["gbp"], 599)
        self.assertEqual(data["order_gbp"], 400)
        self.assertEqual(data["course_gbp"], 400)
        self.assertEqual(data["subscription_gbp"], 199)
        self.assertEqual(data["refunds"], 100)
        self.assertEqual(data["gross"], 500)
        self.assertEqual(data["discounts"], 100)
        self.assertEqual(data["currencies"], {"GBP": 199, "USD": 999})
        self.assertEqual(len(data["receipts"]), 1)
        self.assertEqual(sum(row["gbp_minor"] for row in data["daily"]), 599)
        self.assertEqual(sum(data["by_plan"].values()), 199)
        self.assertTrue(any("lack frozen FX" in note for note in data["notices"]))
        self.assertTrue(any("authoritative cash receipt" in note for note in data["notices"]))
        self.assertTrue(invoice_q.filter.call_args.kwargs["order__isnull"])
        self.assertEqual(refunds.filter.call_args.kwargs["status"], "succeeded")

    def test_csv_has_complete_sales_and_exponent_aware_amounts(self):
        data = {
            "range": {"start": AT, "end": AT + timedelta(days=1)},
            "scope": "all",
            "notices": [],
            "revenue_series": [],
            "orders_series": [],
            "subscription_series": [],
            "plans": [],
        }
        for key in (
            "revenue_gbp_minor",
            "course_revenue_gbp_minor",
            "subscription_revenue_gbp_minor",
            "refunds_gbp_minor",
            "orders",
            "average_order_gbp_minor",
            "students",
            "new_students",
            "active_learners",
            "courses",
            "enrolments",
            "completions",
            "active_subscriptions",
            "gross_list_gbp_minor",
            "discounts_gbp_minor",
            "net_collected_gbp_minor",
        ):
            data[key] = kpi(0, 0)
        data["recent_sales"] = [
            {
                "reference": f"sale-{i}",
                "customer": "Learner",
                "product": "Course",
                "amount_minor": 1234,
                "currency": code,
                "exponent": exponent,
                "payment_method": "",
                "at": AT,
                "status": "paid",
            }
            for i, (code, exponent) in enumerate([("JPY", 0), ("KWD", 3)] * 8)
        ]
        data["revenue_by_currency"] = [{"key": "JPY", "value": 9872}, {"key": "KWD", "value": 9872}]
        data["currency_exponents"] = {"JPY": 0, "KWD": 3}
        rows = list(reports.csv_rows(data, ["sales"]))
        self.assertIn(["JPY", "9872"], rows)
        self.assertIn(["KWD", "9.872"], rows)
        sales = [row for row in rows if row and str(row[0]).startswith("sale-")]
        self.assertEqual(len(sales), 16)
        self.assertEqual(sales[0][3], "1234")
        self.assertEqual(sales[1][3], "1.234")

    def test_export_cutoff_preserves_relative_window(self):
        f = reports.Filters("30d", None, None, None, None, as_of=AT)
        self.assertEqual(f.r.end, AT)
        self.assertEqual(f.r.start, AT - timedelta(days=30))
        self.assertEqual(f.r.previous_end, f.r.start)
        self.assertEqual(f.r.previous_start, AT - timedelta(days=60))

    def test_end_just_after_midnight_includes_last_day(self):
        start = AT.replace(hour=0)
        end = start + timedelta(days=1, microseconds=1)
        rows = [{"at": end - timedelta(microseconds=1), "kind": "order", "gbp_minor": 1}]
        result = report_data.series(start, end, rows)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[-1]["value"], 1)
