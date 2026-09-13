from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import PlanetRow, UserRow
from app.schemas.profile import ProfileIntake
from app.ports.semantic_similarity import SemanticSimilarity

from .behavior import record_user_behavior
from .errors import PayloadValidationError
from .profile import generated_default_visual
from .scoring import calculate_current_planet_score
from .serialization import content_dedupe_key, dumps, loads, new_id
from .universe import get_cosmos


def save_planet(
    db: Session,
    owner: UserRow,
    body: dict[str, Any],
    semantic_similarity: SemanticSimilarity | None = None,
) -> dict[str, Any]:
    identity = body.get("identity")
    visual = body.get("visual")
    if not isinstance(identity, dict) or not str(identity.get("name", "")).strip() or not isinstance(visual, dict):
        raise PayloadValidationError("Planet identity and visual configuration are required.")
    profile_data = loads(owner.intake_json, {})
    profile = ProfileIntake.model_validate(profile_data) if profile_data else ProfileIntake(display_name=owner.display_name, bio=owner.bio)
    planet = db.scalar(select(PlanetRow).where(PlanetRow.owner_user_id == owner.id))
    if not planet:
        planet = PlanetRow(id=new_id("planet"), owner_user_id=owner.id, identity_json="{}", visual_json=dumps(generated_default_visual(owner.id)))
        db.add(planet)
        owner.planet_id = planet.id
        db.flush()
    record_user_behavior(
        db,
        owner.id,
        "planet_customized",
        dedupe_key=content_dedupe_key(f"planet:{planet.id}", {"identity": identity, "visual": visual}),
        metadata={"planetId": planet.id},
    )
    score = calculate_current_planet_score(db, owner, profile)
    stored_identity = {
        **identity,
        "description": profile.bio,
        "mass": score.physical_mass,
        "massScore": score.mass_score,
        "influence": round(score.mass_score),
    }
    stored_visual = {**visual, "radius": score.visual_radius}
    planet.identity_json = dumps(stored_identity)
    planet.visual_json = dumps(stored_visual)
    planet.score_json = dumps(score)
    planet.updated_at = datetime.now(timezone.utc)
    db.flush()
    cosmos = get_cosmos(
        db,
        owner,
        semantic_similarity=semantic_similarity,
    )
    return {"planet": cosmos["selfPlanet"], "profile": cosmos["profile"]}
