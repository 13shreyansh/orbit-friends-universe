from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import Field, model_validator

from .base import ApiModel
from .memory import MemoryObject, MemorySourceType


AnalysisJobStatus = Literal[
    "created",
    "uploading",
    "queued",
    "processing",
    "awaiting_confirmation",
    "confirmed",
    "failed",
    "cancelled",
    "expired",
]
MemoryDraftStatus = Literal["awaiting_confirmation", "confirmed", "rejected", "expired"]


class IngestionCreateRequest(ApiModel):
    source_type: MemorySourceType
    raw_text: str = Field(default="", max_length=100_000)
    media_asset_id: str | None = Field(default=None, max_length=100)
    relationship_id: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def validate_source(self) -> "IngestionCreateRequest":
        if self.source_type == "text" and not self.raw_text.strip():
            raise ValueError("rawText is required for text ingestion")
        if self.source_type != "text" and not self.media_asset_id:
            raise ValueError("mediaAssetId is required for media ingestion")
        return self


class AnalysisJobView(ApiModel):
    id: str
    job_type: str
    source_type: MemorySourceType
    status: AnalysisJobStatus
    attempt: int
    version: int
    provider: str
    input_hash: str
    draft_id: str | None = None
    last_error: str = ""
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


class AnalysisJobPage(ApiModel):
    items: list[AnalysisJobView] = Field(default_factory=list)
    next_cursor: str | None = None


class MemoryDraftView(ApiModel):
    id: str
    job_id: str
    relationship_id: str | None = None
    candidate_memory_id: str
    schema_version: str
    candidate: MemoryObject
    status: MemoryDraftStatus
    version: int
    confirmed_memory_id: str | None = None
    expires_at: datetime
    created_at: datetime
    updated_at: datetime


class IngestionAnalysisView(ApiModel):
    job: AnalysisJobView
    draft: MemoryDraftView | None = None


class MemoryConfirmRequest(ApiModel):
    expected_version: int = Field(ge=1)
    memory: MemoryObject | None = None
    relationship_id: str | None = Field(default=None, max_length=80)
    reason: str = Field(default="user_confirmation", min_length=1, max_length=240)


class MemoryRevisionRequest(ApiModel):
    expected_version: int = Field(ge=0)
    memory: MemoryObject
    relationship_id: str | None = Field(default=None, max_length=80)
    reason: str = Field(default="user_edit", min_length=1, max_length=240)


class MemoryRevisionView(ApiModel):
    id: str
    memory_id: str
    version: int
    author_user_id: str | None = None
    reason: str
    document: MemoryObject
    created_at: datetime


class ConfirmedMemoryDetailView(ApiModel):
    memory: MemoryObject
    relationship_id: str | None = None
    current_version: int = Field(ge=0)
    latest_revision: MemoryRevisionView | None = None
    sources: list["MemorySourceView"] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    shared: bool = False
    shared_by_user_id: str | None = None
    read_only: bool = False


class MemoryDraftRejectRequest(ApiModel):
    expected_version: int = Field(ge=1)


class AnalysisJobCancelRequest(ApiModel):
    expected_version: int = Field(ge=1)


class AnalysisJobDeleteRequest(ApiModel):
    expected_version: int = Field(ge=1)
    reason: str = Field(default="test_data_cleanup", min_length=1, max_length=240)


class DeletedAnalysisJobView(ApiModel):
    deleted: bool
    job_id: str
    audit_id: str


class ConfirmedMemoryView(ApiModel):
    memory: MemoryObject
    revision: MemoryRevisionView
    cosmos: dict[str, Any]


class DeletedMemoryView(ApiModel):
    deleted: bool
    memory_id: str
    cosmos: dict[str, Any]


class MediaAssetView(ApiModel):
    id: str
    parent_asset_id: str | None = None
    kind: str
    status: str
    mime_type: str
    size_bytes: int
    content_hash: str
    url: str | None = None
    created_at: datetime
    updated_at: datetime


class MemorySourceView(ApiModel):
    id: str
    analysis_job_id: str | None = None
    draft_id: str | None = None
    source_type: MemorySourceType
    source_order: int
    media_asset_id: str | None = None
    agent_conversation_id: str | None = None
    agent_message_id: str | None = None
    created_at: datetime


class AgentMemorySyncView(ApiModel):
    object_key: str
    version: int
    status: str
    last_error: str = ""


class ConfirmedMemorySummaryView(ApiModel):
    id: str
    summary: str
    event_time: date
    location: str = ""
    event_type: str = "memory"
    people: list[dict[str, Any]] = Field(default_factory=list)
    relationship_id: str | None = None
    current_version: int = Field(ge=0)
    sync_status: str = "not_configured"
    created_at: datetime
    updated_at: datetime
    shared: bool = False
    shared_by_user_id: str | None = None
    shared_by_name: str | None = None


class ConfirmedMemoryPage(ApiModel):
    items: list[ConfirmedMemorySummaryView] = Field(default_factory=list)
    next_cursor: str | None = None
