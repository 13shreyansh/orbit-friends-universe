from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.application.ingestion import create_ingestion_job, list_ingestion_jobs, serialize_job
from app.db import UserRow
from app.schemas.ingestion import AnalysisJobPage, AnalysisJobView, IngestionCreateRequest

from ..dependencies import current_user, db_session


router = APIRouter()


@router.get("/api/v1/ingestion/jobs", response_model=AnalysisJobPage)
def list_jobs(
    status: str = "",
    cursor: str | None = None,
    limit: int = 20,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> AnalysisJobPage:
    statuses = {item.strip() for item in status.split(",") if item.strip()}
    items, next_cursor = list_ingestion_jobs(
        db,
        user,
        cursor=cursor,
        limit=limit,
        statuses=statuses,
    )
    return AnalysisJobPage(items=items, next_cursor=next_cursor)


@router.post("/api/v1/ingestion/jobs", response_model=AnalysisJobView, status_code=201)
def create_job(
    body: IngestionCreateRequest,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> AnalysisJobView:
    job = create_ingestion_job(db, user, body)
    request.state.job_id = job.id
    result = serialize_job(db, job)
    db.commit()
    return result
