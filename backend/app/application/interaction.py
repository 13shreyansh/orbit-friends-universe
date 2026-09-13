from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.db import PlanetRow, UserRow
from app.schemas.interaction import PlanetInteractionRequest
from app.ports.semantic_similarity import SemanticSimilarity

from .behavior import record_user_behavior
from .errors import ResourceNotFoundError, ResourceStateError
from .universe import get_cosmos


PLANET_INTERACTION_EVENTS = {
    "view": "planet_viewed",
    "visit": "planet_visited",
}


def record_planet_interaction(
    db: Session,
    viewer: UserRow,
    planet_id: str,
    body: PlanetInteractionRequest,
    semantic_similarity: SemanticSimilarity,
) -> dict[str, Any]:
    """Persist an objective, rate-limited interaction with another planet.

    The UTC-day bucket makes retries idempotent and prevents repeated clicks
    from manufacturing relationship strength. Hourly simulation ticks still
    decay and recompute this durable evidence.
    """
    planet = db.get(PlanetRow, planet_id)
    if not planet:
        raise ResourceNotFoundError("Planet not found.")
    if planet.owner_user_id == viewer.id:
        raise ResourceStateError("Interactions with your own planet are not relationship evidence.")
    target = db.get(UserRow, planet.owner_user_id)
    if not target:
        raise ResourceNotFoundError("Planet owner not found.")

    occurred_at = datetime.now(timezone.utc)
    event_type = PLANET_INTERACTION_EVENTS[body.kind]
    day_bucket = occurred_at.date().isoformat()
    event = record_user_behavior(
        db,
        viewer.id,
        event_type,
        dedupe_key=f"{event_type}:{target.id}:{day_bucket}",
        target_user_id=target.id,
        metadata={"planetId": planet.id, "targetUserId": target.id, "bucket": day_bucket},
        occurred_at=occurred_at,
    )
    db.flush()
    return {
        "event": {
            "id": event.id,
            "eventType": event.event_type,
            "targetUserId": event.target_user_id,
            "occurredAt": event.occurred_at,
        },
        "cosmos": get_cosmos(db, viewer, semantic_similarity=semantic_similarity),
    }
