from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Protocol, Sequence, runtime_checkable


@dataclass(frozen=True)
class AgentMemorySession:
    provider: str
    external_session_id: str
    user_id: str = ""
    message_count: int = 0
    commit_count: int = 0


@dataclass(frozen=True)
class AgentMemoryCommit:
    task_id: str
    status: str


@dataclass(frozen=True)
class AgentMemoryRecall:
    object_key: str
    score: float
    content: Mapping[str, Any]


@dataclass(frozen=True)
class AgentConversationSessionContext:
    latest_archive_overview: str
    messages: Sequence[Mapping[str, Any]]
    estimated_tokens: int
    stats: Mapping[str, Any]


@runtime_checkable
class AgentMemoryStore(Protocol):
    """User-scoped long-term memory boundary; providers remain derived stores."""

    async def get_or_create_session(self, *, user_id: str, session_key: str) -> AgentMemorySession: ...

    async def append(
        self,
        *,
        session: AgentMemorySession,
        role: str,
        content: Mapping[str, Any],
        dedupe_key: str,
    ) -> None: ...

    async def commit(self, *, session: AgentMemorySession) -> AgentMemoryCommit: ...

    async def get_task(self, *, task_id: str, user_id: str = "") -> AgentMemoryCommit: ...

    async def latest_task(self, *, session: AgentMemorySession) -> AgentMemoryCommit | None: ...

    async def recall(self, *, user_id: str, query: str, top_k: int = 5) -> Sequence[AgentMemoryRecall]: ...

    async def delete(self, *, user_id: str, object_key: str) -> None: ...

    async def health(self) -> Mapping[str, Any]: ...


@runtime_checkable
class AgentConversationSessionStore(Protocol):
    """Optional rolling-session capability used by Agent Chat."""

    async def get_or_create_session(self, *, user_id: str, session_key: str) -> AgentMemorySession: ...

    async def append_conversation_message(
        self,
        *,
        session: AgentMemorySession,
        role: str,
        content: str,
    ) -> None: ...

    async def commit_conversation_session(
        self,
        *,
        session: AgentMemorySession,
        keep_recent_count: int,
    ) -> AgentMemoryCommit: ...

    async def get_conversation_session_context(
        self,
        *,
        session: AgentMemorySession,
        token_budget: int,
    ) -> AgentConversationSessionContext: ...
