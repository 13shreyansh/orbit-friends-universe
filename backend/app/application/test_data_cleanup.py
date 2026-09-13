from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.db import (
    ActivityPostRow,
    AgentConversationRow,
    AgentMemorySessionRow,
    AgentMemorySyncStateRow,
    AnalysisJobRow,
    GraphDocumentRow,
    GraphEdgeRow,
    GraphNodeRow,
    GraphProjectionOutboxRow,
    IntegrationOutboxRow,
    MediaAssetRow,
    MemoryRow,
    PlanetRow,
    RelationshipRow,
    SessionRow,
    SpatialSnapshotRow,
    SyntheticAccountDeletionAuditRow,
    TimelineRow,
    UserBehaviorEventRow,
    UserRow,
)
from app.schemas.ingestion import AnalysisJobDeleteRequest
from app.schemas.test_data import SyntheticAccountDeleteRequest

from .conversation import delete_conversation
from .errors import InvalidRequestError, ResourceStateError
from .ingestion import delete_ingestion_job
from .serialization import dumps, new_id


ACTIVE_JOB_STATUSES = {"created", "uploading", "queued", "processing", "awaiting_confirmation"}
ACTIVE_OUTBOX_STATUSES = {"pending", "processing", "retry", "failed", "dead_letter"}


def delete_synthetic_account(
    db: Session,
    owner: UserRow,
    body: SyntheticAccountDeleteRequest,
) -> SyntheticAccountDeletionAuditRow:
    email = owner.email.strip().lower()
    if not email.endswith("@example.test"):
        raise InvalidRequestError("Only synthetic @example.test accounts can use test-data cleanup.")
    if body.confirmation.strip().lower() != email:
        raise InvalidRequestError("Account cleanup confirmation must match the current email.")
    if db.scalar(select(func.count()).select_from(MemoryRow).where(MemoryRow.owner_user_id == owner.id)):
        raise ResourceStateError("Delete all confirmed memories before cleaning the synthetic account.")
    if db.scalar(select(func.count()).select_from(MediaAssetRow).where(MediaAssetRow.owner_user_id == owner.id)):
        raise ResourceStateError("Delete all media assets before cleaning the synthetic account.")
    if db.scalar(select(func.count()).select_from(ActivityPostRow).where(ActivityPostRow.owner_user_id == owner.id)):
        raise ResourceStateError("Delete all Activity posts before cleaning the synthetic account.")
    if db.scalar(select(func.count()).select_from(AnalysisJobRow).where(
        AnalysisJobRow.owner_user_id == owner.id,
        AnalysisJobRow.status.in_(ACTIVE_JOB_STATUSES),
    )):
        raise ResourceStateError("Cancel or reject all active analysis jobs before cleaning the synthetic account.")
    if db.scalar(select(func.count()).select_from(IntegrationOutboxRow).where(
        IntegrationOutboxRow.owner_user_id == owner.id,
        IntegrationOutboxRow.status.in_(ACTIVE_OUTBOX_STATUSES),
    )):
        raise ResourceStateError("Wait for Agent Memory outbox processing before cleaning the synthetic account.")
    if db.scalar(select(func.count()).select_from(AgentMemorySyncStateRow).where(
        AgentMemorySyncStateRow.owner_user_id == owner.id,
        AgentMemorySyncStateRow.status != "deleted",
    )):
        raise ResourceStateError("Wait for Agent Memory deletion propagation before cleaning the synthetic account.")

    jobs = list(db.scalars(select(AnalysisJobRow).where(AnalysisJobRow.owner_user_id == owner.id)))
    for job in jobs:
        delete_ingestion_job(
            db,
            owner,
            job.id,
            AnalysisJobDeleteRequest(expected_version=job.version, reason=body.reason),
        )
    conversations = list(db.scalars(select(AgentConversationRow.id).where(
        AgentConversationRow.owner_user_id == owner.id
    )))
    for conversation_id in conversations:
        delete_conversation(db, owner, conversation_id)

    now = datetime.now(timezone.utc)
    audit = SyntheticAccountDeletionAuditRow(
        id=new_id("account-deletion"),
        owner_user_id=owner.id,
        email_hash=hashlib.sha256(email.encode("utf-8")).hexdigest(),
        deleted_job_count=len(jobs),
        deleted_conversation_count=len(conversations),
        reason=body.reason,
        deleted_at=now,
    )
    db.add(audit)

    db.execute(delete(GraphProjectionOutboxRow).where(GraphProjectionOutboxRow.owner_user_id == owner.id))
    db.add(GraphProjectionOutboxRow(
        owner_user_id=owner.id,
        graph_version=f"deleted:{now.timestamp():.6f}",
        operation="delete",
        document_json="{}",
    ))
    db.execute(delete(TimelineRow).where(TimelineRow.owner_user_id == owner.id))
    db.execute(delete(RelationshipRow).where(or_(
        RelationshipRow.owner_user_id == owner.id,
        RelationshipRow.target_user_id == owner.id,
    )))
    db.execute(delete(UserBehaviorEventRow).where(or_(
        UserBehaviorEventRow.owner_user_id == owner.id,
        UserBehaviorEventRow.target_user_id == owner.id,
    )))
    db.execute(delete(SpatialSnapshotRow).where(SpatialSnapshotRow.owner_user_id == owner.id))
    db.execute(delete(GraphEdgeRow).where(GraphEdgeRow.owner_user_id == owner.id))
    db.execute(delete(GraphNodeRow).where(GraphNodeRow.owner_user_id == owner.id))
    db.execute(delete(GraphDocumentRow).where(GraphDocumentRow.owner_user_id == owner.id))
    db.execute(delete(PlanetRow).where(PlanetRow.owner_user_id == owner.id))
    db.execute(delete(SessionRow).where(SessionRow.user_id == owner.id))
    db.execute(update(AgentMemorySessionRow).where(
        AgentMemorySessionRow.owner_user_id == owner.id,
        AgentMemorySessionRow.status != "deleted",
    ).values(status="deleted", updated_at=now))

    owner.email = f"deleted+{owner.id}@example.invalid"
    owner.password_hash = "!deleted-synthetic-account!"
    owner.display_name = "Deleted synthetic account"
    owner.bio = ""
    owner.tags_json = dumps(["deleted", "synthetic"])
    owner.intake_json = "{}"
    owner.planet_id = None
    owner.deleted_at = now
    owner.updated_at = now
    db.flush()
    return audit
