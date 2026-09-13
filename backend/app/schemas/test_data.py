from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field

from .base import ApiModel


class SyntheticAccountDeleteRequest(ApiModel):
    confirmation: str = Field(min_length=3, max_length=320)
    reason: str = Field(default="synthetic_test_cleanup", min_length=1, max_length=240)


class SyntheticAccountDeletedView(ApiModel):
    deleted: bool
    account_id: str
    audit_id: str
    deleted_job_count: int
    deleted_conversation_count: int
    deleted_at: datetime
    graph_projection: dict[str, Any]
