"""Platform: transactional outbox, append-only audit trail, entitlements from payments,
Bunny webhooks (signature, duplicates, forward-only status) and cached settings."""

import hashlib
import hmac
import json
from datetime import timedelta
from unittest import mock

from django.db import DatabaseError, connection, transaction
from django.test import override_settings
from django.utils import timezone

from apps.catalog import services as cat
from apps.catalog.models import VideoLibrary
from apps.identity.models import User
from apps.org import services as org_services
from apps.platform import outbox, services
from apps.platform.models import Entitlement, OutboxEvent, WebhookEvent
from core.tenancy import tenant_context
from core.tests.base import SchemaTransactionTestCase

SECRET = "bunny-readonly-test-key"


class PlatformBase(SchemaTransactionTestCase):
    def setUp(self):
        self.staff = User.objects.create_user("staff@learnhub-demo.com", "x", is_staff=True)
        self.hr = User.objects.create_user("hr@acme-demo.com", "x")
        self.bob = User.objects.create_user("bob@beta-demo.com", "x")
        self.acme = org_services.create_organization(name="Acme", slug="acme", owner=self.hr)
        self.beta = org_services.create_organization(name="Beta", slug="beta", owner=self.bob)
        self.STAFF = {"user_id": self.staff.id, "staff": True}


class OutboxTest(PlatformBase):
    def test_events_commit_with_their_transaction_and_retry_on_failure(self):
        seen, fail = [], {"left": 1}

        @outbox.subscribe("test.ping")
        def handler(payload):
            if fail["left"]:
                fail["left"] -= 1
                raise RuntimeError("downstream down")
            seen.append(payload["n"])

        with mock.patch("apps.platform.tasks.dispatch_outbox_task.delay"):  # dispatch by hand below
            try:
                with tenant_context(user_id=self.hr.id):
                    outbox.publish("test.ping", {"n": 1})
                    raise ValueError("business change failed")
            except ValueError:
                pass
            with tenant_context(user_id=self.hr.id):
                outbox.publish("test.ping", {"n": 2})
                with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cur:
                    cur.execute("SELECT count(*) FROM platform.outbox_events")  # visible to nobody but jobs
                    if cur.fetchone()[0] == 0:
                        raise DatabaseError("hidden")
        with tenant_context(**self.STAFF):
            self.assertEqual(OutboxEvent.objects.count(), 1)  # the rolled-back event never existed
        with self.assertLogs("apps.platform.outbox", "ERROR"):
            self.assertEqual(outbox.dispatch(), 0)  # first attempt fails, retry scheduled
        with tenant_context(**self.STAFF):
            ev = OutboxEvent.objects.get()
            self.assertEqual((ev.attempts, "downstream down" in ev.last_error), (1, True))
            OutboxEvent.objects.update(available_at=timezone.now())
        self.assertEqual(outbox.dispatch(), 1)
        self.assertEqual(outbox.dispatch(), 0)  # processed once
        self.assertEqual(seen, [2])


class AuditTest(PlatformBase):
    def test_append_only_own_actor_own_company(self):
        with tenant_context(org_id=self.acme.id, user_id=self.hr.id):
            services.audit("member.invite", "invite", "abc", actor_id=self.hr.id, org_id=self.acme.id)
            with self.assertRaises(DatabaseError), transaction.atomic():  # cannot write as someone else
                services.audit("x", "y", "z", actor_id=self.bob.id, org_id=self.acme.id)
            with self.assertRaises(DatabaseError), transaction.atomic():  # nor into another company
                services.audit("x", "y", "z", actor_id=self.hr.id, org_id=self.beta.id)
            for sql in (
                "UPDATE platform.audit_logs SET action = 'nothing'",
                "DELETE FROM platform.audit_logs",
            ):
                with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cur:
                    cur.execute(sql)
            with connection.cursor() as cur:
                cur.execute("SELECT action FROM platform.audit_logs")
                self.assertEqual(cur.fetchall(), [("member.invite",)])
        with tenant_context(org_id=self.beta.id, user_id=self.bob.id), connection.cursor() as cur:
            cur.execute("SELECT count(*) FROM platform.audit_logs")
            self.assertEqual(cur.fetchone()[0], 0)

    @override_settings(NINJA_NUM_PROXIES=1)
    def test_client_ip_trusts_only_the_configured_proxies(self):
        req = mock.Mock(META={"HTTP_X_FORWARDED_FOR": "6.6.6.6, 203.0.113.9", "REMOTE_ADDR": "10.0.0.1"})
        self.assertEqual(services.client_ip(req), "203.0.113.9")  # the spoofed first hop is ignored


class EntitlementsTest(PlatformBase):
    def test_sync_from_subscription_and_holder_visibility(self):
        sub_id = "0195c0de-0000-7000-8000-0000000000aa"
        end = timezone.now() + timedelta(days=30)
        services.sync_entitlement(feature="business", source="subscription", source_ref=sub_id, active=True,
                                  ends_at=end, org_id=self.acme.id, seats_count=25)  # fmt: skip
        with tenant_context(org_id=self.acme.id, user_id=self.hr.id):
            self.assertTrue(services.has_feature("business", org_id=self.acme.id))
            self.assertEqual(services.seats("business", org_id=self.acme.id), 25)
            with self.assertRaises(DatabaseError), transaction.atomic():
                Entitlement.objects.create(feature="content_protection", source="grant", org_id=self.acme.id,
                                           starts_at=timezone.now())  # fmt: skip
        with tenant_context(org_id=self.beta.id, user_id=self.bob.id):
            self.assertFalse(services.has_feature("business", org_id=self.acme.id))  # invisible
        services.sync_entitlement(feature="business", source="subscription", source_ref=sub_id, active=False,
                                  ends_at=end, org_id=self.acme.id, seats_count=25)  # fmt: skip
        with tenant_context(org_id=self.acme.id, user_id=self.hr.id):
            self.assertFalse(services.has_feature("business", org_id=self.acme.id))
            self.assertEqual(Entitlement.objects.count(), 1)  # updated in place, not duplicated


@override_settings(BUNNY_STREAM={"READONLY_KEY": SECRET})
class BunnyWebhookTest(PlatformBase):
    def post(self, body: dict, secret=SECRET):
        raw = json.dumps(body).encode()
        sig = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        return self.client.post(
            "/api/v1/platform/webhooks/bunny", data=raw, content_type="application/json",
            HTTP_X_BUNNYSTREAM_SIGNATURE_VERSION="v1", HTTP_X_BUNNYSTREAM_SIGNATURE_ALGORITHM="hmac-sha256",
            HTTP_X_BUNNYSTREAM_SIGNATURE=sig,
        )  # fmt: skip

    def test_signed_deduplicated_and_forward_only(self):
        guid = "7d4c7c0e-1f3b-4b8e-9a51-6f0e1d2c3b4a"
        with tenant_context(**self.STAFF):
            lib = VideoLibrary.objects.create(
                name="Std", environment="test", bunny_library_id=1, cdn_hostname="vz.t"
            )
            asset = cat.create_media(kind="video", library=lib, uploaded_by=self.staff, bunny_video_guid=guid)
        self.assertEqual(
            self.post({"VideoLibraryId": 1, "VideoGuid": guid, "Status": 3}, secret="wrong").status_code, 401
        )
        self.assertEqual(
            self.post({"VideoLibraryId": 1, "VideoGuid": guid, "Status": 3}).json()["duplicate"], False
        )
        self.assertEqual(
            self.post({"VideoLibraryId": 1, "VideoGuid": guid, "Status": 3}).json()["duplicate"], True
        )
        self.post({"VideoLibraryId": 1, "VideoGuid": guid, "Status": 2})  # late "encoding"
        with tenant_context(**self.STAFF):
            asset.refresh_from_db()
            self.assertEqual((asset.status, asset.encode_progress, asset.bunny_status), ("ready", 100, 2))
            self.assertEqual(WebhookEvent.objects.filter(processed_at__isnull=False).count(), 2)


class SettingsTest(PlatformBase):
    def test_cached_and_invalidated(self):
        self.assertEqual(services.get_setting("signup.enabled", True), True)
        with tenant_context(**self.STAFF):
            services.set_setting(key="signup.enabled", value=False, by=self.staff, is_public=True)
        self.assertIs(services.get_setting("signup.enabled", True), False)
        # registered public settings come with their defaults; other public rows are added
        self.assertIs(self.client.get("/api/v1/platform/settings").json()["signup.enabled"], False)
