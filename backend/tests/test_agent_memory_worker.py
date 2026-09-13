from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.agent_memory_worker import claim_events, drain_once, replay_dead_letter
from app.db import (
    AgentMemorySessionRow,
    AgentMemorySyncStateRow,
    Database,
    IntegrationOutboxRow,
    UserRow,
)
from app.ports.agent_memory import AgentMemoryCommit, AgentMemorySession


class FakeAgentMemoryStore:
    provider_name = "openviking"

    def __init__(self) -> None:
        self.sessions: dict[str, AgentMemorySession] = {}
        self.appended: list[tuple[str, str]] = []
        self.deleted: list[str] = []
        self.fail = False
        self.task_status = "completed"

    async def get_or_create_session(self, *, user_id: str, session_key: str) -> AgentMemorySession:
        return self.sessions.setdefault(
            session_key,
            AgentMemorySession("openviking", f"external-{len(self.sessions) + 1}", user_id),
        )

    async def append(self, *, session, role, content, dedupe_key) -> None:
        if self.fail:
            raise TimeoutError("OpenViking unavailable")
        self.appended.append((session.external_session_id, dedupe_key))

    async def commit(self, *, session) -> AgentMemoryCommit:
        return AgentMemoryCommit(f"task-{session.external_session_id}", "accepted")

    async def get_task(self, *, task_id, user_id="") -> AgentMemoryCommit:
        return AgentMemoryCommit(task_id, self.task_status)

    async def latest_task(self, *, session) -> AgentMemoryCommit | None:
        return None

    async def recall(self, *, user_id, query, top_k=5):
        return []

    async def delete(self, *, user_id, object_key) -> None:
        if self.fail:
            raise TimeoutError("OpenViking unavailable")
        self.deleted.append(object_key)

    async def health(self):
        return {"backend": "fake", "status": "ok"}


def _database(tmp_path) -> Database:
    database = Database(f"sqlite:///{(tmp_path / 'agent-memory-worker.db').as_posix()}")
    database.create_schema()
    with database.session() as db:
        db.add(
            UserRow(
                id="owner",
                email="owner@example.test",
                password_hash="unused",
                display_name="Owner",
            )
        )
    return database


def _enqueue(database: Database, *, version: int, event_type: str = "memory.upserted") -> int:
    payload = (
        {"memoryId": "memory-1", "deleted": True, "revision": version}
        if event_type == "memory.deleted"
        else {"memory": {"id": "memory-1", "summary": f"version {version}"}, "revision": version}
    )
    action = "delete" if event_type == "memory.deleted" else "upsert"
    with database.session() as db:
        row = IntegrationOutboxRow(
            owner_user_id="owner",
            destination="agent_memory",
            aggregate_type="memory",
            aggregate_id="memory-1",
            aggregate_version=version,
            event_type=event_type,
            dedupe_key=f"memory:memory-1:v{version}:{action}",
            payload_json=json.dumps(payload),
        )
        db.add(row)
        db.flush()
        return row.id


def test_worker_syncs_versions_idempotently_and_deletes_all_provider_sessions(tmp_path) -> None:
    database = _database(tmp_path)
    store = FakeAgentMemoryStore()
    first_id = _enqueue(database, version=1)

    first = asyncio.run(drain_once(database, store, task_poll_attempts=1, task_poll_seconds=0))
    assert first == {"claimed": 1, "completed": 1, "deferred": 0, "failed": 0, "dead_lettered": 0}
    assert len(store.appended) == 1
    with database.session() as db:
        assert db.get(IntegrationOutboxRow, first_id).status == "completed"
        state = db.query(AgentMemorySyncStateRow).one()
        assert (state.version, state.status, state.external_task_id) == (
            1,
            "completed",
            "task-external-1",
        )
        assert db.query(AgentMemorySessionRow).count() == 1

    assert asyncio.run(drain_once(database, store, task_poll_seconds=0))["claimed"] == 0
    _enqueue(database, version=2)
    assert asyncio.run(drain_once(database, store, task_poll_seconds=0))["completed"] == 1
    assert len(store.appended) == 2
    delete_id = _enqueue(database, version=3, event_type="memory.deleted")
    deleted = asyncio.run(drain_once(database, store, task_poll_seconds=0))
    assert deleted["completed"] == 1
    assert store.deleted == ["external-2", "external-1"]
    with database.session() as db:
        assert db.get(IntegrationOutboxRow, delete_id).status == "completed"
        state = db.query(AgentMemorySyncStateRow).one()
        assert (state.version, state.status) == (3, "deleted")
        assert {row.status for row in db.query(AgentMemorySessionRow)} == {"deleted"}


def test_worker_retries_dead_letters_and_only_replays_safe_payloads(tmp_path) -> None:
    database = _database(tmp_path)
    store = FakeAgentMemoryStore()
    store.fail = True
    event_id = _enqueue(database, version=1)

    first = asyncio.run(
        drain_once(
            database,
            store,
            max_attempts=2,
            backoff_base_seconds=0,
            backoff_max_seconds=0,
            task_poll_seconds=0,
        )
    )
    assert first["failed"] == 1 and first["dead_lettered"] == 0
    with database.session() as db:
        state = db.query(AgentMemorySyncStateRow).one()
        assert (state.status, state.attempts, state.outbox_id) == ("failed", 1, event_id)
    second = asyncio.run(
        drain_once(
            database,
            store,
            max_attempts=2,
            backoff_base_seconds=0,
            backoff_max_seconds=0,
            task_poll_seconds=0,
        )
    )
    assert second["dead_lettered"] == 1
    with database.session() as db:
        event = db.get(IntegrationOutboxRow, event_id)
        assert event.status == "dead_letter" and event.attempts == 2 and event.dead_lettered_at

    assert replay_dead_letter(database, event_id)["status"] == "pending"
    store.fail = False
    replayed = asyncio.run(drain_once(database, store, task_poll_seconds=0))
    assert replayed["completed"] == 1

    unsafe_id = _enqueue(database, version=2)
    with database.session() as db:
        unsafe = db.get(IntegrationOutboxRow, unsafe_id)
        unsafe.status = "dead_letter"
        unsafe.payload_json = json.dumps({"memoryId": "memory-1", "redacted": True})
    with pytest.raises(ValueError, match="Redacted"):
        replay_dead_letter(database, unsafe_id)


def test_worker_reclaims_only_expired_processing_leases(tmp_path) -> None:
    database = _database(tmp_path)
    event_id = _enqueue(database, version=1)
    now = datetime.now(timezone.utc)
    with database.session() as db:
        event = db.get(IntegrationOutboxRow, event_id)
        event.status = "processing"
        event.claim_token = "abandoned"
        event.claimed_at = now - timedelta(minutes=5)
        event.lease_expires_at = now - timedelta(seconds=1)

    claimed = claim_events(database, now=now)
    assert [event.id for event in claimed] == [event_id]
    assert claimed[0].claim_token != "abandoned"


def test_worker_replay_replaces_a_session_with_a_failed_provider_task(tmp_path) -> None:
    database = _database(tmp_path)
    store = FakeAgentMemoryStore()
    store.task_status = "failed"
    event_id = _enqueue(database, version=1)

    first = asyncio.run(
        drain_once(
            database,
            store,
            max_attempts=2,
            backoff_base_seconds=0,
            backoff_max_seconds=0,
            task_poll_attempts=1,
            task_poll_seconds=0,
        )
    )
    second = asyncio.run(
        drain_once(
            database,
            store,
            max_attempts=2,
            backoff_base_seconds=0,
            backoff_max_seconds=0,
            task_poll_attempts=1,
            task_poll_seconds=0,
        )
    )
    assert first["failed"] == 1
    assert second["dead_lettered"] == 1

    assert replay_dead_letter(database, event_id)["status"] == "pending"
    store.task_status = "completed"
    replayed = asyncio.run(drain_once(database, store, task_poll_attempts=1, task_poll_seconds=0))
    assert replayed["completed"] == 1
    assert set(store.sessions) == {
        "memory:memory-1:v1:upsert",
        "memory:memory-1:v1:upsert:replay:1",
    }
    with database.session() as db:
        assert {row.status for row in db.query(AgentMemorySessionRow)} == {"active", "failed"}
