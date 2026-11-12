"""B2C-02 wallet tests: grant, FEFO spend, admin adjust, expiry."""

import uuid
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from apps.commerce import wallet
from apps.commerce.models import TokenGrant, TokenLedgerEntry, TokenSpend
from apps.commerce.wallet import InsufficientTokens
from apps.identity.models import User
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class WalletTestCase(SchemaTransactionTestCase):
    def setUp(self):
        with tenant_context(user_id=None, staff=True):
            self.user = User.objects.create_user(
                "wallet-test@learnhub-demo.com",
                "test123",
                is_staff=False,
            )
            self.staff = User.objects.create_user(
                "wallet-staff@learnhub-demo.com",
                "test123",
                is_staff=True,
            )

    def _grant(self, amount, expires_at=None, source="pack", unit_cost_gbp=None, stripe_session_id=None):
        with tenant_context(user_id=str(self.staff.id), staff=True):
            return wallet.grant_tokens(
                user=self.user,
                source=source,
                amount=amount,
                unit_cost_gbp=unit_cost_gbp,
                expires_at=expires_at,
                stripe_session_id=stripe_session_id,
                actor=self.staff,
            )

    def _spend(self, tokens, scope="lecture", target_id=None):
        target_id = target_id or uuid.uuid4()
        with tenant_context(user_id=str(self.user.id), staff=True):
            return wallet.spend_tokens(
                user=self.user,
                scope=scope,
                target_id=target_id,
                tokens=tokens,
                actor=self.user,
            )

    # ---------------------------------------------------------------- grant
    def test_grant_creates_ledger_entry(self):
        g = self._grant(100)
        self.assertEqual(g.amount, 100)
        self.assertEqual(g.remaining, 100)
        with tenant_context(user_id=str(self.staff.id), staff=True):
            entry = TokenLedgerEntry.objects.filter(grant=g).first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.kind, "grant")
        self.assertEqual(entry.amount, 100)

    def test_balance_returns_sum(self):
        self._grant(60)
        self._grant(40)
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 100)

    def test_idempotent_grant(self):
        g1 = self._grant(50, stripe_session_id="cs_test_abc")
        g2 = self._grant(50, stripe_session_id="cs_test_abc")
        self.assertEqual(g1.id, g2.id)
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 50)

    # ---------------------------------------------------------------- FEFO spend
    def test_spend_fefo_order(self):
        now = timezone.now()
        self._grant(50, expires_at=now + timedelta(days=1))
        self._grant(50, expires_at=now + timedelta(days=7))
        self._spend(70)
        with tenant_context(user_id=str(self.staff.id), staff=True):
            grants = list(TokenGrant.objects.filter(user=self.user).order_by("expires_at"))
        self.assertEqual(grants[0].remaining, 0)
        self.assertEqual(grants[1].remaining, 30)

    def test_spend_nulls_last(self):
        now = timezone.now()
        g_null = self._grant(50, expires_at=None)
        g_exp = self._grant(50, expires_at=now + timedelta(days=1))
        self._spend(30)
        with tenant_context(user_id=str(self.staff.id), staff=True):
            g_null.refresh_from_db()
            g_exp.refresh_from_db()
        self.assertEqual(g_exp.remaining, 20)
        self.assertEqual(g_null.remaining, 50)

    def test_spend_insufficient_raises(self):
        self._grant(10)
        with self.assertRaises(InsufficientTokens):
            self._spend(20)

    def test_spend_creates_ledger_and_spend(self):
        self._grant(100)
        target = uuid.uuid4()
        spend = self._spend(30, target_id=target)
        self.assertIsInstance(spend, TokenSpend)
        self.assertEqual(spend.tokens_total, 30)
        with tenant_context(user_id=str(self.staff.id), staff=True):
            entry = TokenLedgerEntry.objects.filter(spend=spend).first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.kind, "spend")
        self.assertEqual(entry.amount, -30)
        self.assertEqual(entry.balance_after, 70)

    def test_spend_weighted_cost(self):
        self._grant(60, unit_cost_gbp="0.1000")
        self._grant(40, unit_cost_gbp="0.2000")
        spend = self._spend(100)
        expected = (Decimal("60") * Decimal("0.1000") + Decimal("40") * Decimal("0.2000")) / Decimal("100")
        self.assertEqual(spend.weighted_unit_cost_gbp, expected.quantize(Decimal("0.0001")))

    def test_grant_no_double_spend(self):
        self._grant(50)
        self._spend(50)
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 0)
        with self.assertRaises(InsufficientTokens):
            self._spend(1)

    # ---------------------------------------------------------------- admin adjust
    def test_admin_adjust_positive(self):
        with tenant_context(user_id=str(self.staff.id), staff=True):
            wallet.admin_adjust(user=self.user, amount=50, note="Comp tokens", actor=self.staff)
            self.assertEqual(wallet.get_balance(self.user), 50)

    def test_admin_adjust_negative(self):
        self._grant(100)
        with tenant_context(user_id=str(self.staff.id), staff=True):
            wallet.admin_adjust(user=self.user, amount=-30, note="Penalty", actor=self.staff)
            self.assertEqual(wallet.get_balance(self.user), 70)

    def test_admin_adjust_negative_insufficient(self):
        self._grant(10)
        with tenant_context(user_id=str(self.staff.id), staff=True):
            with self.assertRaises(InsufficientTokens):
                wallet.admin_adjust(user=self.user, amount=-20, note="Too much", actor=self.staff)

    # ---------------------------------------------------------------- expiry
    def test_expire_grants(self):
        past = timezone.now() - timedelta(hours=1)
        with tenant_context(user_id=str(self.staff.id), staff=True):
            TokenGrant.objects.create(
                user=self.user,
                source="pack",
                amount=50,
                remaining=30,
                granted_at=past - timedelta(days=10),
                expires_at=past,
            )
            count = wallet.expire_grants()
        self.assertEqual(count, 1)
        with tenant_context(user_id=str(self.staff.id), staff=True):
            g = TokenGrant.objects.filter(user=self.user).first()
        self.assertEqual(g.remaining, 0)
        self.assertIsNotNone(g.expired_at)

    def test_balance_excludes_expired(self):
        self._grant(100)
        past = timezone.now() - timedelta(hours=1)
        with tenant_context(user_id=str(self.staff.id), staff=True):
            TokenGrant.objects.create(
                user=self.user,
                source="pack",
                amount=50,
                remaining=50,
                granted_at=past - timedelta(days=10),
                expires_at=past,
                expired_at=past,
            )
            self.assertEqual(wallet.get_balance(self.user), 100)
