from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import GraphDocumentRow, PlanetRow, UserRow
from app.domain.planet_generator import PlanetGenerationRequest, planet_generator
from app.schemas.profile import ProfileIntake
from app.schemas.universe import PlanetScore

from .behavior import record_user_behavior
from .graph_projection import store_profile_graph
from .scoring import calculate_current_planet_score
from .serialization import dumps, loads, new_id


def default_visual(seed: int = 4281, archetype: str = "terran") -> dict[str, Any]:
    selected = archetype if archetype in planet_generator.archetypes else "terran"
    return planet_generator.generate(PlanetGenerationRequest(seed=seed, archetype=selected))


def generated_default_visual(owner_key: str) -> dict[str, Any]:
    """Create a stable visual identity for system-generated planets.

    User-authored visual configurations still pass through untouched. This is
    only the fallback used when a relationship needs a planet before its owner
    has customized one.
    """

    return planet_generator.generate_for_owner(owner_key)


def upsert_intake(
    db: Session,
    user: UserRow,
    profile: ProfileIntake,
    *,
    create_planet: bool = True,
) -> tuple[Any, PlanetScore]:
    graph = store_profile_graph(db, user.id, profile)
    record_user_behavior(
        db,
        user.id,
        "profile_enriched",
        dedupe_key=f"profile:{graph.graph_version}",
        metadata={"graphVersion": graph.graph_version},
    )
    score = calculate_current_planet_score(db, user, profile)
    user.display_name = profile.display_name
    user.bio = profile.bio
    user.intake_json = dumps(profile)
    user.updated_at = datetime.now(timezone.utc)
    planet = db.scalar(select(PlanetRow).where(PlanetRow.owner_user_id == user.id))
    # Profile intake is allowed before genesis. Do not create a placeholder
    # planet here: doing so makes a returning user look fully onboarded and can
    # expose a temporary/default name instead of the name chosen at genesis.
    if not planet and create_planet:
        identity = {
            "name": f"{profile.display_name}'s World",
            "motto": "Every life leaves a gravity trace.",
            "description": profile.bio,
            "tags": [item.name for item in profile.interests[:8]],
            "mass": score.physical_mass,
            "massScore": score.mass_score,
            "influence": round(score.mass_score),
        }
        planet = PlanetRow(
            id=new_id("planet"),
            owner_user_id=user.id,
            identity_json=dumps(identity),
            visual_json=dumps(generated_default_visual(user.id)),
        )
        db.add(planet)
        user.planet_id = planet.id
    if planet:
        previous_identity = loads(planet.identity_json, {})
        identity = {
            **previous_identity,
            "description": profile.bio,
            "tags": [item.name for item in profile.interests[:8]],
            "mass": score.physical_mass,
            "massScore": score.mass_score,
            "influence": round(score.mass_score),
        }
        visual = loads(planet.visual_json, default_visual())
        visual["radius"] = score.visual_radius
        planet.identity_json = dumps(identity)
        planet.visual_json = dumps(visual)
        planet.score_json = dumps(score)
        planet.updated_at = datetime.now(timezone.utc)
    db.flush()
    return graph, score


def _fallback_profile(user: UserRow) -> ProfileIntake:
    return ProfileIntake(display_name=user.display_name, bio=user.bio, interests=[{"name": tag} for tag in loads(user.tags_json, [])])


def ensure_user_projection(
    db: Session,
    user: UserRow,
    *,
    computed_at: datetime | None = None,
) -> tuple[PlanetRow, PlanetScore, str]:
    profile_data = loads(user.intake_json, {})
    profile = ProfileIntake.model_validate(profile_data) if profile_data else _fallback_profile(user)
    graph_row = db.get(GraphDocumentRow, user.id)
    planet = db.scalar(select(PlanetRow).where(PlanetRow.owner_user_id == user.id))
    if not graph_row:
        graph = store_profile_graph(db, user.id, profile)
        graph_version = graph.graph_version
    else:
        graph_version = graph_row.graph_version
    score = calculate_current_planet_score(db, user, profile, computed_at=computed_at)
    if not planet:
        planet = PlanetRow(
            id=new_id("planet"),
            owner_user_id=user.id,
            identity_json=dumps({
                "name": f"{user.display_name}'s World",
                "motto": "Every life leaves a gravity trace.",
                "description": user.bio,
                "tags": loads(user.tags_json, []),
                "mass": score.physical_mass,
                "massScore": score.mass_score,
                "influence": round(score.mass_score),
            }),
            visual_json=dumps({**generated_default_visual(user.id), "radius": score.visual_radius}),
            score_json=dumps(score),
        )
        db.add(planet)
        user.planet_id = planet.id
    else:
        identity = loads(planet.identity_json, {})
        identity.update({
            "description": profile.bio,
            "tags": [item.name for item in profile.interests[:8]],
            "mass": score.physical_mass,
            "massScore": score.mass_score,
            "influence": round(score.mass_score),
        })
        visual = loads(planet.visual_json, default_visual())
        visual["radius"] = score.visual_radius
        planet.identity_json = dumps(identity)
        planet.visual_json = dumps(visual)
        planet.score_json = dumps(score)
        planet.updated_at = datetime.now(timezone.utc)
    db.flush()
    return planet, score, graph_version


def serialize_profile(user: UserRow) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "emailVerified": user.email_verified_at is not None,
        "displayName": user.display_name,
        "bio": user.bio,
        "tags": loads(user.tags_json, []),
        "planetId": user.planet_id,
    }


def serialize_planet(
    user: UserRow,
    planet: PlanetRow,
    strength: float,
    position: tuple[float, float, float],
    is_self: bool = False,
) -> dict[str, Any]:
    return {
        "id": planet.id,
        "ownerId": user.id,
        "ownerName": user.display_name,
        "identity": loads(planet.identity_json, {}),
        "visual": loads(planet.visual_json, {}),
        "position": list(position),
        "relationshipStrength": strength,
        "isSelf": is_self,
    }
