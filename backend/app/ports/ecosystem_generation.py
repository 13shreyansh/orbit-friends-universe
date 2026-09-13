from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.schemas.activity import EcosystemEffect


@dataclass(frozen=True)
class EcosystemGenerationInput:
    owner_user_id: str
    activity_id: str
    title: str
    text: str
    tags: tuple[str, ...]
    media_types: tuple[str, ...]


class EcosystemGenerator(Protocol):
    """Replaceable semantic-to-visual boundary for local rules or an AI service."""

    def generate(self, source: EcosystemGenerationInput) -> EcosystemEffect: ...
