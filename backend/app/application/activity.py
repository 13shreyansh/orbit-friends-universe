from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import (
    ActivityBroadcastReceiptRow,
    ActivityPostRow,
    IntegrationOutboxRow,
    NebulaMemberRow,
    PlanetRow,
    RelationshipRow,
    UserRow,
)
from app.ports.ecosystem_generation import EcosystemGenerationInput, EcosystemGenerator
from app.ports.media_storage import MediaStorage
from app.schemas.activity import ActivityCreateRequest, ActivityMedia, EcosystemEffect

from .behavior import record_user_behavior
from .errors import MediaTooLargeError, ResourceNotFoundError, ResourceStateError, UnsupportedMediaError
from .serialization import content_dedupe_key, dumps, loads, new_id


MEDIA_RULES = {
    "image": {
        "limit": 12 * 1024 * 1024,
        "extensions": {".jpg", ".jpeg", ".png", ".webp", ".gif"},
    },
    "audio": {
        "limit": 20 * 1024 * 1024,
        "extensions": {".mp3", ".wav", ".m4a", ".ogg", ".webm", ".aac"},
    },
    "video": {
        "limit": 80 * 1024 * 1024,
        "extensions": {".mp4", ".webm", ".mov", ".m4v"},
    },
}

ACTIVITY_ANALYSIS_DESTINATION = "activity_analysis"


def store_activity_media(
    *,
    filename: str,
    content_type: str,
    content: bytes,
    storage: MediaStorage,
) -> ActivityMedia:
    normalized_content_type = content_type.lower()
    if normalized_content_type.startswith("image/"):
        media_type = "image"
    elif normalized_content_type.startswith("audio/"):
        media_type = "audio"
    elif normalized_content_type.startswith("video/"):
        media_type = "video"
    else:
        raise UnsupportedMediaError("Only image, audio, and video files can become planet signals.")
    rule = MEDIA_RULES[media_type]
    if len(content) > rule["limit"]:
        raise MediaTooLargeError(f"{media_type.title()} file is too large.")
    original_name = Path(filename or f"upload-{media_type}").name[:260]
    extension = Path(original_name).suffix.lower()
    if extension not in rule["extensions"]:
        extension = ".webm" if media_type in {"audio", "video"} else ".bin"
    stored_name = f"{new_id('media')}{extension}"
    url = storage.save(object_name=stored_name, content=content)
    return ActivityMedia(
        type=media_type,
        url=url,
        mime_type=normalized_content_type,
        name=original_name,
        size=len(content),
    )


def serialize_activity(db: Session, row: ActivityPostRow, viewer_user_id: str | None = None) -> dict[str, Any]:
    author = db.get(UserRow, row.owner_user_id)
    content = loads(row.content_json, {})
    receipt = None
    if viewer_user_id and viewer_user_id != row.owner_user_id:
        receipt = db.scalar(select(ActivityBroadcastReceiptRow).where(
            ActivityBroadcastReceiptRow.activity_id == row.id,
            ActivityBroadcastReceiptRow.viewer_user_id == viewer_user_id,
        ))
    can_close = viewer_user_id == row.owner_user_id
    signal_active = bool(row.signal_active)
    return {
        "id": row.id,
        "authorUserId": row.owner_user_id,
        "authorName": author.display_name if author else "Unknown traveler",
        "planetId": row.planet_id,
        "kind": content.get("kind", "life-update"),
        "title": content.get("title", "Untitled signal"),
        "text": content.get("text", ""),
        "eventName": content.get("eventName", ""),
        "location": content.get("location", ""),
        "tags": content.get("tags", []),
        "analysisStatus": content.get("analysisStatus", "completed"),
        "visibility": row.visibility,
        "media": loads(row.media_json, []),
        "ecosystemEffect": EcosystemEffect.model_validate(
            loads(row.ecosystem_json, {})
        ).model_dump(mode="json", by_alias=True),
        "publishedAt": row.published_at,
        "broadcast": {
            "active": signal_active,
            "visible": signal_active and (can_close or receipt is None),
            "canClose": can_close,
            "seenAt": receipt.seen_at if receipt else None,
        },
    }


def visible_activities(
    db: Session,
    owner: UserRow,
    relationships: list[RelationshipRow],
) -> list[dict[str, Any]]:
    visible_owner_ids = {owner.id, *(relationship.target_user_id for relationship in relationships)}
    rows = list(db.scalars(
        select(ActivityPostRow)
        .where(or_(
            ActivityPostRow.owner_user_id.in_(visible_owner_ids),
            ActivityPostRow.visibility == "public",
        ))
        .order_by(ActivityPostRow.published_at.desc())
        .limit(80)
    ))
    return [serialize_activity(db, row, owner.id) for row in rows]


def mark_activity_broadcast_read(
    db: Session,
    user: UserRow,
    activity_id: str,
    semantic_similarity: Any,
) -> dict[str, Any]:
    row = db.get(ActivityPostRow, activity_id)
    if not row:
        raise ResourceNotFoundError("Activity broadcast not found.")
    if row.owner_user_id != user.id:
        shared_nebula = db.scalar(select(NebulaMemberRow.id).where(
            NebulaMemberRow.user_id == row.owner_user_id,
            NebulaMemberRow.nebula_id.in_(
                select(NebulaMemberRow.nebula_id).where(NebulaMemberRow.user_id == user.id)
            ),
        )) is not None
        allowed = row.visibility == "public" or shared_nebula or db.scalar(select(RelationshipRow.id).where(
            RelationshipRow.owner_user_id == user.id,
            RelationshipRow.target_user_id == row.owner_user_id,
        )) is not None
        if not allowed:
            raise ResourceNotFoundError("Activity broadcast not found.")
        receipt = db.scalar(select(ActivityBroadcastReceiptRow).where(
            ActivityBroadcastReceiptRow.activity_id == activity_id,
            ActivityBroadcastReceiptRow.viewer_user_id == user.id,
        ))
        if receipt is None:
            db.add(ActivityBroadcastReceiptRow(
                id=new_id("broadcast-receipt"),
                activity_id=activity_id,
                viewer_user_id=user.id,
            ))
        viewed = record_user_behavior(
            db,
            user.id,
            "activity_viewed",
            dedupe_key=f"activity_viewed:{activity_id}:{datetime.now(timezone.utc).date().isoformat()}",
            target_user_id=row.owner_user_id,
            metadata={"activityId": activity_id, "planetId": row.planet_id},
        )
        db.flush()
        from .universe import get_cosmos

        return {
            "activity": serialize_activity(db, row, user.id),
            "cosmos": get_cosmos(db, user, semantic_similarity=semantic_similarity),
            "event": {
                "id": viewed.id,
                "eventType": viewed.event_type,
                "targetUserId": viewed.target_user_id,
                "occurredAt": viewed.occurred_at,
            },
        }
    return {"activity": serialize_activity(db, row, user.id), "cosmos": None, "event": None}


def close_activity_broadcast(db: Session, user: UserRow, activity_id: str) -> dict[str, Any]:
    row = db.get(ActivityPostRow, activity_id)
    if not row:
        raise ResourceNotFoundError("Activity broadcast not found.")
    if row.owner_user_id != user.id:
        raise ResourceStateError("Only the publisher can close this broadcast.")
    row.signal_active = False
    row.updated_at = datetime.now(timezone.utc)
    db.flush()
    return serialize_activity(db, row, user.id)


def _enqueue_activity_analysis(db: Session, row: ActivityPostRow) -> IntegrationOutboxRow:
    dedupe_key = f"activity:{row.id}:analysis:v1"
    existing = db.scalar(select(IntegrationOutboxRow).where(
        IntegrationOutboxRow.destination == ACTIVITY_ANALYSIS_DESTINATION,
        IntegrationOutboxRow.dedupe_key == dedupe_key,
    ))
    if existing:
        return existing
    event = IntegrationOutboxRow(
        owner_user_id=row.owner_user_id,
        destination=ACTIVITY_ANALYSIS_DESTINATION,
        aggregate_type="activity",
        aggregate_id=row.id,
        aggregate_version=1,
        event_type="activity.analysis.requested",
        dedupe_key=dedupe_key,
        payload_json=dumps({"activityId": row.id}),
    )
    db.add(event)
    return event


def create_activity(
    db: Session,
    user: UserRow,
    body: ActivityCreateRequest,
    ecosystem_generator: EcosystemGenerator,
) -> dict[str, Any]:
    planet = db.scalar(select(PlanetRow).where(PlanetRow.owner_user_id == user.id))
    if not planet:
        raise ResourceStateError("Create your planet before publishing a signal.")
    activity_id = new_id("activity")
    effect = body.ecosystem_effect or ecosystem_generator.generate(EcosystemGenerationInput(
        owner_user_id=user.id,
        activity_id=activity_id,
        title=body.title,
        text=body.text,
        tags=tuple(body.tags),
        media_types=tuple(media.type for media in body.media),
    ))
    content = {
        "kind": body.kind,
        "title": body.title,
        "text": body.text,
        "eventName": body.event_name,
        "location": body.location,
        "tags": body.tags,
        # AI enrichment is deliberately backend-only and asynchronous. The
        # authored post is complete and visible before this state changes.
        "analysisStatus": "queued",
    }
    row = ActivityPostRow(
        id=activity_id,
        owner_user_id=user.id,
        planet_id=planet.id,
        content_json=dumps(content),
        media_json=dumps([media.model_dump(mode="json", by_alias=True) for media in body.media]),
        ecosystem_json=dumps(effect),
        visibility=body.visibility,
        published_at=datetime.now(timezone.utc),
    )
    db.add(row)
    record_user_behavior(
        db,
        user.id,
        "activity_published",
        dedupe_key=content_dedupe_key(f"activity:{activity_id}", content),
        metadata={"activityId": activity_id, "kind": body.kind},
    )
    db.flush()
    _enqueue_activity_analysis(db, row)
    db.flush()
    return {
        "activity": serialize_activity(db, row, user.id),
        "analysis": {"status": "queued"},
    }


async def analyze_activity_in_background(
    db: Session,
    row: ActivityPostRow,
    user: UserRow,
    memory_agent: Any,
) -> str:
    """Enrich one durable activity without participating in its request path."""

    from app.schemas.memory import AnalyzeMemoryRequest, MemoryPersonRef
    from .memory import analyze_memory

    content = loads(row.content_json, {})
    media = [ActivityMedia.model_validate(item) for item in loads(row.media_json, [])]
    authored_text = "\n".join(value for value in (
        str(content.get("title") or "").strip(),
        str(content.get("text") or "").strip(),
        str(content.get("eventName") or "").strip(),
        str(content.get("location") or "").strip(),
        " ".join(str(tag) for tag in content.get("tags", [])),
    ) if value).strip()
    if not authored_text:
        # The generic memory model cannot inspect local audio/video bytes and
        # must not invent a story from a filename. The original media remains
        # durable on the activity for a future modality-specific processor.
        content["analysisStatus"] = "completed"
        content["analysisSkipped"] = "media_only_without_text"
        row.content_json = dumps(content)
        row.updated_at = datetime.now(timezone.utc)
        db.flush()
        return ""
    primary_image = next((item for item in media if item.type == "image"), None)
    memory = await analyze_memory(
        db,
        user,
        AnalyzeMemoryRequest(
            source_type="text",
            raw_text=authored_text,
            image_name=primary_image.name if primary_image else None,
            image_url=primary_image.url if primary_image else None,
        ),
        memory_agent,
    )

    relationships = list(db.scalars(select(RelationshipRow).where(RelationshipRow.owner_user_id == user.id)))
    linked_targets: list[tuple[RelationshipRow, UserRow]] = []
    normalized_text = authored_text.casefold()
    for relationship in relationships:
        target = db.get(UserRow, relationship.target_user_id)
        if not target:
            continue
        name_matched = target.display_name.casefold() in normalized_text
        if not name_matched:
            continue
        linked_targets.append((relationship, target))
    # AI may suggest entities, but an automatic activity analysis is allowed
    # to bind only people explicitly named by the author. This prevents a
    # malformed or over-eager model response from changing social distance.
    explicitly_named_ids = {target.id for _, target in linked_targets}
    memory.people = [person for person in memory.people if person.id in explicitly_named_ids]
    for relationship, target in linked_targets:
        if not any(person.id == target.id for person in memory.people):
            memory.people.append(MemoryPersonRef(
                id=target.id,
                name=target.display_name,
                is_existing=True,
                relation_type=relationship.relation_type,
                identity_label=relationship.identity_label,
                relationship_description=relationship.description,
            ))

    from .memory_revision import persist_confirmed_memory

    persist_confirmed_memory(
        db,
        user,
        memory,
        relationship_id=None,
        reason="activity_published",
        allow_existing=False,
        # The activity_mentioned evidence below is the single targeted
        # behavior contribution. The confirmed memory still receives a
        # revision, timelines and an Agent Memory outbox event.
        record_behavior=False,
    )
    for relationship, target in linked_targets:
        record_user_behavior(
            db,
            user.id,
            "activity_mentioned",
            dedupe_key=f"activity_mentioned:{row.id}:{target.id}",
            target_user_id=target.id,
            metadata={"activityId": row.id, "relationshipId": relationship.id},
        )
    content["analysisStatus"] = "completed"
    content["analysisMemoryId"] = memory.id
    row.content_json = dumps(content)
    row.updated_at = datetime.now(timezone.utc)
    db.flush()
    return memory.id
