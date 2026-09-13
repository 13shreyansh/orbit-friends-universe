from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Protocol, Sequence, runtime_checkable

from app.schemas.memory import AnalyzeMemoryRequest, MemoryObject


@dataclass(frozen=True)
class MemoryAnalysisRecall:
    """Provider-neutral, read-only context recalled from a derived memory store."""

    object_key: str
    score: float
    content: Mapping[str, Any]


@dataclass(frozen=True)
class MemoryAnalysisContext:
    owner_user_id: str
    known_people: Sequence[Mapping[str, str]]
    related_memories: Sequence[MemoryObject]
    agent_memory_recalls: Sequence[MemoryAnalysisRecall] = ()


@runtime_checkable
class MemoryAnalysisProvider(Protocol):
    """Analyze user-owned input without deciding whether it is confirmed."""

    provider_name: str

    async def analyze(
        self,
        request: AnalyzeMemoryRequest,
        context: MemoryAnalysisContext,
    ) -> MemoryObject: ...
