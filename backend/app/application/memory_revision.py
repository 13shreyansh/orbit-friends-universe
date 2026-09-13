from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.db import (
    IntegrationOutboxRow,
    MemoryDraftRow,
    MemoryRevisionRow,
    MemoryRow,
    MemorySourceRow,
    RelationshipRow,
    TimelineRow,
    UserRow,
)
from app.domain.semantic_evidence import validate_memory_semantic_evidence
from app.domain.agent_memory_policy import (
    AGENT_MEMORY_DESTINATION,
    agent_memory_dedupe_key,
    agent_memory_event,
)
from app.domain.memory_revision import StaleMemoryRevision, next_revision_version, validate_expected_revision
from app.schemas.ingestion import (
    ConfirmedMemoryDetailView,
    MemoryRevisionRequest,
    MemoryRevisionView,
    MemorySourceView,
)
from app.schemas.memory import MemoryObject, SaveMemoryRequest

from .behavior import record_user_behavior
from .errors import ResourceConflictError, ResourceNotFoundError
from .serialization import content_dedupe_key, dumps, loads, new_id
from .universe import get_cosmos
from .memory_sharing import accessible_memory_share, sync_memory_shares


def latest_revision_version(db: Session, memory_id: str) -> int:
    return int(
        db.scalar(
            select(func.max(MemoryRevisionRow.version)).where(MemoryRevisionRow.memory_id == memory_id)
        )
        or 0
    )


def _add_revision(
    db: Session,
    *,
    owner_user_id: str,
    memory_id: str,
    version: int,
    author_user_id: str | None,
    reason: str,
    document_json: str,
) -> MemoryRevisionRow:
    revision = MemoryRevisionRow(
        id=new_id("revision"),
        owner_user_id=owner_user_id,
        memory_id=memory_id,
        version=version,
        author_user_id=author_user_id,
        reason=reason,
        document_json=document_json,
    )
    db.add(revision)
    return revision


def _enqueue_agent_memory(
    db: Session,
    *,
    owner_user_id: str,
    memory_id: str,
    version: int,
    deleted: bool,
    payload: dict[str, Any],
) -> IntegrationOutboxRow:
    dedupe_key = agent_memory_dedupe_key(memory_id=memory_id, version=version, deleted=deleted)
    existing = db.scalar(
        select(IntegrationOutboxRow).where(
            IntegrationOutboxRow.destination == AGENT_MEMORY_DESTINATION,
            IntegrationOutboxRow.dedupe_key == dedupe_key,
        )
    )
    if existing:
        return existing
    row = IntegrationOutboxRow(
        owner_user_id=owner_user_id,
        destination=AGENT_MEMORY_DESTINATION,
        aggregate_type="memory",
        aggregate_id=memory_id,
        aggregate_version=version,
        event_type=agent_memory_event(deleted=deleted),
        dedupe_key=dedupe_key,
        payload_json=dumps(payload),
    )
    db.add(row)
    return row


def _owned_relationships_for_memory(
    db: Session,
    *,
    owner_user_id: str,
    requested_relationship_id: str | None,
    memory: MemoryObject,
) -> list[RelationshipRow]:
    relationships = list(db.scalars(
        select(RelationshipRow).where(RelationshipRow.owner_user_id == owner_user_id)
    ))
    by_id = {relationship.id: relationship for relationship in relationships}
    if requested_relationship_id and requested_relationship_id not in by_id:
        raise ResourceNotFoundError("Relationship not found.")
    by_target = {relationship.target_user_id: relationship for relationship in relationships}
    related = {
        relationship.id: relationship
        for person in memory.people
        for relationship in [by_target.get(person.id)]
        if relationship is not None
    }
    if requested_relationship_id:
        related[requested_relationship_id] = by_id[requested_relationship_id]
    return list(related.values())


def _upsert_timelines(
    db: Session,
    *,
    owner_user_id: str,
    relationships: list[RelationshipRow],
    memory: MemoryObject,
) -> None:
    timelines = list(db.scalars(select(TimelineRow).where(
        TimelineRow.owner_user_id == owner_user_id,
        TimelineRow.source_memory_id == memory.id,
    )))
    by_relationship_id = {timeline.relationship_id: timeline for timeline in timelines}
    related_ids = {relationship.id for relationship in relationships}
    for timeline in timelines:
        if timeline.relationship_id not in related_ids:
            db.delete(timeline)
    signal = memory.relationship_signals
    emotion = memory.emotions[0].name if memory.emotions else "calm"
    for relationship in relationships:
        timeline = by_relationship_id.get(relationship.id)
        if not timeline:
            timeline = TimelineRow(
                id=new_id("timeline"),
                owner_user_id=owner_user_id,
                relationship_id=relationship.id,
                source_memory_id=memory.id,
                event_time=memory.event_time.isoformat(),
                event_type=signal.relationship_change,
                intimacy=signal.emotional_intimacy,
                interaction_frequency=signal.interaction_frequency,
                emotional_tone=emotion,
                description=memory.summary,
            )
            db.add(timeline)
            continue
        timeline.event_time = memory.event_time.isoformat()
        timeline.event_type = signal.relationship_change
        timeline.intimacy = signal.emotional_intimacy
        timeline.interaction_frequency = signal.interaction_frequency
        timeline.emotional_tone = emotion
        timeline.description = memory.summary


def persist_confirmed_memory(
    db: Session,
    owner: UserRow,
    memory: MemoryObject,
    *,
    relationship_id: str | None,
    reason: str,
    expected_version: int | None = None,
    allow_existing: bool = True,
    record_behavior: bool = True,
) -> MemoryRevisionRow:
    """Persist the fact, timeline, evidence, revision, and outbox atomically."""

    validate_memory_semantic_evidence(memory)

    relationships = _owned_relationships_for_memory(
        db,
        owner_user_id=owner.id,
        requested_relationship_id=relationship_id,
        memory=memory,
    )
    primary_relationship_id = relationships[0].id if len(relationships) == 1 else None
    existing = db.get(MemoryRow, memory.id)
    if existing and existing.owner_user_id != owner.id:
        raise ResourceConflictError("Memory id is already in use.")
    if existing and not allow_existing:
        raise ResourceConflictError("A confirmed memory already uses this id.")

    current_version = latest_revision_version(db, memory.id)
    if expected_version is not None:
        try:
            validate_expected_revision(current_version=current_version, expected_version=expected_version)
        except StaleMemoryRevision as error:
            raise ResourceConflictError(str(error)) from error
    if existing and current_version == 0:
        _add_revision(
            db,
            owner_user_id=owner.id,
            memory_id=existing.id,
            version=1,
            author_user_id=owner.id,
            reason="legacy_baseline",
            document_json=existing.memory_json,
        )
        current_version = 1
        db.flush()

    document_json = dumps(memory)
    is_revision = existing is not None
    now = datetime.now(timezone.utc)
    if existing:
        existing.relationship_id = primary_relationship_id
        existing.memory_json = document_json
        existing.event_time = memory.event_time.isoformat()
        existing.updated_at = now
    else:
        existing = MemoryRow(
            id=memory.id,
            owner_user_id=owner.id,
            relationship_id=primary_relationship_id,
            memory_json=document_json,
            event_time=memory.event_time.isoformat(),
        )
        db.add(existing)
        db.flush()

    version = next_revision_version(current_version)
    revision = _add_revision(
        db,
        owner_user_id=owner.id,
        memory_id=memory.id,
        version=version,
        author_user_id=owner.id,
        reason=reason,
        document_json=document_json,
    )
    if record_behavior:
        event_type = "memory_revised" if is_revision else "memory_recorded"
        evidence = memory.model_dump(mode="json", by_alias=True, exclude={"id"})
        for relationship in relationships or [None]:
            target_user_id = relationship.target_user_id if relationship else None
            record_user_behavior(
                db,
                owner.id,
                event_type,
                dedupe_key=content_dedupe_key(
                    f"memory:{event_type}:{target_user_id or 'self'}",
                    evidence,
                ),
                target_user_id=target_user_id,
                metadata={
                    "memoryId": memory.id,
                    "relationshipId": relationship.id if relationship else None,
                    "revision": version,
                },
            )
    _upsert_timelines(db, owner_user_id=owner.id, relationships=relationships, memory=memory)
    sync_memory_shares(
        db,
        owner,
        existing,
        relationships,
        memory_version=version,
    )
    _enqueue_agent_memory(
        db,
        owner_user_id=owner.id,
        memory_id=memory.id,
        version=version,
        deleted=False,
        payload={
            "memory": memory.model_dump(mode="json", by_alias=True),
            "relationshipId": primary_relationship_id,
            "relationshipIds": [relationship.id for relationship in relationships],
            "revision": version,
        },
    )
    db.flush()
    return revision


def serialize_revision(revision: MemoryRevisionRow) -> MemoryRevisionView:
    return MemoryRevisionView(
        id=revision.id,
        memory_id=revision.memory_id,
        version=revision.version,
        author_user_id=revision.author_user_id,
        reason=revision.reason,
        document=MemoryObject.model_validate(loads(revision.document_json, {})),
        created_at=revision.created_at,
    )


def get_confirmed_memory_detail(
    db: Session,
    owner: UserRow,
    memory_id: str,
) -> ConfirmedMemoryDetailView:
    memory = db.scalar(select(MemoryRow).where(MemoryRow.id == memory_id, MemoryRow.owner_user_id == owner.id))
    share = None if memory else accessible_memory_share(db, owner, memory_id)
    if not memory and share:
        memory = db.get(MemoryRow, memory_id)
    if not memory:
        raise ResourceNotFoundError("Memory not found.")
    read_only = share is not None
    latest_revision = db.scalar(
        select(MemoryRevisionRow)
        .where(
            MemoryRevisionRow.memory_id == memory_id,
            MemoryRevisionRow.owner_user_id == memory.owner_user_id,
        )
        .order_by(MemoryRevisionRow.version.desc())
        .limit(1)
    )
    sources = list(
        db.scalars(
            select(MemorySourceRow)
            .where(MemorySourceRow.memory_id == memory_id, MemorySourceRow.owner_user_id == memory.owner_user_id)
            .order_by(MemorySourceRow.source_order, MemorySourceRow.created_at)
        )
    )
    return ConfirmedMemoryDetailView(
        memory=MemoryObject.model_validate(loads(memory.memory_json, {})),
        relationship_id=share.recipient_relationship_id if share else memory.relationship_id,
        current_version=latest_revision.version if latest_revision else 0,
        latest_revision=serialize_revision(latest_revision) if latest_revision else None,
        sources=[
            MemorySourceView(
                id=source.id,
                analysis_job_id=source.analysis_job_id,
                draft_id=source.draft_id,
                source_type=source.source_type,
                source_order=source.source_order,
                media_asset_id=source.media_asset_id,
                agent_conversation_id=source.agent_conversation_id,
                agent_message_id=source.agent_message_id,
                created_at=source.created_at,
            )
            for source in sources
        ],
        created_at=memory.created_at,
        updated_at=memory.updated_at,
        shared=read_only,
        shared_by_user_id=memory.owner_user_id if read_only else None,
        read_only=read_only,
    )


def save_memory_compatibility(
    db: Session,
    owner: UserRow,
    body: SaveMemoryRequest,
) -> dict[str, Any]:
    persist_confirmed_memory(
        db,
        owner,
        body.memory,
        relationship_id=body.relationship_id,
        reason="compatibility_api",
    )
    return {
        "memory": body.memory.model_dump(mode="json", by_alias=True),
        "cosmos": get_cosmos(db, owner),
    }


def revise_confirmed_memory(
    db: Session,
    owner: UserRow,
    memory_id: str,
    body: MemoryRevisionRequest,
) -> dict[str, Any]:
    if body.memory.id != memory_id:
        raise ResourceConflictError("The memory id in the document cannot be changed.")
    memory = db.scalar(
        select(MemoryRow).where(MemoryRow.id == memory_id, MemoryRow.owner_user_id == owner.id).with_for_update()
    )
    if not memory:
        raise ResourceNotFoundError("Memory not found.")
    relationship_id = (
        body.relationship_id if "relationship_id" in body.model_fields_set else memory.relationship_id
    )
    revision = persist_confirmed_memory(
        db,
        owner,
        body.memory,
        relationship_id=relationship_id,
        reason=body.reason,
        expected_version=body.expected_version,
    )
    return {
        "memory": body.memory,
        "revision": serialize_revision(revision),
        "cosmos": get_cosmos(db, owner),
    }


def delete_confirmed_memory(db: Session, owner: UserRow, memory_id: str) -> dict[str, Any]:
    memory = db.scalar(
        select(MemoryRow).where(MemoryRow.id == memory_id, MemoryRow.owner_user_id == owner.id).with_for_update()
    )
    if not memory:
        raise ResourceNotFoundError("Memory not found.")
    delete_version = latest_revision_version(db, memory_id) + 1
    db.execute(delete(TimelineRow).where(TimelineRow.source_memory_id == memory_id))
    db.execute(update(MemorySourceRow).where(MemorySourceRow.memory_id == memory_id).values(memory_id=None))
    db.execute(
        update(MemoryDraftRow)
        .where(MemoryDraftRow.confirmed_memory_id == memory_id)
        .values(confirmed_memory_id=None)
    )
    db.execute(delete(MemoryRevisionRow).where(MemoryRevisionRow.memory_id == memory_id))
    db.delete(memory)
    previous_events = list(
        db.scalars(
            select(IntegrationOutboxRow).where(
                IntegrationOutboxRow.owner_user_id == owner.id,
                IntegrationOutboxRow.destination == AGENT_MEMORY_DESTINATION,
                IntegrationOutboxRow.aggregate_type == "memory",
                IntegrationOutboxRow.aggregate_id == memory_id,
            )
        )
    )
    for event in previous_events:
        event.payload_json = dumps({"memoryId": memory_id, "redacted": True})
        if event.status != "completed":
            event.status = "cancelled"
        event.updated_at = datetime.now(timezone.utc)
    _enqueue_agent_memory(
        db,
        owner_user_id=owner.id,
        memory_id=memory_id,
        version=delete_version,
        deleted=True,
        payload={"memoryId": memory_id, "deleted": True, "revision": delete_version},
    )
    db.flush()
    return {"deleted": True, "memoryId": memory_id, "cosmos": get_cosmos(db, owner)}


def list_memory_revisions(db: Session, owner: UserRow, memory_id: str) -> list[MemoryRevisionView]:
    memory = db.scalar(select(MemoryRow.id).where(MemoryRow.id == memory_id, MemoryRow.owner_user_id == owner.id))
    if not memory:
        raise ResourceNotFoundError("Memory not found.")
    rows = list(
        db.scalars(
            select(MemoryRevisionRow)
            .where(MemoryRevisionRow.memory_id == memory_id, MemoryRevisionRow.owner_user_id == owner.id)
            .order_by(MemoryRevisionRow.version)
        )
    )
    return [serialize_revision(row) for row in rows]
