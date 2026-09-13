from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.application.ingestion import (
    confirm_memory_draft,
    get_memory_draft,
    reject_memory_draft,
    serialize_draft,
)
from app.application.memory_revision import (
    delete_confirmed_memory,
    get_confirmed_memory_detail,
    list_memory_revisions,
    revise_confirmed_memory,
)
from app.application.memory_query import list_confirmed_memories
from app.db import UserRow
from app.schemas.ingestion import (
    ConfirmedMemoryView,
    ConfirmedMemoryPage,
    ConfirmedMemoryDetailView,
    DeletedMemoryView,
    MemoryConfirmRequest,
    MemoryDraftView,
    MemoryDraftRejectRequest,
    MemoryRevisionRequest,
    MemoryRevisionView,
)

from ..dependencies import current_user, db_session


router = APIRouter()


@router.get("/api/v1/memories", response_model=ConfirmedMemoryPage)
def memory_list(
    cursor: str | None = None,
    limit: int = 20,
    relationship_id: Annotated[str | None, Query(alias="relationshipId")] = None,
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    query: str | None = None,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> ConfirmedMemoryPage:
    return list_confirmed_memories(
        db,
        user,
        cursor=cursor,
        limit=limit,
        relationship_id=relationship_id,
        from_date=from_date,
        to_date=to_date,
        query=query,
    )


@router.get("/api/v1/memory-drafts/{draft_id}", response_model=MemoryDraftView)
def get_draft(
    draft_id: str,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> MemoryDraftView:
    return serialize_draft(get_memory_draft(db, user, draft_id))


@router.post(
    "/api/v1/memory-drafts/{draft_id}/confirm",
    response_model=ConfirmedMemoryView,
    status_code=201,
)
def confirm_draft(
    draft_id: str,
    body: MemoryConfirmRequest,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict:
    result = confirm_memory_draft(db, user, draft_id, body)
    db.commit()
    return result


@router.post("/api/v1/memory-drafts/{draft_id}/reject", response_model=MemoryDraftView)
def reject_draft(
    draft_id: str,
    body: MemoryDraftRejectRequest,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> MemoryDraftView:
    result = serialize_draft(reject_memory_draft(db, user, draft_id, body))
    db.commit()
    return result


@router.get("/api/v1/memories/{memory_id}", response_model=ConfirmedMemoryDetailView)
def memory_detail(
    memory_id: str,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> ConfirmedMemoryDetailView:
    return get_confirmed_memory_detail(db, user, memory_id)


@router.patch("/api/v1/memories/{memory_id}", response_model=ConfirmedMemoryView)
def revise_memory(
    memory_id: str,
    body: MemoryRevisionRequest,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict:
    result = revise_confirmed_memory(db, user, memory_id, body)
    db.commit()
    return result


@router.delete("/api/v1/memories/{memory_id}", response_model=DeletedMemoryView)
def delete_memory(
    memory_id: str,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict:
    result = delete_confirmed_memory(db, user, memory_id)
    db.commit()
    return result


@router.get("/api/v1/memories/{memory_id}/revisions", response_model=list[MemoryRevisionView])
def memory_revisions(
    memory_id: str,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> list[MemoryRevisionView]:
    return list_memory_revisions(db, user, memory_id)
