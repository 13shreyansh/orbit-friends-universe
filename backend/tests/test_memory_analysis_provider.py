from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.agents.memory import LocalMemoryAgent
from app.infrastructure.memory_analysis import (
    OpenAICompatibleMemoryAnalysisProvider,
    memory_analysis_provider_from_environment,
)
from app.ports.analysis_provider import MemoryAnalysisContext, MemoryAnalysisRecall
from app.schemas.memory import AnalyzeMemoryRequest


def _agent_memory() -> dict:
    return {
        "id": "memory-agent-1",
        "sourceType": "chat_screenshot",
        "rawText": "untrusted replacement",
        "mediaUrl": "",
        "people": [
            {
                "id": "person-maya",
                "name": "Maya Chen",
                "isExisting": True,
                "relationType": "friend",
            }
        ],
        "eventTime": "2026-07-24",
        "location": "Shanghai",
        "eventType": "conversation",
        "summary": "Maya and the owner discussed a shared project.",
        "facts": ["They discussed a shared project."],
        "emotions": [{"name": "curious", "intensity": 70}],
        "relationshipSignals": {
            "interactionFrequency": 60,
            "emotionalIntimacy": 55,
            "initiativeBalance": 50,
            "relationshipChange": "closer",
        },
        "keywords": ["project"],
        "narrative": "",
        "confidence": 0.88,
        "analysisProvider": "untrusted-provider-name",
    }


def test_memory_analysis_provider_uses_teammate_contract_and_preserves_evidence() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps(_agent_memory())}}
                ]
            },
        )

    provider = OpenAICompatibleMemoryAnalysisProvider(
        api_key="agent-key",
        base_url="https://agent.example/v1",
        model="memory-model",
        transport=httpx.MockTransport(handler),
    )
    request = AnalyzeMemoryRequest(
        source_type="text",
        raw_text="Maya Chen and I discussed a shared project.",
        image_url="/uploads/evidence.png",
    )
    context = MemoryAnalysisContext(
        owner_user_id="owner-1",
        known_people=[{"id": "person-maya", "name": "Maya Chen"}],
        related_memories=[],
        agent_memory_recalls=[
            MemoryAnalysisRecall(
                object_key="viking://user/owner-1/memories/one",
                score=0.91,
                content={"abstract": "older project memory"},
            )
        ],
    )

    result = asyncio.run(provider.analyze(request, context))

    assert result.source_type == "text"
    assert result.raw_text == request.raw_text
    assert result.media_url == request.image_url
    assert result.analysis_provider == "openviking-agent:memory-model"
    assert requests[0].url == httpx.URL("https://agent.example/v1/chat/completions")
    assert requests[0].headers["authorization"] == "Bearer agent-key"
    body = json.loads(requests[0].content)
    agent_input = json.loads(body["messages"][1]["content"])
    assert agent_input["ownerScope"] == "owner-1"
    assert agent_input["knownPeople"][0]["id"] == "person-maya"
    assert agent_input["openVikingRecall"][0]["score"] == 0.91


def test_memory_analysis_environment_uses_safe_fallback_without_credentials(monkeypatch) -> None:
    monkeypatch.setenv("SOCIAL_COSMOS_MEMORY_ANALYSIS_PROVIDER", "openviking")
    monkeypatch.delenv("OPENVIKING_AI_API_KEY", raising=False)
    assert isinstance(memory_analysis_provider_from_environment(), LocalMemoryAgent)

    monkeypatch.setenv("SOCIAL_COSMOS_MEMORY_ANALYSIS_PROVIDER", "legacy_local")
    monkeypatch.delenv("SOCIAL_COSMOS_ENABLE_LEGACY_MEMORY_ANALYSIS", raising=False)
    with pytest.raises(RuntimeError, match="hidden"):
        memory_analysis_provider_from_environment()

    monkeypatch.setenv("SOCIAL_COSMOS_ENABLE_LEGACY_MEMORY_ANALYSIS", "true")
    assert isinstance(memory_analysis_provider_from_environment(), LocalMemoryAgent)
