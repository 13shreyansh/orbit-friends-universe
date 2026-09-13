from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.db import (
    MemoryRow,
    MemoryShareRow,
    MemorySignalReceiptRow,
    MemorySignalRow,
    PlanetRow,
    RelationshipRow,
    UserRow,
)

from .behavior import record_user_behavior
from .errors import ResourceNotFoundError, ResourceStateError
from .serialization import loads, new_id


def sync_memory_shares(
    db: Session,
    owner: UserRow,
    memory: MemoryRow,
    relationships: list[RelationshipRow],
    *,
    memory_version: int,
) -> None:
    """Replace relationship recipients and emit one new signal per recipient.

    A memory without an owned relationship remains private. The recipient's
    reciprocal relationship is only a presentation mapping; it never grants
    the recipient write access to the owner's MemoryRow.
    """
    db.execute(delete(MemoryShareRow).where(MemoryShareRow.memory_id == memory.id))
    db.execute(
        update(MemorySignalRow)
        .where(MemorySignalRow.memory_id == memory.id)
        .values(active=False, updated_at=datetime.now(timezone.utc))
    )
    owner_planet = db.scalar(select(PlanetRow).where(PlanetRow.owner_user_id == owner.id))
    for relationship in relationships:
        recipient = db.get(UserRow, relationship.target_user_id)
        if not recipient or recipient.id == owner.id:
            continue
        reciprocal = db.scalar(select(RelationshipRow).where(
            RelationshipRow.owner_user_id == recipient.id,
            RelationshipRow.target_user_id == owner.id,
        ))
        recipient_planet = db.scalar(select(PlanetRow).where(PlanetRow.owner_user_id == recipient.id))
        db.add(MemoryShareRow(
            id=new_id("memory-share"),
            memory_id=memory.id,
            owner_user_id=owner.id,
            recipient_user_id=recipient.id,
            owner_relationship_id=relationship.id,
            recipient_relationship_id=reciprocal.id if reciprocal else None,
            status="active",
        ))
        db.add(MemorySignalRow(
            id=new_id("memory-signal"),
            memory_id=memory.id,
            sender_user_id=owner.id,
            recipient_user_id=recipient.id,
            source_planet_id=owner_planet.id if owner_planet else None,
            target_planet_id=recipient_planet.id if recipient_planet else None,
            memory_version=memory_version,
            active=True,
        ))
    db.flush()


def _share_for_viewer(db: Session, owner: UserRow, memory_id: str) -> MemoryShareRow | None:
    return db.scalar(select(MemoryShareRow).where(
        MemoryShareRow.memory_id == memory_id,
        MemoryShareRow.recipient_user_id == owner.id,
        MemoryShareRow.status == "active",
    ))


def serialize_memory_signal(db: Session, row: MemorySignalRow, viewer_user_id: str) -> dict[str, Any]:
    sender = db.get(UserRow, row.sender_user_id)
    memory = db.get(MemoryRow, row.memory_id)
    document = loads(memory.memory_json, {}) if memory else {}
    receipt = db.scalar(select(MemorySignalReceiptRow).where(
        MemorySignalReceiptRow.signal_id == row.id,
        MemorySignalReceiptRow.viewer_user_id == viewer_user_id,
    ))
    return {
        "id": row.id,
        "memoryId": row.memory_id,
        "senderUserId": row.sender_user_id,
        "senderName": sender.display_name if sender else "Unknown traveler",
        "recipientUserId": row.recipient_user_id,
        "sourcePlanetId": row.source_planet_id,
        "targetPlanetId": row.target_planet_id,
        "memoryVersion": row.memory_version,
        "summary": document.get("summary", "A shared memory is approaching."),
        "eventTime": document.get("eventTime", memory.event_time if memory else ""),
        "active": bool(row.active),
        "visible": bool(row.active) and receipt is None,
        "seenAt": receipt.seen_at if receipt else None,
        "createdAt": row.created_at,
    }


def list_memory_signals(db: Session, owner: UserRow) -> list[dict[str, Any]]:
    rows = list(db.scalars(
        select(MemorySignalRow)
        .where(
            MemorySignalRow.recipient_user_id == owner.id,
            MemorySignalRow.active.is_(True),
        )
        .order_by(MemorySignalRow.created_at.desc())
        .limit(40)
    ))
    return [serialize_memory_signal(db, row, owner.id) for row in rows]


def mark_memory_signal_read(db: Session, owner: UserRow, signal_id: str) -> dict[str, Any]:
    row = db.get(MemorySignalRow, signal_id)
    if not row or row.recipient_user_id != owner.id or not row.active:
        raise ResourceNotFoundError("Memory signal not found.")
    share = _share_for_viewer(db, owner, row.memory_id)
    if not share:
        raise ResourceNotFoundError("Shared memory not found.")
    receipt = db.scalar(select(MemorySignalReceiptRow).where(
        MemorySignalReceiptRow.signal_id == row.id,
        MemorySignalReceiptRow.viewer_user_id == owner.id,
    ))
    if receipt is None:
        db.add(MemorySignalReceiptRow(
            id=new_id("memory-signal-receipt"),
            signal_id=row.id,
            viewer_user_id=owner.id,
        ))
        record_user_behavior(
            db,
            owner.id,
            "memory_signal_viewed",
            dedupe_key=f"memory_signal_viewed:{row.id}",
            target_user_id=row.sender_user_id,
            metadata={"memoryId": row.memory_id, "signalId": row.id},
        )
    db.flush()
    return serialize_memory_signal(db, row, owner.id)


def close_memory_signal(db: Session, owner: UserRow, signal_id: str) -> dict[str, Any]:
    row = db.get(MemorySignalRow, signal_id)
    if not row:
        raise ResourceNotFoundError("Memory signal not found.")
    if row.sender_user_id != owner.id:
        raise ResourceStateError("Only the publisher can close this signal.")
    row.active = False
    row.updated_at = datetime.now(timezone.utc)
    db.flush()
    return serialize_memory_signal(db, row, owner.id)


def accessible_memory_share(db: Session, owner: UserRow, memory_id: str) -> MemoryShareRow | None:
    return _share_for_viewer(db, owner, memory_id)
