from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.application.graph_projection import project_graph_outbox
from app.application.profile import serialize_profile, upsert_intake
from app.application.serialization import dumps, loads
from app.application.universe import get_cosmos, recompute_universe
from app.db import GraphDocumentRow, PlanetRow, UserRow
from app.schemas.graph import ProfileGraphDocument
from app.schemas.profile import ProfileIntake

from ..dependencies import current_user, db_session


router = APIRouter()


@router.get("/api/v1/users/me/intake", response_model=ProfileIntake)
def own_intake(
    user: UserRow = Depends(current_user),
) -> ProfileIntake:
    current = loads(user.intake_json, {})
    if current:
        return ProfileIntake.model_validate(current)
    return ProfileIntake(
        display_name=user.display_name,
        bio=user.bio,
        interests=[{"name": tag} for tag in loads(user.tags_json, [])],
    )


@router.get("/api/cosmos")
def cosmos(
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    return get_cosmos(db, user, semantic_similarity=request.app.state.semantic_similarity)


@router.post("/api/profile")
def update_profile(
    body: dict[str, Any],
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    current = loads(user.intake_json, {}) or {"displayName": user.display_name, "bio": user.bio}
    if "displayName" in body:
        current["displayName"] = str(body["displayName"]).strip()
    if "bio" in body:
        current["bio"] = str(body["bio"]).strip()
    if "tags" in body and isinstance(body["tags"], list):
        tags = [str(item).strip() for item in body["tags"] if str(item).strip()][:8]
        current["interests"] = [{"name": item} for item in tags]
        user.tags_json = dumps(tags)
    upsert_intake(db, user, ProfileIntake.model_validate(current), create_planet=False)
    return {"profile": serialize_profile(user)}


@router.put("/api/v1/users/me/intake")
def save_intake(
    body: ProfileIntake,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    graph, score = upsert_intake(db, user, body, create_planet=False)
    has_planet = db.scalar(select(PlanetRow.id).where(PlanetRow.owner_user_id == user.id)) is not None
    snapshot = recompute_universe(
        db,
        user,
        semantic_similarity=request.app.state.semantic_similarity,
    ) if has_planet else None
    db.commit()
    with request.app.state.database.session() as projection_db:
        projection = project_graph_outbox(
            projection_db,
            request.app.state.graph_repository,
            owner_user_id=user.id,
        )
    return {
        "profile": serialize_profile(user),
        "graph": graph,
        "planetScore": score,
        "snapshot": snapshot,
        "projection": projection,
    }


@router.get("/api/v1/users/me/graph", response_model=ProfileGraphDocument)
def own_graph(
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> ProfileGraphDocument:
    row = db.get(GraphDocumentRow, user.id)
    if not row:
        raise HTTPException(status_code=404, detail="Profile graph has not been compiled.")
    return ProfileGraphDocument.model_validate(loads(row.document_json, {}))
