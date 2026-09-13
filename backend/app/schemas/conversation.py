from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import Field

from .base import ApiModel


ConversationMode = Literal["memory_companion"]
ConversationStatus = Literal["active", "archived"]
MessageRole = Literal["user", "assistant"]
MessageStatus = Literal["pending", "completed", "failed", "cancelled"]
RunStatus = Literal["queued", "retrieving", "generating", "completed", "failed", "cancelled"]
FeedbackRating = Literal["helpful", "inaccurate", "unsafe"]


class ConversationCreateRequest(ApiModel):
    title: str = Field(min_length=1, max_length=120)
    mode: ConversationMode = "memory_companion"
    relationship_id: str | None = Field(default=None, max_length=80)


class ConversationUpdateRequest(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    status: ConversationStatus | None = None


class ConversationView(ApiModel):
    id: str
    title: str
    mode: ConversationMode
    relationship_id: str | None = None
    status: ConversationStatus
    last_message_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ConversationPage(ApiModel):
    items: list[ConversationView] = Field(default_factory=list)
    next_cursor: str | None = None


class MemoryCitationView(ApiModel):
    memory_id: str
    summary: str
    event_time: date


class MemoryProposalView(ApiModel):
    draft_id: str
    status: str
    summary: str


class MessageView(ApiModel):
    id: str
    conversation_id: str
    role: MessageRole
    status: MessageStatus
    content: str
    citations: list[MemoryCitationView] = Field(default_factory=list)
    memory_proposal: MemoryProposalView | None = None
    created_at: datetime


class MessagePage(ApiModel):
    items: list[MessageView] = Field(default_factory=list)
    next_cursor: str | None = None


class MessageCreateRequest(ApiModel):
    client_message_id: str = Field(min_length=1, max_length=80)
    content: str = Field(min_length=1, max_length=20_000)


class AgentRunView(ApiModel):
    id: str
    conversation_id: str
    user_message_id: str
    assistant_message_id: str
    status: RunStatus
    provider: str
    retrieval_degraded: bool = False
    last_error: str = ""
    creation_request_id: str | None = None
    execution_request_id: str | None = None
    provider_request_id: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    provider_latency_ms: int | None = None
    total_latency_ms: int | None = None
    first_token_latency_ms: int | None = None
    estimated_cost_microusd: int | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


class MessageAcceptedView(ApiModel):
    message: MessageView
    run: AgentRunView


class FeedbackCreateRequest(ApiModel):
    rating: FeedbackRating
    comment: str = Field(default="", max_length=2000)


class FeedbackView(ApiModel):
    message_id: str
    rating: FeedbackRating
    comment: str
    created_at: datetime
    updated_at: datetime


class ConversationDeletedView(ApiModel):
    deleted: bool
    conversation_id: str
