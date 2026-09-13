from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import RelationshipRow, UserRow
from app.schemas.relationship import RelationshipRequest
from app.ports.semantic_similarity import SemanticSimilarity

from .behavior import record_user_behavior
from .errors import InvalidRequestError
from .serialization import content_dedupe_key, dumps, new_id
from .universe import get_cosmos


def upsert_relationship(
    db: Session,
    owner: UserRow,
    body: RelationshipRequest,
    semantic_similarity: SemanticSimilarity | None = None,
) -> dict[str, Any]:
    if body.target_user_id == owner.id or not db.get(UserRow, body.target_user_id):
        raise InvalidRequestError("A valid target user is required.")
    row = db.scalar(select(RelationshipRow).where(
        RelationshipRow.owner_user_id == owner.id,
        RelationshipRow.target_user_id == body.target_user_id,
    ))
    created = row is None
    if created:
        row = RelationshipRow(
            id=new_id("relationship"),
            owner_user_id=owner.id,
            target_user_id=body.target_user_id,
        )
        db.add(row)
    row.relation_type = body.relation_type
    row.identity_label = body.identity_label
    row.description = body.description
    row.signals_json = dumps({})
    row.status = body.status
    row.started_at = body.started_at
    row.updated_at = datetime.now(timezone.utc)
    db.flush()
    record_user_behavior(
        db,
        owner.id,
        "relationship_created" if created else "relationship_updated",
        dedupe_key=content_dedupe_key(
            f"relationship:{row.id}",
            body.model_dump(mode="json", by_alias=True),
        ),
        target_user_id=body.target_user_id,
        metadata={"relationshipId": row.id},
    )
    return get_cosmos(
        db,
        owner,
        semantic_similarity=semantic_similarity,
    )
