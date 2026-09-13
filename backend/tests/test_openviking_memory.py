from __future__ import annotations

import asyncio
import hashlib
import json

import httpx

from app.infrastructure.openviking_memory import (
    LOCAL_ROOT_KEY_DOMAIN,
    OpenVikingMemoryStore,
    openviking_memory_from_environment,
)
from app.ports.agent_memory import AgentMemoryStore


def test_openviking_adapter_uses_real_v1_contract_and_user_scope() -> None:
    sessions: dict[str, dict] = {}
    message_bodies: list[dict] = []
    deleted: list[str] = []
    identity_headers: list[tuple[str, str]] = []
    search_bodies: list[dict] = []
    commit_bodies: list[dict] = []

    def response(result, *, status_code: int = 200):
        return httpx.Response(status_code, json={"status": "ok", "result": result, "time": 0.01})

    def handler(request: httpx.Request) -> httpx.Response:
        identity_headers.append(
            (
                request.headers.get("X-OpenViking-Account", ""),
                request.headers.get("X-OpenViking-User", ""),
            )
        )
        path = request.url.path
        if path == "/health":
            return httpx.Response(200, json={"status": "ok", "healthy": True, "version": "test"})
        if path == "/api/v1/sessions" and request.method == "POST":
            body = json.loads(request.content)
            session_id = body["session_id"]
            sessions[session_id] = {
                "session_id": session_id,
                "message_count": 0,
                "commit_count": 0,
                "messages": [],
            }
            return response(sessions[session_id])
        if path.startswith("/api/v1/sessions/"):
            suffix = path.removeprefix("/api/v1/sessions/")
            session_id = suffix.split("/")[0]
            if session_id not in sessions:
                return httpx.Response(
                    404,
                    json={"status": "error", "error": {"code": "NOT_FOUND", "message": "missing"}},
                )
            if suffix.endswith("/context") and request.method == "GET":
                return response({
                    "latest_archive_overview": "Earlier conversation overview",
                    "messages": sessions[session_id]["messages"],
                    "estimatedTokens": 42,
                    "stats": {"activeTokens": 30, "archiveTokens": 12},
                })
            if request.method == "GET":
                return response(sessions[session_id])
            if suffix.endswith("/messages"):
                message = json.loads(request.content)
                message_bodies.append(message)
                sessions[session_id]["messages"].append(message)
                sessions[session_id]["message_count"] += 1
                return response({"session_id": session_id, "message_count": 1})
            if suffix.endswith("/commit"):
                commit_body = json.loads(request.content)
                commit_bodies.append(commit_body)
                keep_recent_count = int(commit_body.get("keep_recent_count", 0))
                sessions[session_id]["messages"] = (
                    sessions[session_id]["messages"][-keep_recent_count:]
                    if keep_recent_count
                    else []
                )
                sessions[session_id]["message_count"] = len(sessions[session_id]["messages"])
                sessions[session_id]["commit_count"] += 1
                return response({"session_id": session_id, "status": "accepted", "task_id": "task-1"})
            if request.method == "DELETE":
                deleted.append(session_id)
                sessions.pop(session_id)
                return response({"session_id": session_id})
        if path == "/api/v1/tasks/task-1":
            return response({"task_id": "task-1", "status": "completed"})
        if path == "/api/v1/tasks":
            return response([{"task_id": "task-1", "status": "completed"}])
        if path == "/api/v1/search/find":
            search_bodies.append(json.loads(request.content))
            return response(
                {
                    "memories": [
                        {"uri": "viking://user/owner/memories/events/harbour", "score": 0.91, "abstract": "walk"}
                    ],
                    "resources": [],
                    "skills": [],
                    "total": 1,
                }
            )
        raise AssertionError(f"unexpected request: {request.method} {path}")

    async def exercise() -> None:
        async with httpx.AsyncClient(
            base_url="http://openviking.test",
            transport=httpx.MockTransport(handler),
        ) as client:
            store = OpenVikingMemoryStore(
                "http://openviking.test",
                api_key="test-key",
                account="social-cosmos-test",
                client=client,
            )
            assert isinstance(store, AgentMemoryStore)
            session = await store.get_or_create_session(user_id="owner", session_key="memory:1:v1")
            assert session.external_session_id.startswith("sc-")
            await store.append(
                session=session,
                role="user",
                content={"memory": {"id": "memory-1", "summary": "walk"}},
                dedupe_key="memory:1:v1:upsert",
            )
            commit = await store.commit(session=session)
            assert commit.task_id == "task-1" and commit.status == "accepted"
            assert (await store.get_task(task_id=commit.task_id, user_id="owner")).status == "completed"

            loaded = await store.get_or_create_session(user_id="owner", session_key="memory:1:v1")
            assert loaded.commit_count == 1
            assert (await store.latest_task(session=loaded)).task_id == "task-1"
            await store.append(
                session=loaded,
                role="user",
                content={"memory": {"id": "memory-1"}},
                dedupe_key="memory:1:v1:upsert",
            )
            assert len(message_bodies) == 1

            recalls = await store.recall(user_id="owner", query="harbour", top_k=3)
            assert recalls[0].score == 0.91
            assert recalls[0].object_key.endswith("/harbour")

            rolling = await store.get_or_create_session(
                user_id="owner",
                session_key="conversation:conversation-1",
            )
            await store.append_conversation_message(
                session=rolling,
                role="user",
                content="Do you remember Maya?",
            )
            await store.append_conversation_message(
                session=rolling,
                role="assistant",
                content="Yes, from the harbour plan.",
            )
            context = await store.get_conversation_session_context(
                session=rolling,
                token_budget=32_768,
            )
            assert context.latest_archive_overview == "Earlier conversation overview"
            assert context.estimated_tokens == 42
            assert len(context.messages) == 2
            await store.commit_conversation_session(session=rolling, keep_recent_count=1)
            assert (await store.health())["status"] == "ok"
            await store.delete(user_id="owner", object_key=session.external_session_id)
            assert deleted == [session.external_session_id]

    asyncio.run(exercise())
    assert all(account == "social-cosmos-test" for account, _user in identity_headers)
    assert {user for _account, user in identity_headers if user} == {"owner"}
    assert json.loads(message_bodies[0]["content"])["dedupeKey"] == "memory:1:v1:upsert"
    assert search_bodies == [{
        "query": "harbour",
        "target_uri": "viking://user/owner/memories",
        "limit": 3,
        "context_type": ["memory"],
        "level": "0,1",
    }]
    assert commit_bodies[-1] == {"keep_recent_count": 1, "telemetry": False}


def test_local_environment_derives_a_domain_separated_root_key(monkeypatch) -> None:
    monkeypatch.setenv("OPENVIKING_URL", "http://openviking:1933")
    monkeypatch.setenv("OPENVIKING_AI_API_KEY", "model-secret")
    monkeypatch.delenv("OPENVIKING_API_KEY", raising=False)

    store = openviking_memory_from_environment()
    expected = hashlib.sha256(LOCAL_ROOT_KEY_DOMAIN + b"model-secret").hexdigest()
    assert isinstance(store, OpenVikingMemoryStore)
    assert store.api_key == f"ov-local-{expected}"


def test_delete_reverses_memory_diff_before_removing_session() -> None:
    actions: list[tuple[str, str, object]] = []
    user_id = "owner"
    prefix = f"viking://user/{user_id}/memories"
    diff = {
        "operations": {
            "adds": [{"uri": f"{prefix}/events/new.md", "after": "new"}],
            "updates": [{"uri": f"{prefix}/profile.md", "before": "old", "after": "new"}],
            "deletes": [{"uri": f"{prefix}/events/old.md", "deleted_content": "restored"}],
        }
    }

    def ok(result):
        return httpx.Response(200, json={"status": "ok", "result": result})

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/v1/tasks":
            return ok([{"task_id": "task-delete", "status": "completed"}])
        if path == "/api/v1/tasks/task-delete":
            return ok({"task_id": "task-delete", "status": "completed", "result": {"memory_diff_uri": "viking://diff"}})
        if path == "/api/v1/content/read":
            uri = request.url.params["uri"]
            if uri == "viking://diff":
                return ok(json.dumps(diff))
            if uri.endswith("/events/old.md"):
                return httpx.Response(404)
            return ok("current")
        if path == "/api/v1/content/write":
            body = json.loads(request.content)
            actions.append((request.method, path, body))
            return ok({"uri": body["uri"]})
        if path == "/api/v1/fs":
            actions.append((request.method, path, request.url.params["uri"]))
            return ok({"deleted": True})
        if path == "/api/v1/system/wait":
            actions.append((request.method, path, "wait"))
            return ok({"status": "complete"})
        if path == "/api/v1/sessions/session-delete":
            actions.append((request.method, path, "session"))
            return ok({"session_id": "session-delete"})
        raise AssertionError(f"unexpected request: {request.method} {path}")

    async def exercise() -> None:
        async with httpx.AsyncClient(
            base_url="http://openviking.test",
            transport=httpx.MockTransport(handler),
        ) as client:
            store = OpenVikingMemoryStore("http://openviking.test", client=client)
            await store.delete(user_id=user_id, object_key="session-delete")

    asyncio.run(exercise())
    assert actions == [
        ("POST", "/api/v1/content/write", {"uri": f"{prefix}/events/old.md", "content": "restored", "mode": "create", "wait": False}),
        ("POST", "/api/v1/content/write", {"uri": f"{prefix}/profile.md", "content": "old", "mode": "replace", "wait": False}),
        ("DELETE", "/api/v1/fs", f"{prefix}/events/new.md"),
        ("POST", "/api/v1/system/wait", "wait"),
        ("DELETE", "/api/v1/sessions/session-delete", "session"),
    ]


def test_delete_recovers_missing_updated_file_and_ignores_missing_added_file() -> None:
    writes: list[str] = []
    user_id = "owner"
    prefix = f"viking://user/{user_id}/memories"
    diff = {
        "operations": {
            "adds": [{"uri": f"{prefix}/events/already-gone.md", "after": "new"}],
            "updates": [{"uri": f"{prefix}/profile.md", "before": "old", "after": "new"}],
            "deletes": [],
        }
    }

    def ok(result):
        return httpx.Response(200, json={"status": "ok", "result": result})

    def missing(uri: str):
        return httpx.Response(200, json={
            "status": "error",
            "result": None,
            "error": {"code": "NOT_FOUND", "message": f"File not found: {uri}"},
        })

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/v1/tasks":
            return ok([{"task_id": "task-delete", "status": "completed"}])
        if path == "/api/v1/tasks/task-delete":
            return ok({"task_id": "task-delete", "status": "completed", "result": {"memory_diff_uri": "viking://diff"}})
        if path == "/api/v1/content/read":
            uri = request.url.params["uri"]
            return ok(json.dumps(diff)) if uri == "viking://diff" else missing(uri)
        if path == "/api/v1/content/write":
            body = json.loads(request.content)
            writes.append(body["mode"])
            return ok({"uri": body["uri"]})
        if path == "/api/v1/fs":
            return missing(request.url.params["uri"])
        if path == "/api/v1/system/wait":
            return ok({"status": "complete"})
        if path == "/api/v1/sessions/session-delete":
            return missing("session-delete")
        raise AssertionError(f"unexpected request: {request.method} {path}")

    async def exercise() -> None:
        async with httpx.AsyncClient(
            base_url="http://openviking.test",
            transport=httpx.MockTransport(handler),
        ) as client:
            store = OpenVikingMemoryStore("http://openviking.test", client=client)
            await store.delete(user_id=user_id, object_key="session-delete")

    asyncio.run(exercise())
    assert writes == ["create"]
