from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Protocol, Sequence, runtime_checkable

from app.ports.analysis_provider import MemoryAnalysisRecall
from app.schemas.memory import MemoryObject


@dataclass(frozen=True)
class AgentConversationContext:
    owner_user_id: str
    relationship_id: str | None
    confirmed_memories: Sequence[MemoryObject]
    agent_memory_recalls: Sequence[MemoryAnalysisRecall] = ()
    openviking_session_context: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class AgentConversationAnswer:
    content: str
    cited_memory_ids: Sequence[str] = ()
    propose_memory: bool = False
    provider_request_id: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    provider_latency_ms: int | None = None
    first_token_latency_ms: int | None = None
    estimated_cost_microusd: int | None = None


@runtime_checkable
class AgentConversationProvider(Protocol):
    provider_name: str

    async def respond(
        self,
        prompt: str,
        context: AgentConversationContext,
    ) -> AgentConversationAnswer: ...
