from __future__ import annotations

import asyncio
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.memory import LocalMemoryAgent
from app.db import RelationshipRow, UserRow
from app.domain.semantic_evidence import validate_memory_semantic_evidence
from app.ports.agent_memory import AgentMemoryStore
from app.ports.analysis_provider import (
    MemoryAnalysisContext,
    MemoryAnalysisProvider,
    MemoryAnalysisRecall,
)
from app.schemas.memory import AnalyzeMemoryRequest, MemoryObject, MemoryPersonRef, SaveMemoryRequest
from .memory_revision import save_memory_compatibility


async def _recall_agent_memory(
    store: AgentMemoryStore | None,
    *,
    owner_user_id: str,
    request: AnalyzeMemoryRequest,
    top_k: int,
) -> tuple[MemoryAnalysisRecall, ...]:
    if store is None or top_k < 1:
        return ()
    query = request.raw_text.strip() or (request.image_name or "").strip()
    if not query:
        return ()
    recalled = await store.recall(user_id=owner_user_id, query=query, top_k=top_k)
    return tuple(
        MemoryAnalysisRecall(
            object_key=item.object_key,
            score=item.score,
            content=dict(item.content),
        )
        for item in recalled[:top_k]
    )


async def analyze_memory(
    db: Session,
    owner: UserRow,
    request: AnalyzeMemoryRequest,
    agent: MemoryAnalysisProvider,
    agent_memory_store: AgentMemoryStore | None = None,
    *,
    agent_memory_recall_top_k: int = 5,
) -> MemoryObject:
    try:
        deadline = max(
            0.1,
            float(os.getenv("MEMORY_ANALYSIS_PRIMARY_DEADLINE_SECONDS", "4")),
        )
    except ValueError:
        deadline = 4.0
    started_at = asyncio.get_running_loop().time()

    relationships = list(db.scalars(select(RelationshipRow).where(RelationshipRow.owner_user_id == owner.id)))
    known_people = []
    for relationship in relationships:
        target = db.get(UserRow, relationship.target_user_id)
        if target:
            known_people.append({"id": target.id, "name": target.display_name})
    try:
        recalls = await asyncio.wait_for(
            _recall_agent_memory(
                agent_memory_store,
                owner_user_id=owner.id,
                request=request,
                top_k=agent_memory_recall_top_k,
            ),
            timeout=min(1.0, deadline),
        )
    except Exception:  # The derived recall store must never block user input.
        recalls = ()
    context = MemoryAnalysisContext(
        owner_user_id=owner.id,
        known_people=known_people,
        # Historical context must come through OpenViking's compressed,
        # owner-scoped Top-K recall. Passing every SQL memory here bypasses
        # L0/L1 context compression and grows the Agent prompt without bound.
        related_memories=(),
        agent_memory_recalls=recalls,
    )
    known_by_id = {person["id"]: person["name"] for person in known_people}

    def canonicalize(result: object, provider: MemoryAnalysisProvider) -> MemoryObject:
        memory = result if isinstance(result, MemoryObject) else MemoryObject.model_validate(result)
        canonical_people: list[MemoryPersonRef] = []
        for person in memory.people:
            canonical_name = known_by_id.get(person.id)
            if person.is_existing and canonical_name is None:
                raise ValueError(
                    f"Memory-analysis Agent returned an unknown existing person id: {person.id}"
                )
            if not person.is_existing and canonical_name is not None:
                raise ValueError(
                    f"Memory-analysis Agent marked known person {person.id} as non-existing."
                )
            canonical_people.append(
                person.model_copy(update={"name": canonical_name})
                if canonical_name is not None
                else person
            )

        canonical_memory = memory.model_copy(update={
            "source_type": request.source_type,
            "raw_text": request.raw_text,
            "media_url": request.image_url or "",
            "people": canonical_people,
            "analysis_provider": getattr(provider, "provider_name", type(provider).__name__),
        })
        validate_memory_semantic_evidence(canonical_memory)
        return canonical_memory

    fallback = LocalMemoryAgent()
    try:
        remaining = deadline - (asyncio.get_running_loop().time() - started_at)
        if remaining <= 0:
            raise TimeoutError("Memory enrichment foreground deadline exhausted.")
        result = await asyncio.wait_for(agent.analyze(request, context), timeout=remaining)
        return canonicalize(result, agent)
    except Exception:
        # Enrichment is optional. Timeouts, malformed model output, fabricated
        # entities and recall/provider failures all converge on the same safe,
        # evidence-preserving draft instead of becoming a user-visible failure.
        result = await fallback.analyze(request, context)
        return canonicalize(result, fallback)


def save_memory(
    db: Session,
    owner: UserRow,
    body: SaveMemoryRequest,
) -> dict[str, object]:
    return save_memory_compatibility(db, owner, body)
