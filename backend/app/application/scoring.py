from __future__ import annotations

from datetime import date, datetime, timezone
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import MemoryRow, RelationshipRow, UserBehaviorEventRow, UserRow
from app.domain.memory_context import StoredMemory, relevant_relationship_memories
from app.domain.behavior_policy import relationship_evidence_event_types
from app.domain.profile_affinity import calculate_profile_affinity
from app.domain.scoring import (
    BehaviorEvidence,
    aggregate_relationship_memory_signals,
    calculate_planet_score,
    calculate_relationship_score,
    deduplicate_memories,
    effective_behavior_evidence_count,
)
from app.infrastructure.semantic_similarity import semantic_similarity_from_environment
from app.ports.semantic_similarity import SemanticSimilarity
from app.schemas.memory import MemoryObject
from app.schemas.profile import ProfileIntake
from app.schemas.universe import PlanetScore, RelationshipScore

from .serialization import dumps, loads


RELATIONSHIP_EVIDENCE_EVENT_TYPES = relationship_evidence_event_types()


@lru_cache(maxsize=1)
def _default_semantic_similarity() -> SemanticSimilarity:
    return semantic_similarity_from_environment()


def resolve_semantic_similarity(
    semantic_similarity: SemanticSimilarity | None,
) -> SemanticSimilarity:
    """Resolve one strict production provider lazily for process-wide reuse."""

    return semantic_similarity if semantic_similarity is not None else _default_semantic_similarity()


def owned_memory_objects(db: Session, owner_user_id: str) -> list[MemoryObject]:
    rows = list(db.scalars(
        select(MemoryRow)
        .where(MemoryRow.owner_user_id == owner_user_id)
        .order_by(MemoryRow.event_time)
    ))
    return [MemoryObject.model_validate(loads(row.memory_json, {})) for row in rows]


def _participant_memory_records(db: Session, user_ids: set[str]) -> list[StoredMemory]:
    rows = list(db.scalars(select(MemoryRow).where(MemoryRow.owner_user_id.in_(user_ids))))
    return [
        StoredMemory(
            owner_user_id=row.owner_user_id,
            relationship_id=row.relationship_id,
            memory=MemoryObject.model_validate(loads(row.memory_json, {})),
        )
        for row in rows
    ]


def simulation_tick(value: datetime | None = None) -> datetime:
    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def _behavior_evidence(
    db: Session,
    owner_user_id: str,
) -> tuple[list[BehaviorEvidence], list[BehaviorEvidence]]:
    own_rows = list(db.scalars(
        select(UserBehaviorEventRow)
        .where(UserBehaviorEventRow.owner_user_id == owner_user_id)
        .order_by(UserBehaviorEventRow.occurred_at)
    ))
    incoming_rows = list(db.scalars(
        select(UserBehaviorEventRow)
        .where(
            UserBehaviorEventRow.target_user_id == owner_user_id,
            UserBehaviorEventRow.owner_user_id != owner_user_id,
        )
        .order_by(UserBehaviorEventRow.occurred_at)
    ))
    return (
        [BehaviorEvidence(row.event_type, row.weight, row.occurred_at) for row in own_rows],
        [BehaviorEvidence(row.event_type, row.weight, row.occurred_at) for row in incoming_rows],
    )


def calculate_current_planet_score(
    db: Session,
    user: UserRow,
    profile: ProfileIntake,
    *,
    computed_at: datetime | None = None,
) -> PlanetScore:
    own_behavior, social_behavior = _behavior_evidence(db, user.id)
    return calculate_planet_score(
        profile,
        owned_memory_objects(db, user.id),
        own_behavior,
        social_behavior,
        computed_at=simulation_tick(computed_at),
    )


def calculate_current_relationship_score(
    db: Session,
    relationship: RelationshipRow,
    *,
    computed_at: datetime | None = None,
    semantic_similarity: SemanticSimilarity | None = None,
) -> RelationshipScore:
    reciprocal = db.scalar(select(RelationshipRow).where(
        RelationshipRow.owner_user_id == relationship.target_user_id,
        RelationshipRow.target_user_id == relationship.owner_user_id,
    ))
    relationship_ids = {relationship.id}
    if reciprocal:
        relationship_ids.add(reciprocal.id)
    owner = db.get(UserRow, relationship.owner_user_id)
    target = db.get(UserRow, relationship.target_user_id)
    if not owner or not target:
        raise ValueError("Relationship participants must exist.")

    def profile_for(user: UserRow) -> ProfileIntake:
        data = loads(user.intake_json, {})
        return ProfileIntake.model_validate(data) if data else ProfileIntake(
            display_name=user.display_name,
            bio=user.bio,
            interests=[{"name": tag} for tag in loads(user.tags_json, [])],
        )

    affinity = calculate_profile_affinity(
        profile_for(owner),
        profile_for(target),
        resolve_semantic_similarity(semantic_similarity),
    )
    records = _participant_memory_records(
        db,
        {relationship.owner_user_id, relationship.target_user_id},
    )
    memories = deduplicate_memories(relevant_relationship_memories(
        records,
        owner_user_id=relationship.owner_user_id,
        target_user_id=relationship.target_user_id,
        relationship_ids=relationship_ids,
    ))
    started_at = None
    if relationship.started_at:
        try:
            started_at = date.fromisoformat(relationship.started_at)
        except ValueError:
            started_at = None
    tick = simulation_tick(computed_at)
    outgoing_rows = list(db.scalars(select(UserBehaviorEventRow).where(
        UserBehaviorEventRow.owner_user_id == relationship.owner_user_id,
        UserBehaviorEventRow.target_user_id == relationship.target_user_id,
        UserBehaviorEventRow.event_type.in_(RELATIONSHIP_EVIDENCE_EVENT_TYPES),
    )))
    incoming_rows = list(db.scalars(select(UserBehaviorEventRow).where(
        UserBehaviorEventRow.owner_user_id == relationship.target_user_id,
        UserBehaviorEventRow.target_user_id == relationship.owner_user_id,
        UserBehaviorEventRow.event_type.in_(RELATIONSHIP_EVIDENCE_EVENT_TYPES),
    )))
    outgoing = [BehaviorEvidence(row.event_type, row.weight, row.occurred_at) for row in outgoing_rows]
    incoming = [BehaviorEvidence(row.event_type, row.weight, row.occurred_at) for row in incoming_rows]
    signals = aggregate_relationship_memory_signals(
        affinity.score,
        memories,
        outgoing_behavior=outgoing,
        incoming_behavior=incoming,
        profile_affinity_confidence=affinity.confidence,
        relationship_started_at=started_at,
        computed_at=tick,
    )
    score = calculate_relationship_score(
        relationship.relation_type,
        signals,
        memory_count=len(memories),
        behavior_event_count=(
            effective_behavior_evidence_count(outgoing)
            + effective_behavior_evidence_count(incoming)
        ),
        profile_features=affinity.features,
        computed_at=tick,
    )
    relationship.signals_json = dumps(signals)
    relationship.score_json = dumps(score)
    return score
