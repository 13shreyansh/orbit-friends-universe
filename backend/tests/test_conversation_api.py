from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agents.conversation import LocalConversationAgent
from app.db import MemorySourceRow
from app.infrastructure.conversation_agent import remote_conversation_agent_from_environment
from app.main import create_app
from app.ports.agent_memory import AgentConversationSessionContext, AgentMemoryCommit, AgentMemorySession
from app.ports.conversation_agent import AgentConversationAnswer


def test_conversation_agent_uses_local_fallback_without_credentials(monkeypatch) -> None:
    for name in ("CONVERSATION_AI_API_KEY", "AI_API_KEY", "OPENVIKING_AI_API_KEY"):
        monkeypatch.delenv(name, raising=False)

    assert isinstance(remote_conversation_agent_from_environment(), LocalConversationAgent)


class FailingRecallStore:
    provider_name = "failing-recall"

    async def recall(self, *, user_id, query, top_k=5):
        raise TimeoutError("recall unavailable")


class TimingOutConversationAgent:
    provider_name = "timeout-conversation"

    async def respond(self, prompt, context):
        raise TimeoutError("conversation provider timed out")


class MetricsConversationAgent:
    provider_name = "metrics-conversation"

    async def respond(self, prompt, context):
        return AgentConversationAnswer(
            content="Instrumented answer.",
            provider_request_id="provider-request-api-1",
            prompt_tokens=80,
            completion_tokens=20,
            total_tokens=100,
            provider_latency_ms=17,
            estimated_cost_microusd=240,
        )


class CapturingConversationAgent:
    provider_name = "capturing-conversation"

    def __init__(self) -> None:
        self.contexts = []

    async def respond(self, prompt, context):
        self.contexts.append(context)
        return AgentConversationAnswer(content=f"Context-aware answer to: {prompt}")


class RollingConversationStore:
    provider_name = "openviking-test"

    def __init__(self) -> None:
        self.commits = []
        self.appended = []
        self.context_calls = 0

    async def recall(self, *, user_id, query, top_k=5):
        return []

    async def get_or_create_session(self, *, user_id, session_key):
        assert session_key.startswith("conversation:")
        return AgentMemorySession(
            provider=self.provider_name,
            external_session_id="rolling-session-1",
            user_id=user_id,
            message_count=100,
            commit_count=2,
        )

    async def get_conversation_session_context(self, *, session, token_budget):
        self.context_calls += 1
        assert token_budget == 32_768
        return AgentConversationSessionContext(
            latest_archive_overview="Maya and the user discussed a harbour trip.",
            messages=({"role": "assistant", "content": "We discussed Maya."},),
            estimated_tokens=120,
            stats={"activeTokens": 80, "archiveTokens": 40},
        )

    async def commit_conversation_session(self, *, session, keep_recent_count):
        self.commits.append((session.external_session_id, keep_recent_count))
        return AgentMemoryCommit(task_id="rolling-commit-1", status="accepted")

    async def append_conversation_message(self, *, session, role, content):
        self.appended.append((role, content))


def _memory(memory_id: str, person_id: str) -> dict:
    return {
        "id": memory_id,
        "sourceType": "text",
        "rawText": "Maya and I planned a harbour trip.",
        "mediaUrl": "",
        "people": [{
            "id": person_id,
            "name": "Maya Chen",
            "isExisting": True,
            "relationType": "friend",
        }],
        "eventTime": "2026-07-20",
        "location": "Hong Kong",
        "eventType": "conversation",
        "summary": "Maya and I planned a harbour trip.",
        "facts": ["Planned a harbour trip with Maya"],
        "emotions": [{"name": "warmth", "intensity": 85}],
        "relationshipSignals": {
            "interactionFrequency": 80,
            "emotionalIntimacy": 85,
            "initiativeBalance": 50,
            "relationshipChange": "closer",
        },
        "keywords": ["Maya", "harbour", "trip"],
        "narrative": "A shared trip entered their orbit.",
        "confidence": 0.95,
        "analysisProvider": "conversation-test",
    }


def test_agent_conversation_uses_openviking_rolling_session_and_compacts_at_threshold(tmp_path) -> None:
    store = RollingConversationStore()
    provider = CapturingConversationAgent()
    app = create_app(
        f"sqlite:///{(tmp_path / 'rolling-conversation.db').as_posix()}",
        seed_demo=True,
        agent_memory_store=store,
        conversation_agent=provider,
    )
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        conversation = client.post(
            "/api/v1/agent/conversations",
            headers=headers,
            json={"title": "Rolling context", "mode": "memory_companion"},
        ).json()
        accepted = client.post(
            f"/api/v1/agent/conversations/{conversation['id']}/messages",
            headers=headers,
            json={"clientMessageId": "rolling-message-1", "content": "What did we discuss?"},
        )
        run_id = accepted.json()["run"]["id"]
        stream = client.get(f"/api/v1/agent/runs/{run_id}/events", headers=headers)
        completed = client.get(f"/api/v1/agent/runs/{run_id}", headers=headers).json()

    assert accepted.status_code == 202
    assert stream.status_code == 200
    assert completed["status"] == "completed"
    assert completed["retrievalDegraded"] is False
    assert store.commits == [("rolling-session-1", 60)]
    assert store.context_calls == 2
    assert [role for role, _content in store.appended] == ["user", "assistant"]
    assert provider.contexts[0].openviking_session_context["estimatedTokens"] == 120


def test_agent_conversation_is_persisted_idempotent_cited_degraded_and_proposal_gated(tmp_path) -> None:
    app = create_app(
        f"sqlite:///{(tmp_path / 'conversation.db').as_posix()}",
        seed_demo=True,
        agent_memory_store=FailingRecallStore(),
    )
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        maya = next(item for item in login["relationships"] if item["targetName"] == "Maya Chen")
        saved = client.post(
            "/api/memories",
            headers=headers,
            json={"memory": _memory("conversation-memory", maya["targetUserId"]), "relationshipId": maya["id"]},
        )
        assert saved.status_code == 201, saved.text

        created = client.post(
            "/api/v1/agent/conversations",
            headers=headers,
            json={
                "title": "Maya relationship review",
                "mode": "memory_companion",
                "relationshipId": maya["id"],
            },
        )
        assert created.status_code == 201, created.text
        conversation_id = created.json()["id"]

        outsider = client.post(
            "/api/auth/signup",
            json={"displayName": "Chat Outsider", "email": "chat-outsider@example.test", "password": "Outside2026!"},
        ).json()
        outsider_headers = {"Authorization": f"Bearer {outsider['session']['token']}"}
        assert client.get(
            f"/api/v1/agent/conversations/{conversation_id}", headers=outsider_headers
        ).status_code == 404

        message_body = {"clientMessageId": "client-message-1", "content": "What did Maya and I plan?"}
        accepted = client.post(
            f"/api/v1/agent/conversations/{conversation_id}/messages",
            headers=headers,
            json=message_body,
        )
        assert accepted.status_code == 202, accepted.text
        run_id = accepted.json()["run"]["id"]
        duplicate = client.post(
            f"/api/v1/agent/conversations/{conversation_id}/messages",
            headers=headers,
            json=message_body,
        )
        assert duplicate.status_code == 202
        assert duplicate.json()["run"]["id"] == run_id
        active_run = client.get(
            f"/api/v1/agent/conversations/{conversation_id}/active-run", headers=headers
        )
        assert active_run.status_code == 200
        assert active_run.json()["id"] == run_id
        assert client.get(f"/api/v1/agent/runs/{run_id}", headers=outsider_headers).status_code == 404
        assert client.get(
            f"/api/v1/agent/conversations/{conversation_id}/active-run",
            headers=outsider_headers,
        ).status_code == 404
        assert client.get(
            f"/api/v1/agent/runs/{run_id}/events", headers=outsider_headers
        ).status_code == 404
        blocked = client.post(
            f"/api/v1/agent/conversations/{conversation_id}/messages",
            headers=headers,
            json={"clientMessageId": "client-message-2", "content": "Another question"},
        )
        assert blocked.status_code == 409

        stream = client.get(f"/api/v1/agent/runs/{run_id}/events", headers=headers)
        assert stream.status_code == 200, stream.text
        assert stream.headers["content-type"].startswith("text/event-stream")
        assert "event: retrieval.completed" in stream.text
        assert '"degraded":true' in stream.text
        assert "event: citation.added" in stream.text
        assert "event: run.completed" in stream.text
        resumed = client.get(
            f"/api/v1/agent/runs/{run_id}/events",
            headers={**headers, "Last-Event-ID": "2"},
        )
        assert "event: run.started" not in resumed.text
        assert "event: retrieval.completed" not in resumed.text
        assert "event: run.completed" in resumed.text
        completed = client.get(f"/api/v1/agent/runs/{run_id}", headers=headers).json()
        assert completed["status"] == "completed"
        assert completed["retrievalDegraded"] is True
        assert client.get(
            f"/api/v1/agent/conversations/{conversation_id}/active-run", headers=headers
        ).json() is None

        messages = client.get(
            f"/api/v1/agent/conversations/{conversation_id}/messages", headers=headers
        ).json()["items"]
        assistant = next(item for item in messages if item["role"] == "assistant")
        assert assistant["citations"][0]["memoryId"] == "conversation-memory"
        feedback = client.post(
            f"/api/v1/agent/messages/{assistant['id']}/feedback",
            headers=headers,
            json={"rating": "helpful", "comment": "Grounded answer"},
        )
        assert feedback.status_code == 200
        assert feedback.json()["rating"] == "helpful"

        proposal = client.post(
            f"/api/v1/agent/conversations/{conversation_id}/messages",
            headers=headers,
            json={
                "clientMessageId": "client-message-proposal",
                "content": "请记住：Maya 和我下个月会再次去港口。",
            },
        )
        assert proposal.status_code == 202, proposal.text
        proposal_run_id = proposal.json()["run"]["id"]
        proposal_stream = client.get(
            f"/api/v1/agent/runs/{proposal_run_id}/events", headers=headers
        )
        assert proposal_stream.status_code == 200
        assert "event: memory.proposal" in proposal_stream.text
        proposal_messages = client.get(
            f"/api/v1/agent/conversations/{conversation_id}/messages", headers=headers
        ).json()["items"]
        proposal_assistant = proposal_messages[-1]
        draft_id = proposal_assistant["memoryProposal"]["draftId"]
        assert proposal_assistant["memoryProposal"]["status"] == "awaiting_confirmation"
        assert {
            item["id"] for item in client.get("/api/cosmos", headers=headers).json()["memories"]
        } == {"conversation-memory"}
        draft = client.get(f"/api/v1/memory-drafts/{draft_id}", headers=headers)
        assert draft.status_code == 200
        with app.state.database.session() as db:
            source = db.scalar(select(MemorySourceRow).where(MemorySourceRow.analysis_job_id == draft.json()["jobId"]))
            assert source is not None
            assert source.agent_conversation_id == conversation_id
            assert source.agent_message_id == proposal.json()["message"]["id"]

        rejected = client.post(
            f"/api/v1/memory-drafts/{draft_id}/reject",
            headers=headers,
            json={"expectedVersion": draft.json()["version"]},
        )
        assert rejected.status_code == 200

        archived = client.patch(
            f"/api/v1/agent/conversations/{conversation_id}",
            headers=headers,
            json={"status": "archived"},
        )
        assert archived.status_code == 200
        assert client.post(
            f"/api/v1/agent/conversations/{conversation_id}/messages",
            headers=headers,
            json={"clientMessageId": "after-archive", "content": "No"},
        ).status_code == 409

        removed = client.delete(
            f"/api/v1/agent/conversations/{conversation_id}", headers=headers
        )
        assert removed.status_code == 200
        assert client.get(
            f"/api/v1/agent/conversations/{conversation_id}", headers=headers
        ).status_code == 404


def test_agent_run_can_be_cancelled_before_execution(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'cancel-run.db').as_posix()}", seed_demo=True)
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        conversation = client.post(
            "/api/v1/agent/conversations",
            headers=headers,
            json={"title": "Cancelable", "mode": "memory_companion"},
        ).json()
        accepted = client.post(
            f"/api/v1/agent/conversations/{conversation['id']}/messages",
            headers=headers,
            json={"clientMessageId": "cancel-1", "content": "Cancel this"},
        ).json()
        cancelled = client.post(
            f"/api/v1/agent/runs/{accepted['run']['id']}/cancel", headers=headers
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"
        stream = client.get(
            f"/api/v1/agent/runs/{accepted['run']['id']}/events", headers=headers
        )
        assert "event: run.cancelled" in stream.text


def test_agent_provider_timeout_is_persisted_as_failed_run(tmp_path) -> None:
    app = create_app(
        f"sqlite:///{(tmp_path / 'failed-run.db').as_posix()}",
        seed_demo=True,
        conversation_agent=TimingOutConversationAgent(),
    )
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        conversation = client.post(
            "/api/v1/agent/conversations",
            headers=headers,
            json={"title": "Provider failure", "mode": "memory_companion"},
        ).json()
        accepted = client.post(
            f"/api/v1/agent/conversations/{conversation['id']}/messages",
            headers=headers,
            json={"clientMessageId": "timeout-1", "content": "Will this time out?"},
        ).json()
        run_id = accepted["run"]["id"]

        stream = client.get(f"/api/v1/agent/runs/{run_id}/events", headers=headers)
        run = client.get(f"/api/v1/agent/runs/{run_id}", headers=headers).json()

        assert "event: run.failed" in stream.text
        assert run["status"] == "failed"
        assert "timed out" in run["lastError"]
        assert run["providerLatencyMs"] is not None
        assert run["totalLatencyMs"] is not None


def test_agent_run_persists_request_correlation_and_provider_metrics(tmp_path) -> None:
    app = create_app(
        f"sqlite:///{(tmp_path / 'metrics-run.db').as_posix()}",
        seed_demo=True,
        conversation_agent=MetricsConversationAgent(),
    )
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        authorization = {"Authorization": f"Bearer {login['session']['token']}"}
        conversation = client.post(
            "/api/v1/agent/conversations",
            headers=authorization,
            json={"title": "Metrics", "mode": "memory_companion"},
        ).json()
        accepted = client.post(
            f"/api/v1/agent/conversations/{conversation['id']}/messages",
            headers={**authorization, "X-Request-ID": "create-request-api-1"},
            json={"clientMessageId": "metrics-1", "content": "Measure this"},
        )
        assert accepted.status_code == 202, accepted.text
        run_id = accepted.json()["run"]["id"]
        assert accepted.json()["run"]["creationRequestId"] == "create-request-api-1"

        stream = client.get(
            f"/api/v1/agent/runs/{run_id}/events",
            headers={**authorization, "X-Request-ID": "execute-request-api-1"},
        )
        assert stream.status_code == 200, stream.text
        assert '"promptTokens":80' in stream.text
        assert '"estimatedCostMicrousd":240' in stream.text

        run = client.get(f"/api/v1/agent/runs/{run_id}", headers=authorization).json()
        assert run["creationRequestId"] == "create-request-api-1"
        assert run["executionRequestId"] == "execute-request-api-1"
        assert run["providerRequestId"] == "provider-request-api-1"
        assert run["promptTokens"] == 80
        assert run["completionTokens"] == 20
        assert run["totalTokens"] == 100
        assert run["providerLatencyMs"] == 17
        assert run["totalLatencyMs"] is not None
        assert run["firstTokenLatencyMs"] is None
        assert run["estimatedCostMicrousd"] == 240
