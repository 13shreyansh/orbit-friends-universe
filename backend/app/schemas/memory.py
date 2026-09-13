from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import Field

from .base import ApiModel
from .activity import ActivityMedia


RelationshipChange = Literal["closer", "stable", "distant", "reconnected", "conflict"]
MemorySourceType = Literal["text", "chat_screenshot"]
SemanticInteractionType = Literal[
    "mention",
    "conversation",
    "co_presence",
    "shared_activity",
    "collaboration",
    "support",
    "milestone",
    "reconnection",
    "conflict",
    "other",
]
SemanticParticipation = Literal["direct", "indirect"]
SemanticDirection = Literal["mutual", "outgoing", "incoming", "unknown"]


class MemoryPersonRef(ApiModel):
    id: str
    name: str = Field(min_length=1, max_length=120)
    is_existing: bool
    relation_type: str | None = None
    identity_label: str | None = None
    relationship_description: str | None = None


class MemoryEmotion(ApiModel):
    name: str = Field(min_length=1, max_length=80)
    intensity: float = Field(ge=0, le=100)


class MemoryRelationshipSignals(ApiModel):
    interaction_frequency: float = Field(ge=0, le=100)
    emotional_intimacy: float = Field(ge=0, le=100)
    initiative_balance: float = Field(ge=0, le=100)
    relationship_change: RelationshipChange


class MemorySemanticEvidence(ApiModel):
    schema_version: Literal["semantic-evidence.v1"] = "semantic-evidence.v1"
    interaction_type: SemanticInteractionType
    participation: SemanticParticipation
    direction: SemanticDirection
    evidence_spans: list[str] = Field(default_factory=list, max_length=12)
    confidence: float = Field(ge=0, le=1)


class MemoryObject(ApiModel):
    id: str
    source_type: MemorySourceType
    raw_text: str = Field(default="", max_length=100_000)
    media_url: str = Field(default="", max_length=2000)
    media: list[ActivityMedia] = Field(default_factory=list, max_length=6)
    people: list[MemoryPersonRef] = Field(default_factory=list, max_length=30)
    event_time: date
    location: str = Field(default="", max_length=240)
    event_type: str = Field(default="memory", max_length=80)
    summary: str = Field(min_length=1, max_length=2000)
    facts: list[str] = Field(default_factory=list, max_length=50)
    emotions: list[MemoryEmotion] = Field(default_factory=list, max_length=20)
    relationship_signals: MemoryRelationshipSignals
    keywords: list[str] = Field(default_factory=list, max_length=30)
    narrative: str = Field(default="", max_length=2000)
    confidence: float = Field(ge=0, le=1)
    semantic_evidence: MemorySemanticEvidence | None = None
    analysis_provider: str | None = None


class AnalyzeMemoryRequest(ApiModel):
    source_type: MemorySourceType
    raw_text: str = Field(default="", max_length=100_000)
    image_name: str | None = Field(default=None, max_length=260)
    image_url: str | None = Field(default=None, max_length=2000)


class SaveMemoryRequest(ApiModel):
    memory: MemoryObject
    relationship_id: str | None = None

