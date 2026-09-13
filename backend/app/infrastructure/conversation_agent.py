from __future__ import annotations

import json
import os
import time
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

import httpx

from app.agents.conversation import LocalConversationAgent
from app.ports.conversation_agent import (
    AgentConversationAnswer,
    AgentConversationContext,
    AgentConversationProvider,
)


SYSTEM_PROMPT = """You are the Social Cosmos memory companion.
Answer the user's question using the bounded recent confirmed memories as the primary facts.
OpenViking L0/L1 recall provides compressed older context and must never override confirmed memories.
OpenViking session context provides multi-turn continuity within the current conversation.
Return only a JSON object with exactly these fields:
- content: a concise answer for the user
- citedMemoryIds: IDs selected only from confirmedMemories
- proposeMemory: true only when the user explicitly asks to remember or record a new fact
Never claim that a proposed memory has already been confirmed."""


class OpenAICompatibleConversationAgent:
    """OpenAI-compatible chat-completions adapter behind the conversation port."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        timeout_seconds: float = 30,
        max_tokens: int = 1200,
        input_cost_per_million: Decimal | str | float = Decimal("0"),
        output_cost_per_million: Decimal | str | float = Decimal("0"),
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("Conversation Agent API key is required.")
        if timeout_seconds <= 0:
            raise ValueError("Conversation Agent timeout must be positive.")
        if max_tokens < 1:
            raise ValueError("Conversation Agent max tokens must be positive.")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_tokens = max_tokens
        self.input_cost_per_million = _non_negative_decimal(
            input_cost_per_million, "Conversation Agent input token cost"
        )
        self.output_cost_per_million = _non_negative_decimal(
            output_cost_per_million, "Conversation Agent output token cost"
        )
        self.transport = transport
        self.provider_name = f"openai-compatible:{model}"

    async def respond(
        self,
        prompt: str,
        context: AgentConversationContext,
    ) -> AgentConversationAnswer:
        confirmed = [
            {
                "id": memory.id,
                "eventTime": memory.event_time.isoformat(),
                "summary": memory.summary,
                "facts": list(memory.facts),
                "people": [person.name for person in memory.people],
                "location": memory.location,
            }
            for memory in context.confirmed_memories
        ]
        recall = [
            {
                "objectKey": item.object_key,
                "score": item.score,
                "content": dict(item.content),
            }
            for item in context.agent_memory_recalls
        ]
        payload = {
            "ownerScope": context.owner_user_id,
            "relationshipId": context.relationship_id,
            "prompt": prompt,
            "confirmedMemories": confirmed,
            "openVikingRecall": recall,
            "openVikingSessionContext": dict(context.openviking_session_context)
            if context.openviking_session_context is not None
            else None,
        }
        timeout = httpx.Timeout(self.timeout_seconds, connect=min(5, self.timeout_seconds))
        provider_started_at = time.perf_counter()
        async with httpx.AsyncClient(timeout=timeout, transport=self.transport) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={"authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "response_format": {"type": "json_object"},
                    "max_tokens": self.max_tokens,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                    ],
                },
            )
            response.raise_for_status()
        provider_latency_ms = round((time.perf_counter() - provider_started_at) * 1000)
        response_payload = response.json()
        document = _response_document(response_payload)
        content = document.get("content")
        citations = document.get("citedMemoryIds", [])
        proposal = document.get("proposeMemory", False)
        if not isinstance(content, str) or not content.strip():
            raise ValueError("Conversation Agent response content is missing.")
        if not isinstance(citations, list) or any(not isinstance(item, str) for item in citations):
            raise ValueError("Conversation Agent citations must be a list of memory IDs.")
        if not isinstance(proposal, bool):
            raise ValueError("Conversation Agent proposeMemory must be boolean.")
        prompt_tokens, completion_tokens, total_tokens = _token_usage(response_payload)
        estimated_cost_microusd = _estimated_cost_microusd(
            prompt_tokens,
            completion_tokens,
            self.input_cost_per_million,
            self.output_cost_per_million,
        )
        provider_request_id = response.headers.get("x-request-id") or response_payload.get("id")
        return AgentConversationAnswer(
            content=content.strip(),
            cited_memory_ids=tuple(dict.fromkeys(citations)),
            propose_memory=proposal,
            provider_request_id=provider_request_id if isinstance(provider_request_id, str) else None,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            provider_latency_ms=provider_latency_ms,
            estimated_cost_microusd=estimated_cost_microusd,
        )


def _non_negative_decimal(value: Decimal | str | float, label: str) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError(f"{label} must be numeric.") from error
    if not parsed.is_finite() or parsed < 0:
        raise ValueError(f"{label} cannot be negative.")
    return parsed


def _token_usage(payload: Any) -> tuple[int | None, int | None, int | None]:
    usage = payload.get("usage") if isinstance(payload, dict) else None
    if not isinstance(usage, dict):
        return None, None, None
    values = []
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        value = usage.get(key)
        values.append(
            value
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0
            else None
        )
    prompt_tokens, completion_tokens, total_tokens = values
    if total_tokens is None and prompt_tokens is not None and completion_tokens is not None:
        total_tokens = prompt_tokens + completion_tokens
    return prompt_tokens, completion_tokens, total_tokens


def _estimated_cost_microusd(
    prompt_tokens: int | None,
    completion_tokens: int | None,
    input_cost_per_million: Decimal,
    output_cost_per_million: Decimal,
) -> int | None:
    if prompt_tokens is None or completion_tokens is None:
        return None
    cost = Decimal(prompt_tokens) * input_cost_per_million
    cost += Decimal(completion_tokens) * output_cost_per_million
    return int(cost.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _response_document(payload: Any) -> dict[str, Any]:
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise ValueError("Conversation Agent response envelope is invalid.") from error
    if isinstance(content, dict):
        document = content
    elif isinstance(content, str):
        try:
            document = json.loads(content)
        except json.JSONDecodeError as error:
            raise ValueError("Conversation Agent response is not valid JSON.") from error
    else:
        raise ValueError("Conversation Agent response content has an invalid type.")
    if not isinstance(document, dict):
        raise ValueError("Conversation Agent response must be a JSON object.")
    return document


def remote_conversation_agent_from_environment() -> AgentConversationProvider:
    conversation_key = os.getenv("CONVERSATION_AI_API_KEY", "").strip()
    application_key = os.getenv("AI_API_KEY", "").strip()
    openviking_key = os.getenv("OPENVIKING_AI_API_KEY", "").strip()
    if conversation_key:
        api_key = conversation_key
        base_url = os.getenv("CONVERSATION_AI_BASE_URL", "").strip() or "https://api.openai.com/v1"
        model = os.getenv("CONVERSATION_AI_MODEL", "").strip() or "gpt-4.1-mini"
    elif application_key:
        api_key = application_key
        base_url = os.getenv("AI_BASE_URL", "").strip() or "https://api.openai.com/v1"
        model = os.getenv("AI_MODEL", "").strip() or "gpt-4.1-mini"
    else:
        api_key = openviking_key
        base_url = os.getenv("OPENVIKING_AI_BASE_URL", "").strip() or "https://api.openai.com/v1"
        model = os.getenv("OPENVIKING_AI_MODEL", "").strip() or "gpt-4.1-mini"
    if not api_key:
        return LocalConversationAgent()
    return OpenAICompatibleConversationAgent(
        api_key=api_key,
        base_url=base_url,
        model=model,
        timeout_seconds=float(os.getenv("CONVERSATION_AGENT_TIMEOUT_SECONDS", "30")),
        max_tokens=int(os.getenv("CONVERSATION_AGENT_MAX_TOKENS", "1200")),
        input_cost_per_million=os.getenv("CONVERSATION_AI_INPUT_COST_PER_MILLION", "0"),
        output_cost_per_million=os.getenv("CONVERSATION_AI_OUTPUT_COST_PER_MILLION", "0"),
    )
