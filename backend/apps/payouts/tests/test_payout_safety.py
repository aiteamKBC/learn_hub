"""Offline regressions: no database, Redis, notifications or provider requests."""

from contextlib import nullcontext
from datetime import date, timedelta
from types import SimpleNamespace
from unittest import mock

import stripe
from django.test import SimpleTestCase
from django.utils import timezone

from apps.payouts import execution, safety, selectors, services
from core.errors import ServiceError


class PayoutSafetyTests(SimpleTestCase):
    def test_request_rejects_zero_negative_excess_and_duplicates_at_service_boundary(self):
        state = {"can_request": True, "minimum_gbp_minor": 0, "balance": {"available": 5000}}
        with mock.patch.object(services, "tenant_context", side_effect=lambda **kw: nullcontext()), mock.patch.object(
            safety, "lock_payouts"
        ), mock.patch.object(services, "request_status", return_value=state), mock.patch.object(
            services.PayoutRequest, "objects"
        ) as requests:
            for amount in (0, -100, 5001):
                with self.subTest(amount=amount), self.assertRaises(ServiceError):
                    services.create_request.__wrapped__(user=SimpleNamespace(id="u"), amount_gbp_minor=amount, method="bank")
            state.update(can_request=False, reason="You already have a payout request in progress.")
            with self.assertRaises(ServiceError) as error:
                services.create_request.__wrapped__(user=SimpleNamespace(id="u"), amount_gbp_minor=2500, method="bank")
            self.assertEqual(error.exception.code, "cannot_request")
            requests.create.assert_not_called()

    def test_calendar_month_boundary_and_configured_day(self):
        with mock.patch("apps.platform.services.get_setting", side_effect=lambda key: {
            "payouts.schedule": "monthly", "payouts.day_of_month": 5,
        }[key]):
            self.assertEqual(services.next_payout_date(date(2026, 12, 6)), date(2027, 1, 5))
            self.assertEqual(services.next_payout_date(date(2026, 12, 5)), date(2026, 12, 5))
            self.assertFalse(services.is_payout_day(date(2026, 12, 1)))

    def test_weekly_schedule(self):
        with mock.patch("apps.platform.services.get_setting", return_value="weekly"):
            self.assertEqual(services.next_payout_date(date(2026, 11, 28)), date(2026, 11, 30))

    def test_legacy_scheduler_cannot_bypass_schedule(self):
        with mock.patch.object(services, "scheduled_run", return_value={"payouts": 0}) as run:
            self.assertEqual(services.monthly_run(date(2026, 12, 1)), {"payouts": 0})
            run.assert_called_once_with(date(2026, 12, 1))

    def test_scheduler_bundles_only_and_never_transfers(self):
        with mock.patch.object(services, "is_payout_day", return_value=True), mock.patch.object(
            services, "create_payouts", return_value=[]
        ) as bundle, mock.patch("apps.commerce.gateway.transfer") as transfer:
            self.assertEqual(services.scheduled_run(date(2026, 12, 5))["payouts"], 0)
            bundle.assert_called_once_with(period_end=date(2026, 12, 4))
            transfer.assert_not_called()

    def test_reservations_reconcile_without_counting_linked_requests_twice(self):
        row = dict(user_id="u", available=5000, pending=1000, in_payout=2000, paid=3000, total=11000)
        with mock.patch.object(selectors.PayoutRequest, "objects") as requests, mock.patch.object(
            selectors.Payout, "objects"
        ) as payouts:
            requests.filter.return_value.values.return_value.annotate.return_value.values_list.return_value = [("u", 2500)]
            payouts.filter.return_value.annotate.return_value = []
            selectors._reserve([row])
            self.assertEqual(row["available"], 2500)
            self.assertEqual(row["reserved"], 2500)
            self.assertEqual(sum(row[k] for k in ("available", "reserved", "pending", "in_payout", "paid")), row["total"])
            self.assertTrue(requests.filter.call_args.kwargs["payout__isnull"])

    def test_history_mismatch_is_reported_not_repaired(self):
        row = dict(user_id="u", available=100)
        old = SimpleNamespace(user_id="u", status="paid", amount_gbp_minor=900, ledger_total=800,
                              provider_ref="tr_old", paid_at=timezone.now(), failure_reason="")
        with mock.patch.object(selectors.PayoutRequest, "objects") as requests, mock.patch.object(
            selectors.Payout, "objects"
        ) as payouts:
            requests.filter.return_value.values.return_value.annotate.return_value.values_list.return_value = []
            payouts.filter.return_value.annotate.return_value = [old]
            selectors._reserve([row])
            self.assertTrue(row["reconciliation_required"])
            payouts.update.assert_not_called()

    def test_paid_and_uncertain_payouts_never_release_earnings(self):
        for state in ("paid", "held", "failed"):
            with self.subTest(state=state), mock.patch.object(services.Payout, "objects") as payouts, mock.patch.object(
                services.Earning, "objects"
            ) as earnings:
                payouts.select_for_update.return_value.get.return_value = SimpleNamespace(status=state)
                with self.assertRaises(ServiceError) as error:
                    services._release(SimpleNamespace(pk="id"), "failed", "operator request")
                self.assertEqual(error.exception.code, "unsafe_release")
                earnings.filter.assert_not_called()

    def test_missing_unverified_and_verified_destinations(self):
        account = SimpleNamespace(method="bank", stripe_account_id="", paypal_email="", wise_email="",
                                  bank_account_last4="4242", bank_account_name="Instructor", verified_at=None)
        self.assertFalse(safety.destination_ready(None))
        self.assertFalse(safety.destination_ready(account))
        account.verified_at = timezone.now()
        self.assertTrue(safety.destination_ready(account))
        self.assertFalse(safety.destination_ready(account, "stripe"))

    def test_immature_and_policy_blocked_earnings_cannot_execute(self):
        now = timezone.now()
        line = SimpleNamespace(user_id="u", kind="sale", amount_gbp_minor=100,
                               earned_at=now - timedelta(days=5), available_at=now - timedelta(days=1))
        with mock.patch.object(services, "hold_days", return_value=30):
            with self.assertRaises(ServiceError) as error:
                safety.validate_lines([line], user_id="u", now=now)
            self.assertEqual(error.exception.code, "immature_earnings")
            for kind in ("token_spend", "subscription"):
                line.kind, line.earned_at = kind, now - timedelta(days=40)
                with self.assertRaises(ServiceError) as error:
                    safety.validate_lines([line], user_id="u", now=now)
                self.assertEqual(error.exception.code, "policy_blocked")

    def test_confirmation_matches_amount_destination_currency_and_reversals(self):
        payout = SimpleNamespace(id="p", amount_gbp_minor=2500)
        valid = dict(id="tr_1", amount=2500, destination="acct_1", currency="gbp",
                     description="LearnHub payout p", reversed=False, amount_reversed=0)
        self.assertTrue(execution.confirmed_transfer(valid, payout, "acct_1"))
        for field, value in (("amount", 1), ("destination", "acct_other"), ("currency", "usd"),
                             ("description", "other payout"), ("reversed", True), ("amount_reversed", 1), ("id", "")):
            with self.subTest(field=field):
                self.assertFalse(execution.confirmed_transfer(valid | {field: value}, payout, "acct_1"))

    def test_uncertain_provider_outcome_retains_committed_hold(self):
        payout = mock.Mock(id="p", pk="p", status="held", failure_reason=execution.QUEUED, amount_gbp_minor=2500)
        with mock.patch.object(execution, "tenant_context", side_effect=lambda **kw: nullcontext()), mock.patch.object(
            execution, "lock_payouts"
        ), mock.patch.object(execution.Payout, "objects") as payouts, mock.patch.object(
            execution, "validate_bundle", return_value=SimpleNamespace(stripe_account_id="acct_1")
        ), mock.patch.object(execution.gateway, "payout_destination_enabled", return_value=True), mock.patch.object(
            execution.gateway, "transfer", side_effect=TimeoutError
        ) as transfer, mock.patch.object(execution, "complete") as complete:
            payouts.select_for_update.return_value.get.return_value = payout
            execution.execute("p")
            self.assertEqual(payout.status, "held")
            self.assertEqual(payout.failure_reason, execution.ATTEMPTED)
            complete.assert_not_called()
            execution.execute("p")
            transfer.assert_called_once()  # no automatic replay, even after provider idempotency expiry

    def test_unconfirmed_manual_reference_cannot_mark_paid(self):
        payout = mock.Mock(method="bank")
        with mock.patch.object(execution, "validate_bundle"), mock.patch.object(execution.transaction, "on_commit") as submit:
            with self.assertRaises(ServiceError) as error:
                execution.prepare(payout, by=None)
            self.assertEqual(error.exception.code, "provider_confirmation_required")
            payout.save.assert_not_called()
            submit.assert_not_called()

    def test_approval_defers_provider_call_until_commit(self):
        payout = mock.Mock(method="stripe", id="p")
        with mock.patch.object(execution, "validate_bundle"), mock.patch.object(execution.transaction, "on_commit") as submit, mock.patch.object(
            execution, "execute"
        ) as execute:
            execution.prepare(payout, by=None)
            self.assertEqual(payout.status, "held")
            execute.assert_not_called()
            submit.call_args.args[0]()
            execute.assert_called_once_with("p")

    def test_confirmed_insufficient_balance_releases_reservation(self):
        payout = mock.Mock(id="p", pk="p", status="held", failure_reason=execution.QUEUED, amount_gbp_minor=2500)
        with mock.patch.object(execution, "tenant_context", side_effect=lambda **kw: nullcontext()), mock.patch.object(
            execution, "lock_payouts"
        ), mock.patch.object(execution.Payout, "objects") as payouts, mock.patch.object(
            execution, "validate_bundle", return_value=SimpleNamespace(stripe_account_id="acct_1")
        ), mock.patch.object(execution.gateway, "payout_destination_enabled", return_value=True), mock.patch.object(
            execution.gateway, "transfer", side_effect=stripe.InvalidRequestError("insufficient", None, code="balance_insufficient")
        ), mock.patch.object(services.Earning, "objects") as earnings, mock.patch.object(
            execution.PayoutRequest, "objects"
        ) as requests:
            payouts.select_for_update.return_value.get.return_value = payout
            execution.execute("p")
            self.assertEqual(payout.status, "failed")
            self.assertIsNone(earnings.filter.return_value.update.call_args.kwargs["payout"])
            self.assertEqual(requests.filter.return_value.update.call_args.kwargs["status"], "failed")

    def test_repeated_confirmation_does_not_rewrite_paid_record(self):
        payout = mock.Mock(status="paid")
        execution.complete(payout, "tr_same")
        payout.save.assert_not_called()

    def test_reversed_transfer_flags_history_without_freeing_earnings(self):
        payout = mock.Mock(pk="p", id="p", user_id="u", status="paid", method="stripe",
                           provider_ref="tr_old", amount_gbp_minor=2500, failure_reason="")
        reversed_transfer = dict(id="tr_old", amount=2500, currency="gbp", destination="acct_previous",
                                 description="LearnHub payout p", reversed=True, amount_reversed=2500)
        with mock.patch.object(execution, "lock_payouts"), mock.patch.object(execution.Payout, "objects") as payouts, mock.patch.object(
            services.PayoutAccount, "objects"
        ) as accounts, mock.patch.object(execution.gateway, "retrieve_transfer", return_value=reversed_transfer), mock.patch.object(
            execution.PayoutRequest, "objects"
        ), mock.patch.object(services.Earning, "objects") as earnings, mock.patch.object(execution.gateway, "transfer") as send:
            payouts.select_for_update.return_value.get.return_value = payout
            accounts.get.return_value = SimpleNamespace(stripe_account_id="acct_current")
            execution.reconcile(payout, "tr_old")
            self.assertEqual(payout.status, "paid")
            self.assertIn("reversal", payout.failure_reason)
            earnings.filter.assert_not_called()
            send.assert_not_called()

    def test_carryover_cannot_escape_a_refund_awaiting_ledger_posting(self):
        sale = SimpleNamespace(order_item_id="item", amount_gbp_minor=5000)
        refund = SimpleNamespace(item_id="item", status="succeeded")
        with mock.patch.object(safety.Earning, "objects") as earnings, mock.patch.object(
            safety.Order, "objects"
        ), mock.patch.object(safety.Refund, "objects") as refunds:
            earnings.filter.side_effect = [[sale], []]
            refunds.filter.return_value.exclude.return_value = [refund]
            with self.assertRaises(ServiceError) as error:
                safety.validate_refund_ledger("u")
            self.assertEqual(error.exception.code, "refund_mismatch")
