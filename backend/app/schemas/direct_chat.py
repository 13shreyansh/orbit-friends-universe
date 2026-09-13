from __future__ import annotations

from datetime import datetime

from pydantic import Field

from .base import ApiModel


class DirectConversationView(ApiModel):
    conversation_id: str | None = None
    target_user_id: str
    target_name: str
    target_bio: str
    target_planet_id: str | None = None
    last_message_preview: str = ""
    last_message_at: datetime | None = None
    unread_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DirectConversationPage(ApiModel):
    items: list[DirectConversationView] = Field(default_factory=list)
    next_cursor: str | None = None


class DirectConversationCreateRequest(ApiModel):
    target_user_id: str = Field(min_length=1, max_length=80)


class DirectMessageView(ApiModel):
    id: str
    conversation_id: str
    sender_user_id: str
    sender_name: str
    content: str
    status: str
    mine: bool
    created_at: datetime


class DirectMessagePage(ApiModel):
    items: list[DirectMessageView] = Field(default_factory=list)
    next_cursor: str | None = None


class DirectMessageCreateRequest(ApiModel):
    client_message_id: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=20_000)


class DirectMessageAcceptedView(ApiModel):
    message: DirectMessageView
    analysis: dict[str, str]
