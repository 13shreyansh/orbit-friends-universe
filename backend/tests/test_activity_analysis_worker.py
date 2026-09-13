from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from app.activity_analysis_worker import drain_once
from app.application.serialization import loads
from app.db import ActivityPostRow, IntegrationOutboxRow, MemoryRow
from app.main import create_app
from app.memory_provider import LocalMemoryAnalysisProvider


class ControlledMemoryProvider(LocalMemoryAnalysisProvider):
    provider_name = "controlled-test"

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls = 0

    async def analyze(self, request, context):
        self.calls += 1
        if self.fail:
            raise ValueError("synthetic malformed AI response")
        return await super().analyze(request, context)


def test_activity_request_never_waits_and_worker_falls_back_without_user_failure(tmp_path) -> None:
    provider = ControlledMemoryProvider(fail=True)
    app = create_app(
        f"sqlite:///{(tmp_path / 'async-activity.db').as_posix()}",
        seed_demo=True,
        memory_agent=provider,
    )
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        response = client.post(
            "/api/activities",
            headers=headers,
            json={"text": "The user can continue immediately while analysis runs elsewhere."},
        )

        assert response.status_code == 201, response.text
        assert response.json()["analysis"] == {"status": "queued"}
        assert response.json()["activity"]["analysisStatus"] == "queued"
        assert provider.calls == 0
        activity_id = response.json()["activity"]["id"]

        first = asyncio.run(drain_once(
            app.state.database,
            provider,
            max_attempts=3,
            backoff_base_seconds=0,
        ))
        assert first == {"claimed": 1, "completed": 1, "failed": 0, "dead_lettered": 0}
        assert provider.calls == 1
        with app.state.database.session() as db:
            event = db.query(IntegrationOutboxRow).filter_by(
                destination="activity_analysis",
                aggregate_id=activity_id,
            ).one()
            activity = db.get(ActivityPostRow, activity_id)
            assert event.status == "completed"
            assert event.last_error == ""
            assert loads(activity.content_json, {})["analysisStatus"] == "completed"
            assert db.query(MemoryRow).filter_by(owner_user_id=login["profile"]["id"]).count() >= 1

        provider.fail = True
        media_only = client.post(
            "/api/activities",
            headers=headers,
            json={
                "media": [{
                    "type": "audio",
                    "url": "/uploads/voice-note.webm",
                    "mimeType": "audio/webm",
                    "name": "voice-note.webm",
                    "size": 2048,
                }],
            },
        )
        assert media_only.status_code == 201, media_only.text
        media_activity_id = media_only.json()["activity"]["id"]
        skipped = asyncio.run(drain_once(app.state.database, provider))
        assert skipped == {"claimed": 1, "completed": 1, "failed": 0, "dead_lettered": 0}
        assert provider.calls == 1
        with app.state.database.session() as db:
            content = loads(db.get(ActivityPostRow, media_activity_id).content_json, {})
            assert content["analysisStatus"] == "completed"
            assert content["analysisSkipped"] == "media_only_without_text"
