from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.application.nebula import create_nebula, get_nebula_space, join_nebula, join_nebula_by_code, list_nebulae
from app.db import UserRow

from ..dependencies import current_user, db_session


router = APIRouter()


@router.get("/api/nebulae")
def nebula_directory(
    q: str = Query(default="", max_length=160),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=6, alias="pageSize", ge=1, le=24),
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict:
    return list_nebulae(db, user, q, page=page, page_size=page_size)


@router.post("/api/nebulae", status_code=201)
def nebula_create(body: dict, user: UserRow = Depends(current_user), db: Session = Depends(db_session)) -> dict:
    return create_nebula(db, user, body)


@router.post("/api/nebulae/{nebula_id}/join")
def nebula_join(nebula_id: str, user: UserRow = Depends(current_user), db: Session = Depends(db_session)) -> dict:
    return join_nebula(db, user, nebula_id)


@router.post("/api/nebulae/join-by-code")
def nebula_join_by_code(body: dict, user: UserRow = Depends(current_user), db: Session = Depends(db_session)) -> dict:
    return join_nebula_by_code(db, user, str(body.get("joinCode", "")))


@router.get("/api/nebulae/{nebula_id}/space")
def nebula_space(
    nebula_id: str,
    request: Request,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=24, ge=1, le=64),
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict:
    return get_nebula_space(
        db,
        user,
        nebula_id,
        offset=offset,
        limit=limit,
        semantic_similarity=request.app.state.semantic_similarity,
    )
