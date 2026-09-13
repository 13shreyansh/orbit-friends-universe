from __future__ import annotations

import httpx
import pytest

from app.main import create_app


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def _memory(memory_id: str, summary: str, event_time: str, person_id: str, person_name: str) -> dict:
    return {
        "id": memory_id,
        "sourceType": "text",
        "rawText": summary,
        "mediaUrl": "",
        "people": [{
            "id": person_id,
            "name": person_name,
            "isExisting": True,
            "relationType": "friend",
        }],
        "eventTime": event_time,
        "location": "Hong Kong",
        "eventType": "conversation",
        "summary": summary,
        "facts": [summary],
        "emotions": [{"name": "warmth", "intensity": 80}],
        "relationshipSignals": {
            "interactionFrequency": 75,
            "emotionalIntimacy": 80,
            "initiativeBalance": 50,
            "relationshipChange": "closer",
        },
        "keywords": ["friend"],
        "narrative": summary,
        "confidence": 0.95,
        "analysisProvider": "query-test",
    }


@pytest.mark.anyio
async def test_memory_and_ingestion_job_lists_are_filtered_paginated_and_owner_scoped(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'queries.db').as_posix()}", seed_demo=True)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        login = (await client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        )).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        maya = next(item for item in login["relationships"] if item["targetName"] == "Maya Chen")
        for memory in (
            _memory("query-memory-1", "Maya harbour planning", "2026-07-20", maya["targetUserId"], "Maya Chen"),
            _memory("query-memory-2", "Maya mountain walk", "2026-07-21", maya["targetUserId"], "Maya Chen"),
        ):
            saved = await client.post(
                "/api/memories",
                headers=headers,
                json={"memory": memory, "relationshipId": maya["id"]},
            )
            assert saved.status_code == 201, saved.text

        first = await client.get("/api/v1/memories?limit=1", headers=headers)
        assert first.status_code == 200, first.text
        assert [item["id"] for item in first.json()["items"]] == ["query-memory-2"]
        assert first.json()["nextCursor"]
        second = await client.get(
            "/api/v1/memories",
            headers=headers,
            params={"limit": 1, "cursor": first.json()["nextCursor"]},
        )
        assert [item["id"] for item in second.json()["items"]] == ["query-memory-1"]
        filtered = await client.get(
            "/api/v1/memories",
            headers=headers,
            params={
                "relationshipId": maya["id"],
                "from": "2026-07-21",
                "to": "2026-07-21",
                "query": "mountain",
            },
        )
        assert [item["id"] for item in filtered.json()["items"]] == ["query-memory-2"]
        assert filtered.json()["items"][0]["currentVersion"] == 1

        jobs = []
        for raw_text in ("First pending job", "Second pending job"):
            response = await client.post(
                "/api/v1/ingestion/jobs",
                headers=headers,
                json={"sourceType": "text", "rawText": raw_text},
            )
            assert response.status_code == 201
            jobs.append(response.json()["id"])
        job_page = await client.get(
            "/api/v1/ingestion/jobs",
            headers=headers,
            params={"status": "created", "limit": 1},
        )
        assert len(job_page.json()["items"]) == 1
        assert job_page.json()["nextCursor"]
        assert job_page.json()["items"][0]["id"] in jobs

        outsider = (await client.post(
            "/api/auth/signup",
            json={"displayName": "Query Outsider", "email": "query-outsider@example.test", "password": "Outside2026!"},
        )).json()
        outsider_headers = {"Authorization": f"Bearer {outsider['session']['token']}"}
        assert (await client.get("/api/v1/memories", headers=outsider_headers)).json()["items"] == []
        assert (await client.get("/api/v1/ingestion/jobs", headers=outsider_headers)).json()["items"] == []

        assert (await client.get("/api/v1/memories?cursor=bad", headers=headers)).status_code == 400
        assert (await client.get("/api/v1/ingestion/jobs?status=unknown", headers=headers)).status_code == 400
