from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlalchemy.orm import Session

from app.application.activity import (
    close_activity_broadcast,
    create_activity,
    mark_activity_broadcast_read,
    store_activity_media,
)
from app.db import UserRow
from app.schemas.activity import ActivityCreateRequest, ActivityMedia

from ..dependencies import current_user, db_session


router = APIRouter()
MAX_ACTIVITY_MEDIA_BYTES = 80 * 1024 * 1024


@router.post("/api/activity-media", response_model=ActivityMedia, status_code=201)
async def upload_activity_media(
    request: Request,
    file: UploadFile = File(...),
    _user: UserRow = Depends(current_user),
) -> ActivityMedia:
    content = await file.read(MAX_ACTIVITY_MEDIA_BYTES + 1)
    return store_activity_media(
        filename=file.filename or "upload",
        content_type=file.content_type or "",
        content=content,
        storage=request.app.state.media_storage,
    )


@router.post("/api/memory-media", response_model=ActivityMedia, status_code=201)
async def upload_memory_media(
    request: Request,
    file: UploadFile = File(...),
    _user: UserRow = Depends(current_user),
) -> ActivityMedia:
    """Persist a media attachment for a confirmed relationship memory."""
    content = await file.read(MAX_ACTIVITY_MEDIA_BYTES + 1)
    return store_activity_media(
        filename=file.filename or "memory-upload",
        content_type=file.content_type or "",
        content=content,
        storage=request.app.state.media_storage,
    )


@router.post("/api/activities", status_code=201)
def publish_activity(
    request: Request,
    body: ActivityCreateRequest,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    return create_activity(
        db,
        user,
        body,
        request.app.state.ecosystem_generator,
    )


@router.post("/api/activities/{activity_id}/broadcast/read")
def read_activity_broadcast(
    activity_id: str,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    result = mark_activity_broadcast_read(
        db,
        user,
        activity_id,
        request.app.state.semantic_similarity,
    )
    if result["cosmos"] is None:
        from app.application.universe import get_cosmos
        result["cosmos"] = get_cosmos(
            db,
            user,
            semantic_similarity=request.app.state.semantic_similarity,
        )
    return result


@router.post("/api/activities/{activity_id}/broadcast/close")
def close_broadcast(
    activity_id: str,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    return {"activity": close_activity_broadcast(db, user, activity_id)}
