from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.application.ingestion import (
    analyze_ingestion_job,
    cancel_ingestion_job,
    delete_ingestion_job,
    get_ingestion_job,
    serialize_draft,
    serialize_job,
)
from app.db import UserRow
from app.schemas.ingestion import (
    AnalysisJobCancelRequest,
    AnalysisJobDeleteRequest,
    AnalysisJobView,
    DeletedAnalysisJobView,
    IngestionAnalysisView,
)

from ..dependencies import current_user, db_session


router = APIRouter()


@router.get("/api/v1/jobs/{job_id}", response_model=AnalysisJobView)
def get_job(
    job_id: str,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> AnalysisJobView:
    request.state.job_id = job_id
    return serialize_job(db, get_ingestion_job(db, user, job_id))


@router.post("/api/v1/jobs/{job_id}/analyze", response_model=IngestionAnalysisView)
async def analyze_job(
    job_id: str,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> IngestionAnalysisView:
    request.state.job_id = job_id
    job, draft = await analyze_ingestion_job(
        db,
        user,
        job_id,
        request.app.state.memory_agent,
        request.app.state.agent_memory_store,
        agent_memory_recall_top_k=request.app.state.agent_memory_recall_top_k,
    )
    result = IngestionAnalysisView(
        job=serialize_job(db, job),
        draft=serialize_draft(draft) if draft else None,
    )
    db.commit()
    return result


@router.post("/api/v1/jobs/{job_id}/cancel", response_model=AnalysisJobView)
def cancel_job(
    job_id: str,
    body: AnalysisJobCancelRequest,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> AnalysisJobView:
    request.state.job_id = job_id
    result = serialize_job(db, cancel_ingestion_job(db, user, job_id, body))
    db.commit()
    return result


@router.delete("/api/v1/jobs/{job_id}", response_model=DeletedAnalysisJobView)
def delete_job(
    job_id: str,
    body: AnalysisJobDeleteRequest,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> DeletedAnalysisJobView:
    request.state.job_id = job_id
    audit = delete_ingestion_job(db, user, job_id, body)
    result = DeletedAnalysisJobView(deleted=True, job_id=job_id, audit_id=audit.id)
    db.commit()
    return result
