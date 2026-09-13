from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.db import AgentMemorySyncStateRow, MemoryRevisionRow, MemoryRow, MemoryShareRow, UserRow
from app.schemas.ingestion import (
    ConfirmedMemoryPage,
    ConfirmedMemorySummaryView,
)
from app.schemas.memory import MemoryObject

from .errors import InvalidRequestError
from .pagination import decode_cursor, encode_cursor
from .serialization import loads


def list_confirmed_memories(
    db: Session,
    owner: UserRow,
    *,
    cursor: str | None,
    limit: int,
    relationship_id: str | None,
    from_date: date | None,
    to_date: date | None,
    query: str | None,
) -> ConfirmedMemoryPage:
    if limit < 1 or limit > 100:
        raise InvalidRequestError("Memory page limit must be between 1 and 100.")
    shared_statement = select(MemoryShareRow).where(
        MemoryShareRow.recipient_user_id == owner.id,
        MemoryShareRow.status == "active",
    )
    statement = select(MemoryRow).where(or_(
        MemoryRow.owner_user_id == owner.id,
        MemoryRow.id.in_(select(MemoryShareRow.memory_id).where(
            MemoryShareRow.recipient_user_id == owner.id,
            MemoryShareRow.status == "active",
        )),
    ))
    if relationship_id:
        statement = statement.where(or_(
            MemoryRow.relationship_id == relationship_id,
            MemoryRow.id.in_(select(MemoryShareRow.memory_id).where(
                MemoryShareRow.recipient_user_id == owner.id,
                MemoryShareRow.recipient_relationship_id == relationship_id,
                MemoryShareRow.status == "active",
            )),
        ))
    if from_date:
        statement = statement.where(MemoryRow.event_time >= from_date.isoformat())
    if to_date:
        statement = statement.where(MemoryRow.event_time <= to_date.isoformat())
    normalized_query = (query or "").strip()
    if normalized_query:
        statement = statement.where(MemoryRow.memory_json.contains(normalized_query))
    decoded = decode_cursor(cursor, size=3)
    if decoded:
        event_time, created_raw, memory_id = decoded
        try:
            created_at = datetime.fromisoformat(str(created_raw))
        except ValueError as error:
            raise InvalidRequestError("Invalid pagination cursor.") from error
        statement = statement.where(or_(
            MemoryRow.event_time < str(event_time),
            and_(MemoryRow.event_time == str(event_time), MemoryRow.created_at < created_at),
            and_(
                MemoryRow.event_time == str(event_time),
                MemoryRow.created_at == created_at,
                MemoryRow.id < str(memory_id),
            ),
        ))
    rows = list(db.scalars(
        statement.order_by(MemoryRow.event_time.desc(), MemoryRow.created_at.desc(), MemoryRow.id.desc())
        .limit(limit + 1)
    ))
    page_rows = rows[:limit]
    share_rows = list(db.scalars(shared_statement.where(MemoryShareRow.memory_id.in_([row.id for row in page_rows])))) if page_rows else []
    shares_by_memory = {row.memory_id: row for row in share_rows}
    memory_ids = [row.id for row in page_rows]
    versions = {
        memory_id: int(version)
        for memory_id, version in db.execute(
            select(MemoryRevisionRow.memory_id, func.max(MemoryRevisionRow.version))
            .where(MemoryRevisionRow.memory_id.in_(memory_ids))
            .group_by(MemoryRevisionRow.memory_id)
        ).all()
    } if memory_ids else {}
    sync_rows = list(db.scalars(
        select(AgentMemorySyncStateRow)
        .where(
            AgentMemorySyncStateRow.owner_user_id == owner.id,
            AgentMemorySyncStateRow.object_key.in_(memory_ids),
        )
        .order_by(AgentMemorySyncStateRow.updated_at.desc())
    )) if memory_ids else []
    sync_status: dict[str, str] = {}
    for row in sync_rows:
        sync_status.setdefault(row.object_key, row.status)
    items = []
    for row in page_rows:
        memory = MemoryObject.model_validate(loads(row.memory_json, {}))
        share = shares_by_memory.get(row.id)
        sender = db.get(UserRow, row.owner_user_id) if share else None
        items.append(ConfirmedMemorySummaryView(
            id=row.id,
            summary=memory.summary,
            event_time=memory.event_time,
            location=memory.location,
            event_type=memory.event_type,
            people=[person.model_dump(mode="json", by_alias=True) for person in memory.people],
            relationship_id=share.recipient_relationship_id if share else row.relationship_id,
            current_version=int(versions.get(row.id, 0)),
            sync_status=sync_status.get(row.id, "pending"),
            created_at=row.created_at,
            updated_at=row.updated_at,
            shared=share is not None,
            shared_by_user_id=share.owner_user_id if share else None,
            shared_by_name=sender.display_name if sender else None,
        ))
    next_cursor = None
    if len(rows) > limit and page_rows:
        last = page_rows[-1]
        next_cursor = encode_cursor(last.event_time, last.created_at.isoformat(), last.id)
    return ConfirmedMemoryPage(items=items, next_cursor=next_cursor)
