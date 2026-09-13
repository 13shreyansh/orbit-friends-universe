from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.db import (
    AnalysisJobRow,
    AnalysisJobDeletionAuditRow,
    AgentMessageRow,
    MemoryDraftRow,
    MemoryRow,
    MemorySourceRow,
    RelationshipRow,
    UserRow,
)
from app.domain.ingestion_state import (
    InvalidStateTransition,
    validate_draft_transition,
    validate_job_transition,
)
from app.domain.scoring import memory_evidence_key
from app.ports.analysis_provider import MemoryAnalysisProvider
from app.ports.agent_memory import AgentMemoryStore
from app.schemas.ingestion import (
    AnalysisJobCancelRequest,
    AnalysisJobDeleteRequest,
    AnalysisJobView,
    IngestionCreateRequest,
    MemoryConfirmRequest,
    MemoryDraftRejectRequest,
    MemoryDraftView,
)
from app.schemas.memory import AnalyzeMemoryRequest, MemoryObject, SaveMemoryRequest

from .errors import InvalidRequestError, ResourceConflictError, ResourceNotFoundError, ResourceStateError
from .memory import analyze_memory
from .memory_revision import persist_confirmed_memory, save_memory_compatibility, serialize_revision
from .pagination import decode_cursor, encode_cursor
from .serialization import dumps, loads, new_id
from .universe import get_cosmos


DRAFT_LIFETIME = timedelta(days=7)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _transition_job(row: AnalysisJobRow, target: str) -> None:
    try:
        validate_job_transition(row.status, target)
    except InvalidStateTransition as error:
        raise ResourceStateError(str(error)) from error
    row.status = target
    row.version += 1
    row.updated_at = _now()


def _transition_draft(row: MemoryDraftRow, target: str) -> None:
    try:
        validate_draft_transition(row.status, target)
    except InvalidStateTransition as error:
        raise ResourceStateError(str(error)) from error
    row.status = target
    row.version += 1
    row.updated_at = _now()


def _owned_job(db: Session, owner_user_id: str, job_id: str, *, lock: bool = False) -> AnalysisJobRow:
    statement = select(AnalysisJobRow).where(
        AnalysisJobRow.id == job_id,
        AnalysisJobRow.owner_user_id == owner_user_id,
    )
    if lock:
        statement = statement.with_for_update()
    row = db.scalar(statement)
    if not row:
        raise ResourceNotFoundError("Analysis job not found.")
    return row


def _owned_draft(db: Session, owner_user_id: str, draft_id: str, *, lock: bool = False) -> MemoryDraftRow:
    statement = select(MemoryDraftRow).where(
        MemoryDraftRow.id == draft_id,
        MemoryDraftRow.owner_user_id == owner_user_id,
    )
    if lock:
        statement = statement.with_for_update()
    row = db.scalar(statement)
    if not row:
        raise ResourceNotFoundError("Memory draft not found.")
    return row


def serialize_job(db: Session, row: AnalysisJobRow) -> AnalysisJobView:
    draft_id = db.scalar(
        select(MemoryDraftRow.id)
        .where(MemoryDraftRow.job_id == row.id, MemoryDraftRow.owner_user_id == row.owner_user_id)
        .order_by(MemoryDraftRow.created_at.desc())
        .limit(1)
    )
    return AnalysisJobView(
        id=row.id,
        job_type=row.job_type,
        source_type=row.source_type,
        status=row.status,
        attempt=row.attempt,
        version=row.version,
        provider=row.provider,
        input_hash=row.input_hash,
        draft_id=draft_id,
        last_error=row.last_error,
        created_at=row.created_at,
        updated_at=row.updated_at,
        completed_at=row.completed_at,
    )


def list_ingestion_jobs(
    db: Session,
    owner: UserRow,
    *,
    cursor: str | None,
    limit: int,
    statuses: set[str],
) -> tuple[list[AnalysisJobView], str | None]:
    allowed = {
        "created", "uploading", "queued", "processing", "awaiting_confirmation",
        "confirmed", "failed", "cancelled", "expired",
    }
    if limit < 1 or limit > 100:
        raise InvalidRequestError("Job page limit must be between 1 and 100.")
    if statuses - allowed:
        raise InvalidRequestError("Unsupported analysis job status filter.")
    statement = select(AnalysisJobRow).where(AnalysisJobRow.owner_user_id == owner.id)
    if statuses:
        statement = statement.where(AnalysisJobRow.status.in_(statuses))
    decoded = decode_cursor(cursor, size=2)
    if decoded:
        try:
            created_at = datetime.fromisoformat(str(decoded[0]))
        except ValueError as error:
            raise InvalidRequestError("Invalid pagination cursor.") from error
        job_id = str(decoded[1])
        statement = statement.where(
            (AnalysisJobRow.created_at < created_at)
            | ((AnalysisJobRow.created_at == created_at) & (AnalysisJobRow.id < job_id))
        )
    rows = list(db.scalars(
        statement.order_by(AnalysisJobRow.created_at.desc(), AnalysisJobRow.id.desc()).limit(limit + 1)
    ))
    page_rows = rows[:limit]
    next_cursor = None
    if len(rows) > limit and page_rows:
        last = page_rows[-1]
        next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
    return [serialize_job(db, row) for row in page_rows], next_cursor


def serialize_draft(row: MemoryDraftRow) -> MemoryDraftView:
    return MemoryDraftView(
        id=row.id,
        job_id=row.job_id,
        relationship_id=row.relationship_id,
        candidate_memory_id=row.candidate_memory_id,
        schema_version=row.schema_version,
        candidate=MemoryObject.model_validate(loads(row.candidate_json, {})),
        status=row.status,
        version=row.version,
        confirmed_memory_id=row.confirmed_memory_id,
        expires_at=row.expires_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _expire_draft_if_due(
    db: Session,
    draft: MemoryDraftRow,
    *,
    current_time: datetime | None = None,
) -> bool:
    now = current_time or _now()
    if draft.status != "awaiting_confirmation" or _aware(draft.expires_at) > now:
        return False
    _transition_draft(draft, "expired")
    job = _owned_job(db, draft.owner_user_id, draft.job_id, lock=True)
    if job.status == "awaiting_confirmation":
        _transition_job(job, "expired")
        job.completed_at = now
    db.flush()
    return True


def create_ingestion_job(
    db: Session,
    owner: UserRow,
    body: IngestionCreateRequest,
) -> AnalysisJobRow:
    if body.source_type != "text":
        raise InvalidRequestError("Only text ingestion is enabled in this release.")
    if body.relationship_id:
        relationship = db.scalar(
            select(RelationshipRow.id).where(
                RelationshipRow.id == body.relationship_id,
                RelationshipRow.owner_user_id == owner.id,
            )
        )
        if not relationship:
            raise ResourceNotFoundError("Relationship not found.")
    input_document = {
        "sourceType": body.source_type,
        "rawText": body.raw_text,
        "mediaAssetId": body.media_asset_id,
        "relationshipId": body.relationship_id,
    }
    return _create_job_record(db, owner, input_document)


def create_compatibility_ingestion_job(
    db: Session,
    owner: UserRow,
    body: AnalyzeMemoryRequest,
) -> AnalysisJobRow:
    """Persist legacy text/screenshot analysis without inventing a media asset."""

    return _create_job_record(
        db,
        owner,
        {
            "sourceType": body.source_type,
            "rawText": body.raw_text,
            "imageName": body.image_name,
            "mediaAssetId": None,
            "relationshipId": None,
        },
    )


def _create_job_record(
    db: Session,
    owner: UserRow,
    input_document: dict[str, Any],
) -> AnalysisJobRow:
    input_json = dumps(input_document)
    row = AnalysisJobRow(
        id=new_id("job"),
        owner_user_id=owner.id,
        job_type="memory_analysis",
        source_type=input_document["sourceType"],
        input_hash=hashlib.sha256(input_json.encode("utf-8")).hexdigest(),
        input_json=input_json,
    )
    db.add(row)
    db.flush()
    db.add(
        MemorySourceRow(
            id=new_id("source"),
            owner_user_id=owner.id,
            analysis_job_id=row.id,
            source_type=input_document["sourceType"],
            source_order=0,
            content_json=dumps(
                {
                    "rawText": input_document.get("rawText", ""),
                    "imageName": input_document.get("imageName"),
                }
            ),
        )
    )
    db.flush()
    return row


async def analyze_ingestion_job(
    db: Session,
    owner: UserRow,
    job_id: str,
    provider: MemoryAnalysisProvider,
    agent_memory_store: AgentMemoryStore | None = None,
    *,
    agent_memory_recall_top_k: int = 5,
) -> tuple[AnalysisJobRow, MemoryDraftRow | None]:
    job = _owned_job(db, owner.id, job_id, lock=True)
    existing_draft = db.scalar(
        select(MemoryDraftRow)
        .where(MemoryDraftRow.job_id == job.id, MemoryDraftRow.owner_user_id == owner.id)
        .order_by(MemoryDraftRow.created_at.desc())
        .limit(1)
    )
    if job.status in {"awaiting_confirmation", "confirmed"}:
        return job, existing_draft
    if job.status not in {"created", "failed"}:
        raise ResourceStateError(f"Analysis job cannot run while it is {job.status}.")
    _transition_job(job, "queued")
    _transition_job(job, "processing")
    job.attempt += 1
    job.provider = getattr(provider, "provider_name", type(provider).__name__)
    job.last_error = ""
    db.flush()

    input_document = loads(job.input_json, {})
    try:
        request = AnalyzeMemoryRequest(
            source_type=job.source_type,
            raw_text=input_document.get("rawText", ""),
            image_name=input_document.get("imageName"),
        )
        candidate = await analyze_memory(
            db,
            owner,
            request,
            provider,
            agent_memory_store,
            agent_memory_recall_top_k=agent_memory_recall_top_k,
        )
        relationship_id = input_document.get("relationshipId")
        if relationship_id:
            relationship = db.scalar(select(RelationshipRow).where(
                RelationshipRow.id == relationship_id,
                RelationshipRow.owner_user_id == owner.id,
            ))
            target = db.get(UserRow, relationship.target_user_id) if relationship else None
            if relationship and target:
                from app.schemas.memory import MemoryPersonRef

                existing = next((person for person in candidate.people if person.id == target.id), None)
                canonical = MemoryPersonRef(
                    id=target.id,
                    name=target.display_name,
                    is_existing=True,
                    relation_type=relationship.relation_type,
                    identity_label=relationship.identity_label,
                    relationship_description=relationship.description,
                )
                candidate = candidate.model_copy(update={
                    "people": [
                        canonical if existing is None else existing.model_copy(update={
                            "name": target.display_name,
                            "is_existing": True,
                            "relation_type": existing.relation_type or relationship.relation_type,
                            "identity_label": existing.identity_label or relationship.identity_label,
                            "relationship_description": (
                                existing.relationship_description or relationship.description
                            ),
                        }),
                        *(person for person in candidate.people if person.id != target.id),
                    ],
                })
    except Exception as error:
        _transition_job(job, "failed")
        job.last_error = str(error)[:2000]
        db.flush()
        return job, None
    draft = MemoryDraftRow(
        id=new_id("draft"),
        owner_user_id=owner.id,
        job_id=job.id,
        relationship_id=input_document.get("relationshipId"),
        candidate_memory_id=candidate.id,
        candidate_json=dumps(candidate),
        status="awaiting_confirmation",
        expires_at=_now() + DRAFT_LIFETIME,
    )
    db.add(draft)
    db.flush()
    db.execute(
        update(MemorySourceRow)
        .where(MemorySourceRow.analysis_job_id == job.id)
        .values(draft_id=draft.id)
    )
    _transition_job(job, "awaiting_confirmation")
    db.flush()
    return job, draft


def get_ingestion_job(db: Session, owner: UserRow, job_id: str) -> AnalysisJobRow:
    job = _owned_job(db, owner.id, job_id, lock=True)
    if job.status == "awaiting_confirmation":
        draft = db.scalar(
            select(MemoryDraftRow)
            .where(MemoryDraftRow.job_id == job.id, MemoryDraftRow.owner_user_id == owner.id)
            .order_by(MemoryDraftRow.created_at.desc())
            .limit(1)
        )
        if draft:
            _expire_draft_if_due(db, draft)
    return job


def get_memory_draft(db: Session, owner: UserRow, draft_id: str) -> MemoryDraftRow:
    draft = _owned_draft(db, owner.id, draft_id, lock=True)
    _expire_draft_if_due(db, draft)
    return draft


def reject_memory_draft(
    db: Session,
    owner: UserRow,
    draft_id: str,
    body: MemoryDraftRejectRequest,
) -> MemoryDraftRow:
    draft = _owned_draft(db, owner.id, draft_id, lock=True)
    _expire_draft_if_due(db, draft)
    if draft.status != "awaiting_confirmation":
        raise ResourceStateError(f"Memory draft cannot be rejected while it is {draft.status}.")
    if draft.version != body.expected_version:
        raise ResourceConflictError(
            f"Memory draft changed: expected {body.expected_version}, current {draft.version}."
        )
    _transition_draft(draft, "rejected")
    job = _owned_job(db, owner.id, draft.job_id, lock=True)
    if job.status != "awaiting_confirmation":
        raise ResourceStateError(f"Analysis job cannot be cancelled while it is {job.status}.")
    _transition_job(job, "cancelled")
    job.completed_at = _now()
    db.flush()
    return draft


def cancel_ingestion_job(
    db: Session,
    owner: UserRow,
    job_id: str,
    body: AnalysisJobCancelRequest,
) -> AnalysisJobRow:
    job = _owned_job(db, owner.id, job_id, lock=True)
    if job.version != body.expected_version:
        raise ResourceConflictError(
            f"Analysis job changed: expected {body.expected_version}, current {job.version}."
        )
    if job.status not in {"created", "uploading", "queued", "processing", "awaiting_confirmation", "failed"}:
        raise ResourceStateError(f"Analysis job cannot be cancelled while it is {job.status}.")
    if job.status == "awaiting_confirmation":
        draft = db.scalar(
            select(MemoryDraftRow)
            .where(MemoryDraftRow.job_id == job.id, MemoryDraftRow.owner_user_id == owner.id)
            .order_by(MemoryDraftRow.created_at.desc())
            .limit(1)
        )
        if draft and draft.status == "awaiting_confirmation":
            _transition_draft(draft, "rejected")
    _transition_job(job, "cancelled")
    job.completed_at = _now()
    db.flush()
    return job


def delete_ingestion_job(
    db: Session,
    owner: UserRow,
    job_id: str,
    body: AnalysisJobDeleteRequest,
) -> AnalysisJobDeletionAuditRow:
    job = _owned_job(db, owner.id, job_id, lock=True)
    if job.version != body.expected_version:
        raise ResourceConflictError(
            f"Analysis job changed: expected {body.expected_version}, current {job.version}."
        )
    if job.status not in {"confirmed", "failed", "cancelled", "expired"}:
        raise ResourceStateError(f"Analysis job cannot be deleted while it is {job.status}.")

    drafts = list(db.scalars(select(MemoryDraftRow).where(
        MemoryDraftRow.job_id == job.id,
        MemoryDraftRow.owner_user_id == owner.id,
    )))
    draft_ids = [draft.id for draft in drafts]
    linked_memory = db.scalar(
        select(MemorySourceRow.memory_id)
        .where(
            MemorySourceRow.owner_user_id == owner.id,
            or_(
                MemorySourceRow.analysis_job_id == job.id,
                MemorySourceRow.draft_id.in_(draft_ids) if draft_ids else False,
            ),
            MemorySourceRow.memory_id.is_not(None),
        )
        .limit(1)
    )
    if linked_memory or any(draft.confirmed_memory_id for draft in drafts):
        raise ResourceStateError("Delete the confirmed memory before deleting its analysis job.")

    audit = AnalysisJobDeletionAuditRow(
        id=new_id("job-deletion"),
        owner_user_id=owner.id,
        job_id=job.id,
        prior_status=job.status,
        input_hash=job.input_hash,
        reason=body.reason,
    )
    db.add(audit)
    db.flush()
    if draft_ids:
        db.execute(
            update(AgentMessageRow)
            .where(AgentMessageRow.owner_user_id == owner.id, AgentMessageRow.memory_draft_id.in_(draft_ids))
            .values(memory_draft_id=None)
        )
    source_scope = [MemorySourceRow.analysis_job_id == job.id]
    if draft_ids:
        source_scope.append(MemorySourceRow.draft_id.in_(draft_ids))
    db.execute(delete(MemorySourceRow).where(
        MemorySourceRow.owner_user_id == owner.id,
        or_(*source_scope),
    ))
    db.execute(delete(MemoryDraftRow).where(
        MemoryDraftRow.owner_user_id == owner.id,
        MemoryDraftRow.job_id == job.id,
    ))
    db.delete(job)
    db.flush()
    return audit


def confirm_memory_draft(
    db: Session,
    owner: UserRow,
    draft_id: str,
    body: MemoryConfirmRequest,
) -> dict[str, Any]:
    draft = _owned_draft(db, owner.id, draft_id, lock=True)
    if draft.status != "awaiting_confirmation":
        raise ResourceStateError(f"Memory draft cannot be confirmed while it is {draft.status}.")
    if _aware(draft.expires_at) <= _now():
        raise ResourceStateError("Memory draft has expired.")
    if draft.version != body.expected_version:
        raise ResourceConflictError(
            f"Memory draft changed: expected {body.expected_version}, current {draft.version}."
        )
    candidate = body.memory or MemoryObject.model_validate(loads(draft.candidate_json, {}))
    if candidate.id != draft.candidate_memory_id:
        raise ResourceConflictError("The candidate memory id cannot be changed.")
    relationship_id = (
        body.relationship_id if "relationship_id" in body.model_fields_set else draft.relationship_id
    )
    revision = persist_confirmed_memory(
        db,
        owner,
        candidate,
        relationship_id=relationship_id,
        reason=body.reason,
        allow_existing=False,
    )
    draft.candidate_json = dumps(candidate)
    draft.relationship_id = relationship_id
    draft.confirmed_memory_id = candidate.id
    _transition_draft(draft, "confirmed")
    job = _owned_job(db, owner.id, draft.job_id, lock=True)
    if job.status != "awaiting_confirmation":
        raise ResourceStateError(f"Analysis job cannot be confirmed while it is {job.status}.")
    _transition_job(job, "confirmed")
    job.completed_at = _now()
    db.execute(
        update(MemorySourceRow)
        .where(MemorySourceRow.draft_id == draft.id, MemorySourceRow.owner_user_id == owner.id)
        .values(memory_id=candidate.id)
    )
    db.flush()
    return {
        "memory": candidate,
        "revision": serialize_revision(revision),
        "cosmos": get_cosmos(db, owner),
    }


def confirm_legacy_memory(
    db: Session,
    owner: UserRow,
    body: SaveMemoryRequest,
) -> dict[str, Any]:
    existing_memory = db.scalar(
        select(MemoryRow.id).where(MemoryRow.id == body.memory.id, MemoryRow.owner_user_id == owner.id)
    )
    if existing_memory:
        return save_memory_compatibility(db, owner, body)
    evidence_key = memory_evidence_key(body.memory)
    for row in db.scalars(select(MemoryRow).where(MemoryRow.owner_user_id == owner.id)):
        try:
            stored = MemoryObject.model_validate(loads(row.memory_json, {}))
        except (TypeError, ValueError):
            continue
        if memory_evidence_key(stored) == evidence_key:
            return {
                "memory": stored.model_dump(mode="json", by_alias=True),
                "cosmos": get_cosmos(db, owner),
            }
    draft = db.scalar(
        select(MemoryDraftRow)
        .where(
            MemoryDraftRow.owner_user_id == owner.id,
            MemoryDraftRow.candidate_memory_id == body.memory.id,
            MemoryDraftRow.status == "awaiting_confirmation",
        )
        .order_by(MemoryDraftRow.created_at.desc())
        .limit(1)
    )
    if not draft:
        create_body = IngestionCreateRequest(
            source_type="text",
            raw_text=body.memory.raw_text or body.memory.summary,
            relationship_id=body.relationship_id,
        )
        job = create_ingestion_job(db, owner, create_body)
        _transition_job(job, "queued")
        _transition_job(job, "processing")
        job.provider = body.memory.analysis_provider or "compatibility-api"
        draft = MemoryDraftRow(
            id=new_id("draft"),
            owner_user_id=owner.id,
            job_id=job.id,
            relationship_id=body.relationship_id,
            candidate_memory_id=body.memory.id,
            candidate_json=dumps(body.memory),
            status="awaiting_confirmation",
            expires_at=_now() + DRAFT_LIFETIME,
        )
        db.add(draft)
        db.flush()
        db.execute(
            update(MemorySourceRow)
            .where(MemorySourceRow.analysis_job_id == job.id)
            .values(draft_id=draft.id)
        )
        _transition_job(job, "awaiting_confirmation")
        db.flush()
    result = confirm_memory_draft(
        db,
        owner,
        draft.id,
        MemoryConfirmRequest(
            expected_version=draft.version,
            memory=body.memory,
            relationship_id=body.relationship_id,
            reason="compatibility_api",
        ),
    )
    return {
        "memory": result["memory"].model_dump(mode="json", by_alias=True),
        "cosmos": result["cosmos"],
    }
