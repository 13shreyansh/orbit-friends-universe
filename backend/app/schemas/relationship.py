from __future__ import annotations

from pydantic import Field

from .base import ApiModel


class RelationshipRequest(ApiModel):
    target_user_id: str
    relation_type: str
    identity_label: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=2000)
    status: str = "active"
    started_at: str | None = None
