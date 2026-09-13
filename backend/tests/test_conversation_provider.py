from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.infrastructure.conversation_agent import (
    OpenAICompatibleConversationAgent,
    remote_conversation_agent_from_environment,
)
from app.ports.analysis_provider import MemoryAnalysisRecall
from app.ports.conversation_agent import AgentConversationContext
from app.schemas.memory import MemoryObject


def _memory(memory_id: str, summary: str) -> MemoryObject:
    return MemoryObject.model_validate({
        "id": memory_id,
        "sourceType": "text",
        "rawText": summary,
        "mediaUrl": "",
        "people": [{
            "id": "person-maya",
            "name": "Maya Chen",
            "isExisting": True,
            "relationType": "friend",
        }],
        "eventTime": "2026-07-20",
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
        "keywords": ["Maya"],
        "narrative": summary,
        "confidence": 0.95,
    })


def test_openai_compatible_conversation_agent_sends_scoped_context_and_parses_json() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["authorization"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            headers={"x-request-id": "provider-request-42"},
            json={
                "id": "completion-fallback-id",
                "choices": [{"message": {"content": json.dumps({
                    "content": "你们计划了港口旅行。",
                    "citedMemoryIds": ["memory-owned", "memory-owned"],
                    "proposeMemory": False,
                }, ensure_ascii=False)}}],
                "usage": {
                    "prompt_tokens": 120,
                    "completion_tokens": 30,
                    "total_tokens": 150,
                },
            },
        )

    agent = OpenAICompatibleConversationAgent(
        api_key="secret-test-key",
        base_url="https://provider.example/v1/",
        model="conversation-test",
        input_cost_per_million="2.5",
        output_cost_per_million="10",
        transport=httpx.MockTransport(handler),
    )
    answer = asyncio.run(agent.respond(
        "What did Maya and I plan?",
        AgentConversationContext(
            owner_user_id="owner-alpha",
            relationship_id="relationship-maya",
            confirmed_memories=[_memory("memory-owned", "Planned a harbour trip")],
            agent_memory_recalls=[MemoryAnalysisRecall(
                object_key="owner-alpha:profile",
                score=0.8,
                content={"preference": "quiet trips"},
            )],
            openviking_session_context={
                "latestArchiveOverview": "Earlier plans were summarized.",
                "messages": [{"role": "user", "content": "What about Maya?"}],
                "estimatedTokens": 24,
                "stats": {"activeTokens": 12, "archiveTokens": 12},
            },
        ),
    ))

    assert answer.content == "你们计划了港口旅行。"
    assert answer.cited_memory_ids == ("memory-owned",)
    assert answer.propose_memory is False
    assert answer.provider_request_id == "provider-request-42"
    assert answer.prompt_tokens == 120
    assert answer.completion_tokens == 30
    assert answer.total_tokens == 150
    assert answer.provider_latency_ms is not None
    assert answer.first_token_latency_ms is None
    assert answer.estimated_cost_microusd == 600
    assert captured["authorization"] == "Bearer secret-test-key"
    provider_payload = json.loads(captured["body"]["messages"][1]["content"])
    assert provider_payload["ownerScope"] == "owner-alpha"
    assert [item["id"] for item in provider_payload["confirmedMemories"]] == ["memory-owned"]
    assert provider_payload["openVikingRecall"][0]["objectKey"] == "owner-alpha:profile"
    assert provider_payload["openVikingSessionContext"]["estimatedTokens"] == 24


@pytest.mark.parametrize("content", ["not-json", "[]", '{"content":"","citedMemoryIds":[]}'])
def test_openai_compatible_conversation_agent_rejects_invalid_payload(content: str) -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(
        200,
        json={"choices": [{"message": {"content": content}}]},
    ))
    agent = OpenAICompatibleConversationAgent(
        api_key="test-key",
        base_url="https://provider.example/v1",
        model="conversation-test",
        transport=transport,
    )
    with pytest.raises(ValueError):
        asyncio.run(agent.respond("hello", AgentConversationContext("owner", None, [])))


def test_openai_compatible_conversation_agent_propagates_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("provider timeout", request=request)

    agent = OpenAICompatibleConversationAgent(
        api_key="test-key",
        base_url="https://provider.example/v1",
        model="conversation-test",
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(httpx.ReadTimeout):
        asyncio.run(agent.respond("hello", AgentConversationContext("owner", None, [])))


def test_remote_conversation_agent_uses_openviking_model_environment_fallback(monkeypatch) -> None:
    for name in ("CONVERSATION_AI_API_KEY", "CONVERSATION_AI_BASE_URL", "CONVERSATION_AI_MODEL", "AI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AI_BASE_URL", "https://default-openai.example/v1")
    monkeypatch.setenv("AI_MODEL", "default-openai-model")
    monkeypatch.setenv("OPENVIKING_AI_API_KEY", "shared-key")
    monkeypatch.setenv("OPENVIKING_AI_BASE_URL", "https://shared.example/v1")
    monkeypatch.setenv("OPENVIKING_AI_MODEL", "shared-model")

    agent = remote_conversation_agent_from_environment()

    assert isinstance(agent, OpenAICompatibleConversationAgent)
    assert agent.base_url == "https://shared.example/v1"
    assert agent.model == "shared-model"
    assert agent.api_key == "shared-key"


def test_openai_compatible_conversation_agent_rejects_negative_cost() -> None:
    with pytest.raises(ValueError, match="cannot be negative"):
        OpenAICompatibleConversationAgent(
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="conversation-test",
            input_cost_per_million="-1",
        )
