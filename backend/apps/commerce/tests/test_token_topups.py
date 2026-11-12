"""B2C-04 tests: token top-up webhook fulfillment & idempotency."""

import uuid
from decimal import Decimal

from apps.commerce import wallet, webhooks
from apps.commerce.models import TokenGrant, TokenLedgerEntry, TokenPack, TokenRate
from apps.identity.models import User
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase


class TokenPackWebhookTest(SchemaTransactionTestCase):
    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        with tenant_context(user_id=None, staff=True):
            self.user = User.objects.create_user(
                f"topup-test-{tag}@learnhub-demo.com",
                "test123",
                is_staff=False,
            )
            from apps.commerce.models import PriceTier

            self.tier, _ = PriceTier.objects.get_or_create(
                name=f"Pack Tier {tag}", defaults={"gbp_minor": 500}
            )
            self.pack = TokenPack.objects.create(
                name=f"50 Tokens {tag}",
                token_amount=50,
                price_tier=self.tier,
                is_active=True,
                sort_order=1,
            )

    def _session(self, *, session_id=None, kind="token_pack", extra_meta=None):
        sid = session_id or f"cs_test_{uuid.uuid4().hex[:12]}"
        meta = {
            "kind": kind,
            "id": str(self.pack.id),
            "user_id": str(self.user.id),
            "token_amount": "50",
        }
        if extra_meta:
            meta.update(extra_meta)
        return {
            "id": sid,
            "payment_status": "paid",
            "amount_total": 500,
            "currency": "gbp",
            "metadata": meta,
        }

    def test_pack_fulfil_creates_grant(self):
        session = self._session()
        with tenant_context(staff=True):
            webhooks._fulfil_token_pack(session, session["metadata"])
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 50)
            grant = TokenGrant.objects.filter(user=self.user).first()
            self.assertIsNotNone(grant)
            self.assertEqual(grant.source, "pack")
            self.assertEqual(grant.amount, 50)
            self.assertEqual(grant.unit_cost_gbp, Decimal("10.0000"))

    def test_pack_fulfil_idempotent(self):
        session = self._session(session_id="cs_test_idem_pack")
        with tenant_context(staff=True):
            webhooks._fulfil_token_pack(session, session["metadata"])
            webhooks._fulfil_token_pack(session, session["metadata"])
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 50)
            self.assertEqual(TokenGrant.objects.filter(user=self.user).count(), 1)

    def test_pack_fulfil_ignores_unpaid(self):
        session = self._session()
        session["payment_status"] = "unpaid"
        with tenant_context(staff=True):
            webhooks._fulfil_token_pack(session, session["metadata"])
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 0)

    def test_pack_fulfil_creates_ledger_entry(self):
        session = self._session()
        with tenant_context(staff=True):
            webhooks._fulfil_token_pack(session, session["metadata"])
        with tenant_context(user_id=str(self.user.id), staff=True):
            entry = TokenLedgerEntry.objects.filter(user=self.user, kind="grant").first()
            self.assertIsNotNone(entry)
            self.assertEqual(entry.amount, 50)
            self.assertEqual(entry.balance_after, 50)


class TokenTopUpWebhookTest(SchemaTransactionTestCase):
    def setUp(self):
        tag = uuid.uuid4().hex[:8]
        with tenant_context(user_id=None, staff=True):
            self.user = User.objects.create_user(
                f"topup-custom-{tag}@learnhub-demo.com",
                "test123",
                is_staff=False,
            )
            from django.utils import timezone

            self.rate = TokenRate.objects.create(
                tokens_per_gbp_minor=Decimal("0.1000"),
                effective_from=timezone.now(),
                created_by=None,
            )

    def _session(self, *, session_id=None, token_amount=100, gbp_minor=1000):
        sid = session_id or f"cs_test_{uuid.uuid4().hex[:12]}"
        return {
            "id": sid,
            "payment_status": "paid",
            "amount_total": gbp_minor,
            "currency": "gbp",
            "metadata": {
                "kind": "token_topup",
                "user_id": str(self.user.id),
                "token_amount": str(token_amount),
                "amount_minor": str(gbp_minor),
                "currency": "GBP",
                "rate_id": str(self.rate.id),
                "gbp_minor": str(gbp_minor),
            },
        }

    def test_topup_fulfil_creates_grant(self):
        session = self._session()
        with tenant_context(staff=True):
            webhooks._fulfil_token_topup(session, session["metadata"])
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 100)
            grant = TokenGrant.objects.filter(user=self.user).first()
            self.assertIsNotNone(grant)
            self.assertEqual(grant.source, "topup")
            self.assertEqual(grant.amount, 100)
            self.assertEqual(grant.unit_cost_gbp, Decimal("10.0000"))

    def test_topup_fulfil_idempotent(self):
        session = self._session(session_id="cs_test_idem_topup")
        with tenant_context(staff=True):
            webhooks._fulfil_token_topup(session, session["metadata"])
            webhooks._fulfil_token_topup(session, session["metadata"])
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 100)
            self.assertEqual(TokenGrant.objects.filter(user=self.user).count(), 1)

    def test_topup_fulfil_ignores_unpaid(self):
        session = self._session()
        session["payment_status"] = "unpaid"
        with tenant_context(staff=True):
            webhooks._fulfil_token_topup(session, session["metadata"])
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 0)

    def test_topup_zero_amount_ignored(self):
        session = self._session(token_amount=0)
        with tenant_context(staff=True):
            webhooks._fulfil_token_topup(session, session["metadata"])
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 0)

    def test_dispatch_routes_token_pack(self):
        """dispatch() routes kind=token_pack to _fulfil_token_pack."""
        session = {
            "id": f"cs_test_{uuid.uuid4().hex[:12]}",
            "payment_status": "paid",
            "amount_total": 500,
            "currency": "gbp",
            "metadata": {
                "kind": "token_pack",
                "id": str(uuid.uuid4()),
                "user_id": str(self.user.id),
                "token_amount": "25",
            },
        }
        event = {
            "type": "checkout.session.completed",
            "data": {"object": session},
        }
        with tenant_context(staff=True):
            webhooks.dispatch(event)
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 25)

    def test_dispatch_routes_token_topup(self):
        """dispatch() routes kind=token_topup to _fulfil_token_topup."""
        session = self._session(token_amount=30, gbp_minor=300)
        event = {
            "type": "checkout.session.completed",
            "data": {"object": session},
        }
        with tenant_context(staff=True):
            webhooks.dispatch(event)
        with tenant_context(user_id=str(self.user.id), staff=True):
            self.assertEqual(wallet.get_balance(self.user), 30)
