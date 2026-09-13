from __future__ import annotations

import hashlib
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from app.ports.analysis_provider import MemoryAnalysisContext, MemoryAnalysisProvider

from app.schemas.memory import (
    AnalyzeMemoryRequest,
    MemoryObject,
    MemoryPersonRef,
    MemoryRelationshipSignals,
)


RELATIONSHIP_TYPES = (
    "family",
    "friend",
    "partner",
    "colleague",
    "classmate",
    "mentor",
    "community",
    "past",
    "other",
)

MemoryAgentContext = MemoryAnalysisContext
EmbeddedMemoryAgent = MemoryAnalysisProvider


class LocalMemoryAgent:
    """Conservative deterministic fallback for unavailable AI analysis.

    The fallback deliberately preserves submitted evidence instead of trying
    to imitate a generative model. It never invents a person, location,
    emotion, event category, or relationship change.
    """

    provider_name = "local-fallback"

    async def analyze(
        self,
        request: AnalyzeMemoryRequest,
        context: MemoryAgentContext,
    ) -> MemoryObject:
        source = request.raw_text.strip()
        summary = source[:177] + "..." if len(source) > 180 else source
        if not summary:
            summary = "A shared memory awaiting details"
        seed = _seed(source)
        lower = source.lower()
        mentioned = [
            person
            for person in context.known_people
            if person["name"].lower() in lower
        ]
        relation_type = next((kind for kind in RELATIONSHIP_TYPES if kind in lower), "friend")
        return MemoryObject(
            id=f"memory-{time.time_ns():x}-{seed:x}",
            source_type=request.source_type,
            raw_text=request.raw_text,
            media_url="",
            people=[MemoryPersonRef(
                id=person["id"],
                name=person["name"],
                is_existing=True,
                relation_type=relation_type,
                identity_label=(
                    "Family member" if relation_type == "family"
                    else "Colleague" if relation_type == "colleague"
                    else "Friend"
                ),
                relationship_description=summary,
            ) for person in mentioned],
            event_time=datetime.now(ZoneInfo("Asia/Shanghai")).date(),
            location="",
            event_type="memory",
            summary=summary,
            facts=[summary] if source else [],
            emotions=[],
            relationship_signals=MemoryRelationshipSignals(
                interaction_frequency=50,
                emotional_intimacy=50,
                initiative_balance=50,
                relationship_change="stable",
            ),
            keywords=[],
            narrative=summary,
            confidence=0.35,
            analysis_provider=self.provider_name,
        )


def _seed(text: str) -> int:
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:12], 16)

