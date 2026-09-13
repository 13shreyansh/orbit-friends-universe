from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import date
from typing import Sequence

from app.schemas.memory import MemoryObject


# These are backend-owned policy values. The Agent only selects a controlled
# event class and cites evidence; it cannot supply impact weights or distance.
SEMANTIC_EVENT_IMPACT = {
    "mention": 0.00,
    "conversation": 0.10,
    "co_presence": 0.20,
    "shared_activity": 0.35,
    "collaboration": 0.55,
    "support": 0.75,
    "milestone": 0.80,
    "reconnection": 0.65,
    "conflict": -0.75,
    "other": 0.00,
}

SEMANTIC_EVENT_DECAY_DAYS = {
    "mention": 90,
    "conversation": 180,
    "co_presence": 240,
    "shared_activity": 365,
    "collaboration": 540,
    "support": 540,
    "milestone": 1095,
    "reconnection": 365,
    "conflict": 270,
    "other": 180,
}

SOURCE_QUALITY = {"text": 0.95, "chat_screenshot": 0.82}
PARTICIPATION_QUALITY = {"direct": 1.0, "indirect": 0.45}
DIRECTION_QUALITY = {"mutual": 1.0, "outgoing": 0.82, "incoming": 0.82, "unknown": 0.60}


@dataclass(frozen=True)
class SemanticEvidenceSignal:
    value: float | None
    confidence: float
    evidence_count: int


def _normalized_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def validate_memory_semantic_evidence(memory: MemoryObject) -> None:
    evidence = memory.semantic_evidence
    if evidence is None:
        return
    if any(not span.strip() or len(span) > 500 for span in evidence.evidence_spans):
        raise ValueError("Semantic evidence spans must contain 1-500 characters.")
    raw_text = _normalized_text(memory.raw_text)
    if raw_text:
        if not evidence.evidence_spans:
            raise ValueError("Text semantic evidence requires at least one source span.")
        for span in evidence.evidence_spans:
            if _normalized_text(span) not in raw_text:
                raise ValueError("Semantic evidence span is not present in the submitted raw text.")
    elif evidence.evidence_spans:
        raise ValueError("Semantic evidence spans require submitted raw text.")


def aggregate_semantic_evidence(
    memories: Sequence[MemoryObject],
    *,
    reference_date: date,
) -> SemanticEvidenceSignal:
    weighted_impact = 0.0
    observed_weight = 0.0
    evidence_count = 0
    for memory in memories:
        evidence = memory.semantic_evidence
        if evidence is None:
            continue
        impact = SEMANTIC_EVENT_IMPACT[evidence.interaction_type]
        age_days = max(0, (reference_date - memory.event_time).days)
        decay = math.exp(-age_days / SEMANTIC_EVENT_DECAY_DAYS[evidence.interaction_type])
        quality = (
            memory.confidence
            * evidence.confidence
            * SOURCE_QUALITY[memory.source_type]
            * PARTICIPATION_QUALITY[evidence.participation]
            * DIRECTION_QUALITY[evidence.direction]
            * decay
        )
        weighted_impact += impact * quality
        observed_weight += quality
        evidence_count += 1
    if not observed_weight:
        return SemanticEvidenceSignal(None, 0.0, 0)
    signed_average = max(-1.0, min(1.0, weighted_impact / observed_weight))
    value = 0.5 + 0.5 * signed_average
    confidence = 1 - math.exp(-observed_weight / 2)
    return SemanticEvidenceSignal(
        value=round(value, 6),
        confidence=round(max(0.0, min(1.0, confidence)), 6),
        evidence_count=evidence_count,
    )

