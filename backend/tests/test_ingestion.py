from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import (
    AnalysisJobDeletionAuditRow,
    AnalysisJobRow,
    IntegrationOutboxRow,
    MemoryDraftRow,
    MemoryRevisionRow,
    MemoryRow,
    MemorySourceRow,
)
from app.main import create_app


def _demo_headers(client: TestClient) -> tuple[dict[str, str], dict]:
    login = client.post(
        "/api/auth/signin",
        json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
    ).json()
    return {"Authorization": f"Bearer {login['session']['token']}"}, login


def test_text_ingestion_draft_revision_delete_and_outbox_are_one_flow(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'ingestion.db').as_posix()}", seed_demo=True)
    with TestClient(app) as client:
        headers, login = _demo_headers(client)
        maya = next(item for item in login["relationships"] if item["targetName"] == "Maya Chen")

        created = client.post(
            "/api/v1/ingestion/jobs",
            headers={**headers, "X-Request-ID": "ingestion-contract-1"},
            json={
                "sourceType": "text",
                "rawText": "Maya Chen and I planned a quiet trip together.",
                "relationshipId": maya["id"],
            },
        )
        assert created.status_code == 201, created.text
        assert created.headers["x-request-id"] == "ingestion-contract-1"
        job = created.json()
        assert job["status"] == "created"
        assert job["draftId"] is None

        outsider = client.post(
            "/api/auth/signup",
            json={
                "displayName": "Ingestion Outsider",
                "email": "ingestion-outsider@example.test",
                "password": "Outside2026!",
            },
        ).json()
        outsider_headers = {"Authorization": f"Bearer {outsider['session']['token']}"}
        assert client.get(f"/api/v1/jobs/{job['id']}", headers=outsider_headers).status_code == 404

        analyzed = client.post(f"/api/v1/jobs/{job['id']}/analyze", headers=headers)
        assert analyzed.status_code == 200, analyzed.text
        analysis = analyzed.json()
        assert analysis["job"]["status"] == "awaiting_confirmation"
        assert analysis["job"]["attempt"] == 1
        draft = analysis["draft"]
        candidate = draft["candidate"]
        assert draft["status"] == "awaiting_confirmation"
        assert candidate["analysisProvider"] == "openviking-agent:test-contract-memory-agent"
        assert all(item["id"] != candidate["id"] for item in client.get("/api/cosmos", headers=headers).json()["memories"])

        rejected_transaction = client.post(
            f"/api/v1/memory-drafts/{draft['id']}/confirm",
            headers=headers,
            json={
                "expectedVersion": draft["version"],
                "memory": candidate,
                "relationshipId": "missing-relationship",
            },
        )
        assert rejected_transaction.status_code == 404
        assert client.get(f"/api/v1/jobs/{job['id']}", headers=headers).json()["status"] == "awaiting_confirmation"

        confirmed_document = {**candidate, "summary": "Maya and I confirmed plans for a quiet trip."}
        confirmed = client.post(
            f"/api/v1/memory-drafts/{draft['id']}/confirm",
            headers=headers,
            json={
                "expectedVersion": draft["version"],
                "memory": confirmed_document,
                "relationshipId": maya["id"],
                "reason": "user_reviewed_draft",
            },
        )
        assert confirmed.status_code == 201, confirmed.text
        confirmed_payload = confirmed.json()
        assert confirmed_payload["revision"]["version"] == 1
        assert confirmed_payload["revision"]["reason"] == "user_reviewed_draft"
        assert confirmed_payload["memory"]["summary"] == confirmed_document["summary"]
        assert client.get(f"/api/v1/jobs/{job['id']}", headers=headers).json()["status"] == "confirmed"
        detail = client.get(f"/api/v1/memories/{candidate['id']}", headers=headers)
        assert detail.status_code == 200, detail.text
        assert detail.json()["currentVersion"] == 1
        assert detail.json()["relationshipId"] == maya["id"]
        assert detail.json()["latestRevision"]["reason"] == "user_reviewed_draft"
        assert len(detail.json()["sources"]) == 1
        assert detail.json()["sources"][0]["draftId"] == draft["id"]
        assert client.get(
            f"/api/v1/memories/{candidate['id']}", headers=outsider_headers
        ).status_code == 404

        revised_document = {**confirmed_document, "summary": "Maya and I booked the quiet trip."}
        revised = client.patch(
            f"/api/v1/memories/{candidate['id']}",
            headers=headers,
            json={
                "expectedVersion": 1,
                "memory": revised_document,
                "reason": "trip_booked",
            },
        )
        assert revised.status_code == 200, revised.text
        assert revised.json()["revision"]["version"] == 2
        assert revised.json()["memory"]["summary"] == revised_document["summary"]
        assert client.get(
            f"/api/v1/memories/{candidate['id']}", headers=headers
        ).json()["currentVersion"] == 2

        stale = client.patch(
            f"/api/v1/memories/{candidate['id']}",
            headers=headers,
            json={"expectedVersion": 1, "memory": confirmed_document, "reason": "stale_edit"},
        )
        assert stale.status_code == 409
        revisions = client.get(
            f"/api/v1/memories/{candidate['id']}/revisions", headers=headers
        )
        assert revisions.status_code == 200
        assert [item["version"] for item in revisions.json()] == [1, 2]

        deleted = client.delete(f"/api/v1/memories/{candidate['id']}", headers=headers)
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["deleted"] is True
        assert all(item["id"] != candidate["id"] for item in deleted.json()["cosmos"]["memories"])
        assert client.get(
            f"/api/v1/memories/{candidate['id']}/revisions", headers=headers
        ).status_code == 404

    with app.state.database.session() as db:
        stored_job = db.get(AnalysisJobRow, job["id"])
        stored_draft = db.get(MemoryDraftRow, draft["id"])
        sources = list(db.query(MemorySourceRow).filter_by(analysis_job_id=job["id"]))
        outbox = list(
            db.query(IntegrationOutboxRow)
            .filter_by(aggregate_id=candidate["id"])
            .order_by(IntegrationOutboxRow.aggregate_version)
        )
        assert stored_job.status == "confirmed"
        assert stored_draft.status == "confirmed"
        assert stored_draft.confirmed_memory_id is None
        assert len(sources) == 1 and sources[0].draft_id == draft["id"] and sources[0].memory_id is None
        assert db.get(MemoryRow, candidate["id"]) is None
        assert db.query(MemoryRevisionRow).filter_by(memory_id=candidate["id"]).count() == 0
        assert [(row.event_type, row.aggregate_version) for row in outbox] == [
            ("memory.upserted", 1),
            ("memory.upserted", 2),
            ("memory.deleted", 3),
        ]
        assert all(json.loads(row.payload_json).get("redacted") for row in outbox[:2])
        assert all(row.status == "cancelled" for row in outbox[:2])


def test_failed_analysis_uses_safe_draft_without_exposing_provider_failure(tmp_path) -> None:
    class FailingProvider:
        provider_name = "failing-provider"

        async def analyze(self, request, context):
            raise TimeoutError("provider timed out")

    app = create_app(
        f"sqlite:///{(tmp_path / 'failed-analysis.db').as_posix()}",
        seed_demo=False,
        memory_agent=FailingProvider(),
    )
    with TestClient(app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={
                "displayName": "Retry Owner",
                "email": "retry-owner@example.test",
                "password": "Retry2026!",
            },
        ).json()
        headers = {"Authorization": f"Bearer {signup['session']['token']}"}
        job = client.post(
            "/api/v1/ingestion/jobs",
            headers=headers,
            json={"sourceType": "text", "rawText": "A provider failure should be retryable."},
        ).json()

        first = client.post(f"/api/v1/jobs/{job['id']}/analyze", headers=headers)
        assert first.status_code == 200, first.text
        assert first.json()["draft"] is not None
        assert first.json()["job"]["status"] == "awaiting_confirmation"
        assert first.json()["job"]["attempt"] == 1
        assert first.json()["job"]["lastError"] == ""
        assert first.json()["draft"]["candidate"]["analysisProvider"] == "local-fallback"
        assert first.json()["draft"]["candidate"]["summary"] == "A provider failure should be retryable."

        second = client.post(f"/api/v1/jobs/{job['id']}/analyze", headers=headers)
        assert second.status_code == 200, second.text
        assert second.json()["job"]["status"] == "awaiting_confirmation"
        assert second.json()["job"]["attempt"] == 1

        compatibility = client.post(
            "/api/memories/analyze",
            headers=headers,
            json={"sourceType": "text", "rawText": "Legacy callers also receive a safe draft."},
        )
        assert compatibility.status_code == 200
        assert compatibility.json()["analysisProvider"] == "local-fallback"
        assert compatibility.json()["people"] == []


def test_slow_analysis_is_cut_off_and_replaced_with_safe_draft(tmp_path, monkeypatch) -> None:
    class SlowProvider:
        provider_name = "slow-provider"

        async def analyze(self, request, context):
            await asyncio.sleep(1)
            raise AssertionError("the primary provider should have been cancelled")

    monkeypatch.setenv("MEMORY_ANALYSIS_PRIMARY_DEADLINE_SECONDS", "0.01")
    app = create_app(
        f"sqlite:///{(tmp_path / 'slow-analysis.db').as_posix()}",
        seed_demo=False,
        memory_agent=SlowProvider(),
    )
    with TestClient(app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={
                "displayName": "Deadline Owner",
                "email": "deadline-owner@example.test",
                "password": "Deadline2026!",
            },
        ).json()
        headers = {"Authorization": f"Bearer {signup['session']['token']}"}
        job = client.post(
            "/api/v1/ingestion/jobs",
            headers=headers,
            json={"sourceType": "text", "rawText": "Keep this exact submitted memory."},
        ).json()

        response = client.post(f"/api/v1/jobs/{job['id']}/analyze", headers=headers)

        assert response.status_code == 200
        assert response.json()["job"]["status"] == "awaiting_confirmation"
        candidate = response.json()["draft"]["candidate"]
        assert candidate["analysisProvider"] == "local-fallback"
        assert candidate["rawText"] == "Keep this exact submitted memory."
        assert candidate["people"] == []


def test_legacy_screenshot_analysis_contract_remains_available(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'legacy-screenshot.db').as_posix()}", seed_demo=True)
    with TestClient(app) as client:
        headers, _login = _demo_headers(client)
        response = client.post(
            "/api/memories/analyze",
            headers=headers,
            json={"sourceType": "chat_screenshot", "imageName": "friends-chat.png"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["sourceType"] == "chat_screenshot"
        assert response.json()["summary"] == "friends-chat.png"


def test_draft_reject_job_cancel_and_automatic_expiration(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'job-actions.db').as_posix()}", seed_demo=False)
    with TestClient(app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={
                "displayName": "Job Owner",
                "email": "job-owner@example.test",
                "password": "JobOwner2026!",
            },
        ).json()
        headers = {"Authorization": f"Bearer {signup['session']['token']}"}

        cancellable = client.post(
            "/api/v1/ingestion/jobs",
            headers=headers,
            json={"sourceType": "text", "rawText": "Cancel this before analysis."},
        ).json()
        cancelled = client.post(
            f"/api/v1/jobs/{cancellable['id']}/cancel",
            headers=headers,
            json={"expectedVersion": cancellable["version"]},
        )
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["status"] == "cancelled"
        assert client.post(
            f"/api/v1/jobs/{cancellable['id']}/analyze", headers=headers
        ).status_code == 409

        reject_job = client.post(
            "/api/v1/ingestion/jobs",
            headers=headers,
            json={"sourceType": "text", "rawText": "Analyze this and then reject it."},
        ).json()
        rejected_analysis = client.post(
            f"/api/v1/jobs/{reject_job['id']}/analyze", headers=headers
        ).json()
        rejected_draft = rejected_analysis["draft"]
        stale = client.post(
            f"/api/v1/memory-drafts/{rejected_draft['id']}/reject",
            headers=headers,
            json={"expectedVersion": rejected_draft["version"] + 1},
        )
        assert stale.status_code == 409
        rejected = client.post(
            f"/api/v1/memory-drafts/{rejected_draft['id']}/reject",
            headers=headers,
            json={"expectedVersion": rejected_draft["version"]},
        )
        assert rejected.status_code == 200, rejected.text
        assert rejected.json()["status"] == "rejected"
        assert client.get(f"/api/v1/jobs/{reject_job['id']}", headers=headers).json()["status"] == "cancelled"

        expiring_job = client.post(
            "/api/v1/ingestion/jobs",
            headers=headers,
            json={"sourceType": "text", "rawText": "This draft should expire."},
        ).json()
        expiring_analysis = client.post(
            f"/api/v1/jobs/{expiring_job['id']}/analyze", headers=headers
        ).json()
        expiring_draft = expiring_analysis["draft"]
        with app.state.database.session() as db:
            row = db.get(MemoryDraftRow, expiring_draft["id"])
            row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

        expired = client.get(f"/api/v1/memory-drafts/{expiring_draft['id']}", headers=headers)
        assert expired.status_code == 200, expired.text
        assert expired.json()["status"] == "expired"
        assert client.get(f"/api/v1/jobs/{expiring_job['id']}", headers=headers).json()["status"] == "expired"


def test_terminal_job_deletion_is_versioned_owner_scoped_and_audited(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'job-deletion.db').as_posix()}", seed_demo=False)
    with TestClient(app) as client:
        owner = client.post(
            "/api/auth/signup",
            json={
                "displayName": "Cleanup Owner",
                "email": "cleanup-owner@example.test",
                "password": "Cleanup2026!",
            },
        ).json()
        owner_headers = {"Authorization": f"Bearer {owner['session']['token']}"}
        outsider = client.post(
            "/api/auth/signup",
            json={
                "displayName": "Cleanup Outsider",
                "email": "cleanup-outsider@example.test",
                "password": "Cleanup2026!",
            },
        ).json()
        outsider_headers = {"Authorization": f"Bearer {outsider['session']['token']}"}

        job = client.post(
            "/api/v1/ingestion/jobs",
            headers=owner_headers,
            json={"sourceType": "text", "rawText": "Synthetic job content must be removable."},
        ).json()
        delete_url = f"/api/v1/jobs/{job['id']}"
        assert client.request(
            "DELETE",
            delete_url,
            headers=owner_headers,
            json={"expectedVersion": job["version"], "reason": "e2e_cleanup"},
        ).status_code == 409
        cancelled = client.post(
            f"{delete_url}/cancel",
            headers=owner_headers,
            json={"expectedVersion": job["version"]},
        ).json()
        assert client.request(
            "DELETE",
            delete_url,
            headers=outsider_headers,
            json={"expectedVersion": cancelled["version"], "reason": "e2e_cleanup"},
        ).status_code == 404
        assert client.request(
            "DELETE",
            delete_url,
            headers=owner_headers,
            json={"expectedVersion": job["version"], "reason": "e2e_cleanup"},
        ).status_code == 409

        deleted = client.request(
            "DELETE",
            delete_url,
            headers=owner_headers,
            json={"expectedVersion": cancelled["version"], "reason": "e2e_cleanup"},
        )
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["deleted"] is True
        assert deleted.json()["jobId"] == job["id"]
        assert client.get(delete_url, headers=owner_headers).status_code == 404

        confirmed_job = client.post(
            "/api/v1/ingestion/jobs",
            headers=owner_headers,
            json={"sourceType": "text", "rawText": "A confirmed memory protects its provenance."},
        ).json()
        analysis = client.post(
            f"/api/v1/jobs/{confirmed_job['id']}/analyze", headers=owner_headers
        ).json()
        draft = analysis["draft"]
        confirmed = client.post(
            f"/api/v1/memory-drafts/{draft['id']}/confirm",
            headers=owner_headers,
            json={"expectedVersion": draft["version"]},
        )
        assert confirmed.status_code == 201, confirmed.text
        confirmed_job = client.get(
            f"/api/v1/jobs/{confirmed_job['id']}", headers=owner_headers
        ).json()
        protected_delete = client.request(
            "DELETE",
            f"/api/v1/jobs/{confirmed_job['id']}",
            headers=owner_headers,
            json={"expectedVersion": confirmed_job["version"], "reason": "e2e_cleanup"},
        )
        assert protected_delete.status_code == 409
        memory_id = confirmed.json()["memory"]["id"]
        assert client.delete(f"/api/v1/memories/{memory_id}", headers=owner_headers).status_code == 200
        released_delete = client.request(
            "DELETE",
            f"/api/v1/jobs/{confirmed_job['id']}",
            headers=owner_headers,
            json={"expectedVersion": confirmed_job["version"], "reason": "e2e_cleanup"},
        )
        assert released_delete.status_code == 200, released_delete.text

    with app.state.database.session() as db:
        assert db.get(AnalysisJobRow, job["id"]) is None
        assert db.query(MemoryDraftRow).filter_by(job_id=job["id"]).count() == 0
        assert db.query(MemorySourceRow).filter_by(analysis_job_id=job["id"]).count() == 0
        audit = db.query(AnalysisJobDeletionAuditRow).filter_by(job_id=job["id"]).one()
        assert audit.owner_user_id == owner["session"]["userId"]
        assert audit.prior_status == "cancelled"
        assert audit.reason == "e2e_cleanup"
        assert len(audit.input_hash) == 64
        assert db.query(AnalysisJobDeletionAuditRow).count() == 2
