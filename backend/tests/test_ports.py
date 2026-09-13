from __future__ import annotations

import asyncio

import pytest

from app.infrastructure.local_object_storage import LocalObjectStorage
from app.ports.agent_memory import (
    AgentMemoryCommit,
    AgentMemoryRecall,
    AgentMemorySession,
    AgentMemoryStore,
)


def test_agent_memory_port_supports_a_user_scoped_fake_contract() -> None:
    class FakeAgentMemory:
        def __init__(self) -> None:
            self.objects = {}

        async def get_or_create_session(self, *, user_id, session_key):
            return AgentMemorySession("fake", f"{user_id}:{session_key}")

        async def append(self, *, session, role, content, dedupe_key):
            self.objects[(session.external_session_id, dedupe_key)] = (role, content)

        async def commit(self, *, session):
            return AgentMemoryCommit(f"task:{session.external_session_id}", "queued")

        async def get_task(self, *, task_id, user_id=""):
            return AgentMemoryCommit(task_id, "completed")

        async def latest_task(self, *, session):
            return AgentMemoryCommit(f"task:{session.external_session_id}", "completed")

        async def recall(self, *, user_id, query, top_k=5):
            return [AgentMemoryRecall(f"{user_id}:memory", 1.0, {"query": query})][:top_k]

        async def delete(self, *, user_id, object_key):
            self.objects[(user_id, object_key)] = None

        async def health(self):
            return {"backend": "fake", "status": "ok"}

    fake = FakeAgentMemory()
    assert isinstance(fake, AgentMemoryStore)

    async def exercise() -> None:
        alpha = await fake.get_or_create_session(user_id="alpha", session_key="analysis-1")
        beta = await fake.get_or_create_session(user_id="beta", session_key="analysis-1")
        assert alpha.external_session_id != beta.external_session_id
        await fake.append(
            session=alpha,
            role="user",
            content={"memoryId": "memory-1"},
            dedupe_key="memory-1:v1",
        )
        task = await fake.commit(session=alpha)
        assert (await fake.get_task(task_id=task.task_id)).status == "completed"
        assert (await fake.recall(user_id="alpha", query="trip"))[0].object_key.startswith("alpha:")
        assert (await fake.health())["status"] == "ok"

    asyncio.run(exercise())


def test_local_object_storage_contract_is_private_rooted_and_deletable(tmp_path) -> None:
    storage = LocalObjectStorage(tmp_path / "objects")
    stored = storage.put(key="owner/job/input.txt", content=b"memory", content_type="text/plain")

    assert stored.size_bytes == 6
    assert len(stored.content_hash) == 64
    assert storage.signed_url(key=stored.key) == "/uploads/ingestion/owner/job/input.txt"
    assert (tmp_path / "objects" / stored.key).read_bytes() == b"memory"

    with pytest.raises(ValueError, match="escapes"):
        storage.put(key="../outside.txt", content=b"no", content_type="text/plain")

    storage.delete(key=stored.key)
    assert not (tmp_path / "objects" / stored.key).exists()
