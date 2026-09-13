from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import UserBehaviorEventRow
from app.domain.behavior_policy import behavior_rule

from .serialization import dumps, new_id


def record_user_behavior(
    db: Session,
    owner_user_id: str,
    event_type: str,
    *,
    dedupe_key: str,
    target_user_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    occurred_at: datetime | None = None,
    weight: float | None = None,
) -> UserBehaviorEventRow:
    rule = behavior_rule(event_type)
    if target_user_id and not rule.may_target_user:
        raise ValueError(f"Behavior event {event_type} cannot target another user.")
    existing = db.scalar(select(UserBehaviorEventRow).where(
        UserBehaviorEventRow.owner_user_id == owner_user_id,
        UserBehaviorEventRow.dedupe_key == dedupe_key,
    ))
    if existing:
        return existing
    row = UserBehaviorEventRow(
        id=new_id("behavior"),
        owner_user_id=owner_user_id,
        target_user_id=target_user_id,
        event_type=event_type,
        weight=rule.weight if weight is None else weight,
        dedupe_key=dedupe_key,
        metadata_json=dumps(metadata or {}),
        occurred_at=occurred_at or datetime.now(timezone.utc),
    )
    try:
        # The database constraint is the final idempotency boundary. A
        # savepoint lets concurrent retries race safely without rolling back
        # unrelated work in the enclosing request transaction.
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        existing = db.scalar(select(UserBehaviorEventRow).where(
            UserBehaviorEventRow.owner_user_id == owner_user_id,
            UserBehaviorEventRow.dedupe_key == dedupe_key,
        ))
        if existing:
            return existing
        raise
    return row

