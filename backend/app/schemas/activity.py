from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from .base import ApiModel


ActivityKind = str
ActivityMediaType = Literal["image", "audio", "video"]
EcosystemKind = str


class ActivityMedia(ApiModel):
    type: ActivityMediaType
    url: str = Field(min_length=1, max_length=2000)
    mime_type: str = Field(min_length=1, max_length=160)
    name: str = Field(min_length=1, max_length=260)
    size: int = Field(ge=0, le=80 * 1024 * 1024)
    duration_seconds: float | None = Field(default=None, ge=0, le=60 * 60)


class EcosystemTraits(ApiModel):
    vitality: float = Field(default=0.5, ge=0, le=1)
    serenity: float = Field(default=0.5, ge=0, le=1)
    intensity: float = Field(default=0.5, ge=0, le=1)
    connection: float = Field(default=0.5, ge=0, le=1)
    motion: float = Field(default=0.5, ge=0, le=1)
    memory: float = Field(default=0.5, ge=0, le=1)
    novelty: float = Field(default=0.5, ge=0, le=1)


class EcosystemEffect(ApiModel):
    version: Literal[1] = 1
    kind: EcosystemKind
    seed: int = Field(ge=0)
    intensity: float = Field(ge=0, le=1)
    signal_strength: float = Field(ge=0, le=1)
    landmark_count: int = Field(ge=1, le=24)
    primary_color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    secondary_color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    traits: EcosystemTraits = Field(default_factory=EcosystemTraits)


class ActivityCreateRequest(ApiModel):
    # Compatibility only. New clients express meaning through unrestricted text,
    # tags and media; ecosystem generators must not require this value.
    kind: ActivityKind = Field(default="life-update", min_length=1, max_length=80)
    title: str = Field(default="", max_length=180)
    text: str = Field(default="", max_length=5000)
    event_name: str = Field(default="", max_length=180)
    location: str = Field(default="", max_length=240)
    tags: list[str] = Field(default_factory=list, max_length=12)
    visibility: Literal["friends", "public"] = "friends"
    media: list[ActivityMedia] = Field(default_factory=list, max_length=6)
    ecosystem_effect: EcosystemEffect | None = None

    @model_validator(mode="after")
    def require_content(self) -> "ActivityCreateRequest":
        if not self.text.strip() and not self.media:
            raise ValueError("A post needs text or media.")
        normalized_tags: list[str] = []
        seen: set[str] = set()
        for raw_tag in self.tags:
            tag = raw_tag.strip().lstrip("#")[:40]
            key = tag.casefold()
            if tag and key not in seen:
                seen.add(key)
                normalized_tags.append(tag)
        self.tags = normalized_tags
        return self


class ActivityPost(ApiModel):
    id: str
    author_user_id: str
    author_name: str
    planet_id: str
    kind: ActivityKind
    title: str
    text: str
    event_name: str
    location: str
    tags: list[str]
    visibility: Literal["friends", "public"]
    media: list[ActivityMedia]
    ecosystem_effect: EcosystemEffect
    published_at: datetime
    broadcast: "ActivityBroadcastState"


class ActivityBroadcastState(ApiModel):
    active: bool
    visible: bool
    can_close: bool
    seen_at: datetime | None = None
