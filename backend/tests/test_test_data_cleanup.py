from __future__ import annotations

from fastapi.testclient import TestClient

from app.db import (
    AnalysisJobDeletionAuditRow,
    GraphProjectionOutboxRow,
    PlanetRow,
    SyntheticAccountDeletionAuditRow,
    UserRow,
)
from app.infrastructure.graph_projection import LocalGraphProjection
from app.main import create_app


class RecordingGraphProjection(LocalGraphProjection):
    def __init__(self) -> None:
        self.deleted_owners: list[str] = []

    def delete_owner(self, owner_user_id: str) -> None:
        self.deleted_owners.append(owner_user_id)


def test_synthetic_account_cleanup_tombstones_sql_and_projects_graph_delete(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("SOCIAL_COSMOS_TEST_CLEANUP_ENABLED", "true")
    graph = RecordingGraphProjection()
    app = create_app(
        f"sqlite:///{(tmp_path / 'test-data-cleanup.db').as_posix()}",
        seed_demo=False,
        graph_repository=graph,
    )
    with TestClient(app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={
                "displayName": "Synthetic Cleanup",
                "email": "synthetic-cleanup@example.test",
                "password": "Cleanup2026!",
            },
        ).json()
        account_id = signup["session"]["userId"]
        headers = {"Authorization": f"Bearer {signup['session']['token']}"}
        job = client.post(
            "/api/v1/ingestion/jobs",
            headers=headers,
            json={"sourceType": "text", "rawText": "Synthetic cleanup job."},
        ).json()
        cancelled = client.post(
            f"/api/v1/jobs/{job['id']}/cancel",
            headers=headers,
            json={"expectedVersion": job["version"]},
        )
        assert cancelled.status_code == 200, cancelled.text
        conversation = client.post(
            "/api/v1/agent/conversations",
            headers=headers,
            json={"title": "Synthetic cleanup conversation", "mode": "memory_companion"},
        )
        assert conversation.status_code == 201, conversation.text

        wrong_confirmation = client.request(
            "DELETE",
            "/api/v1/test-data/account",
            headers=headers,
            json={"confirmation": "wrong@example.test"},
        )
        assert wrong_confirmation.status_code == 400
        deleted = client.request(
            "DELETE",
            "/api/v1/test-data/account",
            headers=headers,
            json={
                "confirmation": "synthetic-cleanup@example.test",
                "reason": "automated_test_cleanup",
            },
        )
        assert deleted.status_code == 200, deleted.text
        payload = deleted.json()
        assert payload["deleted"] is True
        assert payload["accountId"] == account_id
        assert payload["deletedJobCount"] == 1
        assert payload["deletedConversationCount"] == 1
        assert payload["graphProjection"]["completed"] == 1
        assert graph.deleted_owners == [account_id]
        assert client.get("/api/cosmos", headers=headers).status_code == 401
        assert client.post(
            "/api/auth/signin",
            json={"email": "synthetic-cleanup@example.test", "password": "Cleanup2026!"},
        ).status_code == 401

    with app.state.database.session() as db:
        user = db.get(UserRow, account_id)
        assert user is not None and user.deleted_at is not None
        assert user.email == f"deleted+{account_id}@example.invalid"
        assert db.query(PlanetRow).filter_by(owner_user_id=account_id).count() == 0
        assert db.query(AnalysisJobDeletionAuditRow).filter_by(owner_user_id=account_id).count() == 1
        audit = db.query(SyntheticAccountDeletionAuditRow).filter_by(owner_user_id=account_id).one()
        assert audit.reason == "automated_test_cleanup"
        projection = db.query(GraphProjectionOutboxRow).filter_by(owner_user_id=account_id).one()
        assert projection.operation == "delete"
        assert projection.status == "completed"


def test_synthetic_account_cleanup_is_hidden_by_default_and_rejects_memory_data(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("SOCIAL_COSMOS_TEST_CLEANUP_ENABLED", raising=False)
    app = create_app(f"sqlite:///{(tmp_path / 'test-data-gate.db').as_posix()}", seed_demo=False)
    with TestClient(app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={
                "displayName": "Synthetic Gate",
                "email": "synthetic-gate@example.test",
                "password": "Cleanup2026!",
            },
        ).json()
        headers = {"Authorization": f"Bearer {signup['session']['token']}"}
        body = {"confirmation": "synthetic-gate@example.test"}
        assert client.request(
            "DELETE", "/api/v1/test-data/account", headers=headers, json=body
        ).status_code == 404

        monkeypatch.setenv("SOCIAL_COSMOS_TEST_CLEANUP_ENABLED", "true")
        candidate = client.post(
            "/api/memories/analyze",
            headers=headers,
            json={"sourceType": "text", "rawText": "Keep this confirmed memory."},
        ).json()
        assert client.post(
            "/api/memories", headers=headers, json={"memory": candidate, "relationshipId": None}
        ).status_code == 201
        blocked = client.request(
            "DELETE", "/api/v1/test-data/account", headers=headers, json=body
        )
        assert blocked.status_code == 409
        assert "confirmed memories" in blocked.json()["detail"]
