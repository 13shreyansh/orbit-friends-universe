from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.application.ingestion import (
    analyze_ingestion_job,
    confirm_legacy_memory,
    create_compatibility_ingestion_job,
)
from app.application.relationship import upsert_relationship
from app.application.serialization import loads
from app.db import PlanetRow, RelationshipRow, UserRow
from app.domain.profile_affinity import calculate_profile_affinity
from app.schemas.memory import AnalyzeMemoryRequest, SaveMemoryRequest
from app.schemas.relationship import RelationshipRequest
from app.schemas.profile import ProfileIntake

from ..dependencies import current_user, db_session


router = APIRouter()


@router.get("/api/users/discover")
def discover(
    request: Request,
    include_affinity: bool = Query(default=False, alias="includeAffinity"),
    query: str = Query(default="", alias="q", max_length=80),
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    connected_ids = set(db.scalars(select(RelationshipRow.target_user_id).where(
        RelationshipRow.owner_user_id == user.id,
    )))
    normalized_query = query.strip()
    statement = (
        select(UserRow, PlanetRow)
        .outerjoin(PlanetRow, PlanetRow.owner_user_id == UserRow.id)
        .where(UserRow.id != user.id, UserRow.deleted_at.is_(None))
    )
    if normalized_query:
        # A deliberate name search must be able to explain why an account
        # cannot be connected yet. Returning pending/connected accounts here
        # avoids the misleading "person does not exist" empty state.
        statement = statement.where(UserRow.display_name.ilike(f"%{normalized_query}%"))
    else:
        # The initial recommendation directory remains limited to actionable
        # accounts so pending onboarding records do not flood the picker.
        statement = statement.where(
            UserRow.id.not_in(connected_ids),
            UserRow.planet_id.is_not(None),
        )
    rows = list(db.execute(statement.order_by(UserRow.display_name).limit(100)))
    def profile_for(item: UserRow) -> ProfileIntake:
        data = loads(item.intake_json, {})
        return ProfileIntake.model_validate(data) if data else ProfileIntake(
            display_name=item.display_name,
            bio=item.bio,
            interests=[{"name": tag} for tag in loads(item.tags_json, [])],
        )

    ranked: list[tuple[UserRow, PlanetRow, Any | None]] = []
    if include_affinity:
        owner_profile = profile_for(user)
        for item, planet in rows:
            affinity = calculate_profile_affinity(
                owner_profile,
                profile_for(item),
                request.app.state.semantic_similarity,
            )
            ranked.append((item, planet, affinity))
        ranked.sort(
            # Missing profile dimensions must not be renormalized into an
            # apparent perfect recommendation. Confidence represents the
            # fraction of objective evidence actually observed.
            key=lambda row: (
                float(row[2].score or 0.0) * row[2].confidence,
                row[2].confidence,
                row[0].display_name,
            ),
            reverse=True,
        )
    else:
        # Keep the directory a fast database read. Exact semantic affinity is
        # requested only for the candidate the user selects.
        ranked = [(item, planet, None) for item, planet in rows]
    return {"users": [
        {
            "id": item.id,
            "displayName": item.display_name,
            "bio": item.bio,
            "planetId": planet.id if planet else None,
            "planetName": loads(planet.identity_json, {}).get("name", "Unnamed World") if planet else "",
            "planetReady": planet is not None,
            "connected": item.id in connected_ids,
            "canConnect": planet is not None and item.id not in connected_ids,
            "profileAffinity": affinity.score if affinity else None,
            "affinityConfidence": affinity.confidence if affinity else 0,
            "profileFeatures": [feature.model_dump(mode="json", by_alias=True) for feature in affinity.features] if affinity else [],
        }
        for item, planet, affinity in ranked
    ]}


@router.get("/api/users/{target_user_id}/affinity")
def discover_affinity(
    target_user_id: str,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    target = db.get(UserRow, target_user_id)
    if not target or target.id == user.id or target.deleted_at is not None or not target.planet_id:
        raise HTTPException(status_code=404, detail="Discoverable user not found.")

    def profile_for(item: UserRow) -> ProfileIntake:
        data = loads(item.intake_json, {})
        return ProfileIntake.model_validate(data) if data else ProfileIntake(
            display_name=item.display_name,
            bio=item.bio,
            interests=[{"name": tag} for tag in loads(item.tags_json, [])],
        )

    affinity = calculate_profile_affinity(
        profile_for(user),
        profile_for(target),
        request.app.state.semantic_similarity,
    )
    return {
        "userId": target.id,
        "profileAffinity": affinity.score,
        "affinityConfidence": affinity.confidence,
        "profileFeatures": [feature.model_dump(mode="json", by_alias=True) for feature in affinity.features],
    }


@router.post("/api/relationships", status_code=201)
def create_or_update_relationship(
    body: RelationshipRequest,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    return upsert_relationship(db, user, body, request.app.state.semantic_similarity)


@router.post("/api/memories/analyze", response_model=None)
async def memory_analysis(
    body: AnalyzeMemoryRequest,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any] | JSONResponse:
    job = create_compatibility_ingestion_job(db, user, body)
    request.state.job_id = job.id
    _job, draft = await analyze_ingestion_job(
        db,
        user,
        job.id,
        request.app.state.memory_agent,
        request.app.state.agent_memory_store,
        agent_memory_recall_top_k=request.app.state.agent_memory_recall_top_k,
    )
    if not draft:
        return JSONResponse(
            status_code=status.HTTP_502_BAD_GATEWAY,
            content={"detail": "Memory analysis failed.", "jobId": job.id},
        )
    return loads(draft.candidate_json, {})


@router.post("/api/memories", status_code=201)
def create_or_update_memory(
    body: SaveMemoryRequest,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    return confirm_legacy_memory(db, user, body)

