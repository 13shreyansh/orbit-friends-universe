from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai_provider import customize_planet
from app.application.scoring import simulation_tick
from app.db import GraphProjectionOutboxRow, UserRow

from ..dependencies import current_user, db_session


router = APIRouter()


@router.get("/api/health")
@router.get("/api/v1/health")
def health(request: Request, db: Session = Depends(db_session)) -> dict[str, Any]:
    graph_health = request.app.state.graph_repository.health()
    projection_counts = {
        row_status: count
        for row_status, count in db.execute(
            select(GraphProjectionOutboxRow.status, func.count()).group_by(GraphProjectionOutboxRow.status)
        )
    }
    return {
        "status": "ok" if graph_health["status"] == "ok" else "degraded",
        "database": request.app.state.database.engine.dialect.name,
        "graph": graph_health,
        "graphProjectionOutbox": projection_counts,
        "algorithms": ["mass.v2", "profile-affinity.v1", "semantic-evidence.v1", "relationship.v4", "layout.v2", "nebula.graph.v3", "nebula.layout.v3"],
        "simulation": {"cadenceSeconds": 3600, "currentTick": simulation_tick().isoformat()},
    }


@router.post("/api/ai/planet-customization")
async def planet_customization(
    body: dict[str, Any],
    _user: UserRow = Depends(current_user),
) -> dict[str, Any]:
    try:
        return await customize_planet(body)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
