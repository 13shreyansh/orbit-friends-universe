from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.application.planet import save_planet
from app.application.interaction import record_planet_interaction
from app.application.profile import ensure_user_projection
from app.application.universe import get_universe_window, recompute_universe
from app.db import UserRow
from app.schemas.universe import PlanetScore, SpatialSnapshot
from app.schemas.interaction import PlanetInteractionRequest

from ..dependencies import current_user, db_session


router = APIRouter()


@router.get("/api/v1/universe/window")
def universe_window(
    request: Request,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=12, ge=1, le=48),
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    return get_universe_window(
        db,
        user,
        offset=offset,
        limit=limit,
        semantic_similarity=request.app.state.semantic_similarity,
    )


@router.get("/api/v1/planets/me/score", response_model=PlanetScore)
def own_planet_score(
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> PlanetScore:
    _, score, _ = ensure_user_projection(db, user)
    return score


@router.get("/api/v1/universe/snapshot", response_model=SpatialSnapshot)
def universe_snapshot(
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> SpatialSnapshot:
    return recompute_universe(db, user, semantic_similarity=request.app.state.semantic_similarity)


@router.post("/api/spatial/snapshot")
def compatibility_snapshot(
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    body = recompute_universe(
        db,
        user,
        semantic_similarity=request.app.state.semantic_similarity,
    ).model_dump(mode="json", by_alias=True)
    body["schemaVersion"] = 1
    return body


@router.post("/api/planets", status_code=201)
def create_or_update_planet(
    body: dict[str, Any],
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    return save_planet(db, user, body, request.app.state.semantic_similarity)


@router.post("/api/planets/{planet_id}/interactions", status_code=201)
def create_planet_interaction(
    planet_id: str,
    body: PlanetInteractionRequest,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    return record_planet_interaction(
        db,
        user,
        planet_id,
        body,
        request.app.state.semantic_similarity,
    )

