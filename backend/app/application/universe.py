from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import MemoryRow, MemoryShareRow, PlanetRow, RelationshipRow, SpatialSnapshotRow, TimelineRow, UserRow
from app.domain.layout import PlanetBody, RelationshipLink, create_spatial_snapshot
from app.domain.profile_affinity import calculate_profile_affinity
from app.schemas.universe import PlanetScore, SpatialSnapshot
from app.schemas.profile import ProfileIntake
from app.ports.semantic_similarity import SemanticSimilarity

from .activity import visible_activities
from .memory_sharing import list_memory_signals
from .profile import ensure_user_projection, serialize_planet, serialize_profile
from .scoring import calculate_current_relationship_score, resolve_semantic_similarity, simulation_tick
from .serialization import dumps, loads


DISCOVERY_PLANET_LIMIT = 12
UNIVERSE_WINDOW_LIMIT = 12


def _profile_for(user: UserRow) -> ProfileIntake:
    data = loads(user.intake_json, {})
    return ProfileIntake.model_validate(data) if data else ProfileIntake(
        display_name=user.display_name,
        bio=user.bio,
        interests=[{"name": tag} for tag in loads(user.tags_json, [])],
    )


def _sample_users(db: Session, owner: UserRow) -> list[UserRow]:
    connected_ids = set(db.scalars(select(RelationshipRow.target_user_id).where(
        RelationshipRow.owner_user_id == owner.id,
    )))
    candidates = list(db.scalars(select(UserRow).where(
        UserRow.id != owner.id,
        UserRow.planet_id.is_not(None),
    )))
    candidates = [candidate for candidate in candidates if candidate.id not in connected_ids]

    return candidates[:DISCOVERY_PLANET_LIMIT]


def _sample_strength(owner: UserRow, target: UserRow, semantic_similarity: SemanticSimilarity) -> float:
    affinity = calculate_profile_affinity(
        _profile_for(owner),
        _profile_for(target),
        semantic_similarity,
    )
    # Suggested people are deliberately kept in distant discovery shells.
    # Affinity can order them, but cannot impersonate relationship evidence.
    return round(min(0.22, 0.04 + 0.18 * float(affinity.score or 0.0)), 6)


def recompute_universe(
    db: Session,
    owner: UserRow,
    *,
    computed_at: datetime | None = None,
    semantic_similarity: SemanticSimilarity | None = None,
) -> SpatialSnapshot:
    semantic_similarity = resolve_semantic_similarity(semantic_similarity)
    tick = simulation_tick(computed_at)
    owner_planet, _, graph_version = ensure_user_projection(db, owner, computed_at=tick)
    relationships = list(db.scalars(select(RelationshipRow).where(RelationshipRow.owner_user_id == owner.id)))
    bodies: list[PlanetBody] = []
    links: list[RelationshipLink] = []
    owner_score = PlanetScore.model_validate(loads(owner_planet.score_json, {}))
    bodies.append(PlanetBody(owner_planet.id, owner_score.physical_mass, owner_score.mass_score, owner_score.visual_radius))
    for relationship in relationships:
        target = db.get(UserRow, relationship.target_user_id)
        if not target:
            continue
        target_planet, target_score, _ = ensure_user_projection(db, target, computed_at=tick)
        score = calculate_current_relationship_score(db, relationship, computed_at=tick, semantic_similarity=semantic_similarity)
        bodies.append(PlanetBody(target_planet.id, target_score.physical_mass, target_score.mass_score, target_score.visual_radius))
        links.append(RelationshipLink(owner_planet.id, target_planet.id, score.strength))
    if not relationships:
        candidates = _sample_users(db, owner)
        candidates.sort(
            key=lambda target: _sample_strength(owner, target, semantic_similarity),
            reverse=True,
        )
        for target in candidates:
            target_planet, target_score, _ = ensure_user_projection(db, target, computed_at=tick)
            strength = _sample_strength(owner, target, semantic_similarity)
            bodies.append(PlanetBody(target_planet.id, target_score.physical_mass, target_score.mass_score, target_score.visual_radius))
            links.append(RelationshipLink(owner_planet.id, target_planet.id, strength))
    old = db.get(SpatialSnapshotRow, owner.id)
    old_positions: dict[str, tuple[float, float, float]] = {}
    if old:
        old_snapshot = loads(old.snapshot_json, {})
        if old_snapshot.get("layoutAlgorithmVersion") == "layout.v2":
            for node in old_snapshot.get("nodes", []):
                position = node.get("position", {})
                old_positions[node.get("planetId", "")] = (position.get("x", 0), position.get("y", 0), position.get("z", 0))
    snapshot = create_spatial_snapshot(
        owner_planet.id,
        bodies,
        links,
        graph_version,
        previous_positions=old_positions,
        generated_at=tick,
    )
    if old:
        old.graph_version = graph_version
        old.snapshot_json = dumps(snapshot)
        old.created_at = datetime.now(timezone.utc)
    else:
        db.add(SpatialSnapshotRow(owner_user_id=owner.id, graph_version=graph_version, snapshot_json=dumps(snapshot)))
    db.flush()
    return snapshot


def _window_snapshot(snapshot: SpatialSnapshot, planet_ids: set[str]) -> SpatialSnapshot:
    allowed = {snapshot.center_planet_id, *planet_ids}
    nodes = [node for node in snapshot.nodes if node.planet_id in allowed]
    edges = [
        edge for edge in snapshot.edges
        if edge.source_planet_id in allowed and edge.target_planet_id in allowed
    ]
    radius = max(10.0, *(node.orbit_band + node.visual_radius for node in nodes))
    return snapshot.model_copy(update={
        "nodes": nodes,
        "edges": edges,
        "bounds": snapshot.bounds.model_copy(update={"radius": radius}),
    })


def get_universe_window(
    db: Session,
    owner: UserRow,
    *,
    offset: int = 0,
    limit: int = UNIVERSE_WINDOW_LIMIT,
    semantic_similarity: SemanticSimilarity | None = None,
) -> dict[str, Any]:
    """Return one center-out render window without serializing the whole galaxy."""
    semantic_similarity = resolve_semantic_similarity(semantic_similarity)
    stored = db.get(SpatialSnapshotRow, owner.id)
    snapshot = SpatialSnapshot.model_validate(loads(stored.snapshot_json, {})) if stored else recompute_universe(
        db,
        owner,
        semantic_similarity=semantic_similarity,
    )
    ordered_nodes = sorted(
        (node for node in snapshot.nodes if node.planet_id != snapshot.center_planet_id),
        key=lambda node: (node.orbit_band, node.planet_id),
    )
    page_nodes = ordered_nodes[offset:offset + limit]
    page_planet_ids = {node.planet_id for node in page_nodes}
    node_by_planet = {node.planet_id: node for node in page_nodes}

    planet_rows = list(db.scalars(select(PlanetRow).where(PlanetRow.id.in_(page_planet_ids)))) if page_planet_ids else []
    users = {
        user.id: user for user in db.scalars(select(UserRow).where(
            UserRow.id.in_([planet.owner_user_id for planet in planet_rows])
        ))
    } if planet_rows else {}
    target_ids = set(users)
    relationships = list(db.scalars(select(RelationshipRow).where(
        RelationshipRow.owner_user_id == owner.id,
        RelationshipRow.target_user_id.in_(target_ids),
    ))) if target_ids else []
    relationship_by_target = {row.target_user_id: row for row in relationships}

    planets = []
    serialized_relationships = []
    for planet in sorted(planet_rows, key=lambda row: node_by_planet[row.id].orbit_band):
        target = users.get(planet.owner_user_id)
        node = node_by_planet.get(planet.id)
        if not target or not node:
            continue
        relationship = relationship_by_target.get(target.id)
        strength = node.relationship_force
        if relationship:
            score = calculate_current_relationship_score(
                db,
                relationship,
                computed_at=snapshot.generated_at,
                semantic_similarity=semantic_similarity,
            )
            strength = score.strength
            serialized_relationships.append({
                "id": relationship.id,
                "ownerUserId": owner.id,
                "targetUserId": target.id,
                "targetPlanetId": planet.id,
                "targetName": target.display_name,
                "relationType": relationship.relation_type,
                "identityLabel": relationship.identity_label,
                "description": relationship.description,
                "strength": score.strength,
                "score": score.model_dump(mode="json", by_alias=True),
                "status": relationship.status,
                "startedAt": relationship.started_at,
            })
        planets.append(serialize_planet(
            target,
            planet,
            strength,
            (node.position.x, node.position.y, node.position.z),
        ))

    selected_owner_ids = {owner.id, *target_ids}
    activities = [
        activity for activity in visible_activities(db, owner, relationships)
        if activity["authorUserId"] in selected_owner_ids
    ]
    next_offset = offset + len(page_nodes)
    return {
        "planets": planets,
        "relationships": serialized_relationships,
        "activities": activities,
        "snapshot": _window_snapshot(snapshot, page_planet_ids),
        "pagination": {
            "offset": offset,
            "limit": limit,
            "total": len(ordered_nodes),
            "nextOffset": next_offset if next_offset < len(ordered_nodes) else None,
            "hasMore": next_offset < len(ordered_nodes),
        },
    }


def get_cosmos(
    db: Session,
    owner: UserRow,
    *,
    semantic_similarity: SemanticSimilarity | None = None,
    planet_limit: int = UNIVERSE_WINDOW_LIMIT,
) -> dict[str, Any]:
    semantic_similarity = resolve_semantic_similarity(semantic_similarity)
    owner_planet = db.scalar(select(PlanetRow).where(PlanetRow.owner_user_id == owner.id))
    if not owner_planet:
        return {
            "profile": serialize_profile(owner),
            "selfPlanet": None,
            "friendPlanets": [],
            "samplePlanets": [],
            "relationships": [],
            "memories": [],
            "timeline": [],
            "activities": [],
            "memorySignals": [],
            "universePagination": {"offset": 0, "limit": planet_limit, "total": 0, "nextOffset": None, "hasMore": False},
        }
    snapshot = recompute_universe(db, owner, semantic_similarity=semantic_similarity)
    positions = {node.planet_id: (node.position.x, node.position.y, node.position.z) for node in snapshot.nodes}
    relationships = list(db.scalars(
        select(RelationshipRow)
        .where(RelationshipRow.owner_user_id == owner.id)
        .order_by(RelationshipRow.updated_at.desc())
    ))
    friend_planets = []
    sample_planets = []
    serialized_relationships = []
    relationship_entries = []
    for relationship in relationships:
        target = db.get(UserRow, relationship.target_user_id)
        target_planet = db.scalar(select(PlanetRow).where(PlanetRow.owner_user_id == relationship.target_user_id))
        if not target or not target_planet:
            continue
        score = calculate_current_relationship_score(
            db,
            relationship,
            computed_at=snapshot.generated_at,
            semantic_similarity=semantic_similarity,
        )
        serialized = {
            "id": relationship.id,
            "ownerUserId": owner.id,
            "targetUserId": target.id,
            "targetPlanetId": target_planet.id,
            "targetName": target.display_name,
            "relationType": relationship.relation_type,
            "identityLabel": relationship.identity_label,
            "description": relationship.description,
            "strength": score.strength,
            "score": score.model_dump(mode="json", by_alias=True),
            "status": relationship.status,
            "startedAt": relationship.started_at,
        }
        position = positions.get(target_planet.id, (0, 0, 0))
        relationship_entries.append((sum(value * value for value in position), serialize_planet(target, target_planet, score.strength, position), serialized))
    relationship_entries.sort(key=lambda item: (item[0], item[1]["id"]))
    total_planets = len(relationship_entries)
    for _, planet, relationship in relationship_entries[:planet_limit]:
        friend_planets.append(planet)
        serialized_relationships.append(relationship)
    if not relationships:
        node_by_planet_id = {node.planet_id: node for node in snapshot.nodes}
        for target in _sample_users(db, owner)[:planet_limit]:
            target_planet = db.scalar(select(PlanetRow).where(PlanetRow.owner_user_id == target.id))
            if not target_planet or target_planet.id not in node_by_planet_id:
                continue
            node = node_by_planet_id[target_planet.id]
            sample_planets.append(serialize_planet(
                target,
                target_planet,
                node.relationship_force,
                (node.position.x, node.position.y, node.position.z),
            ))
    memory_rows = list(db.scalars(select(MemoryRow).where(MemoryRow.owner_user_id == owner.id).order_by(MemoryRow.event_time.desc())))
    shared_rows = list(db.scalars(
        select(MemoryShareRow)
        .where(MemoryShareRow.recipient_user_id == owner.id, MemoryShareRow.status == "active")
        .order_by(MemoryShareRow.created_at.desc())
    ))
    shared_memory_rows = [(share, db.get(MemoryRow, share.memory_id)) for share in shared_rows]
    shared_memory_rows = [(share, row) for share, row in shared_memory_rows if row is not None]
    timeline_rows = list(db.scalars(select(TimelineRow).where(TimelineRow.owner_user_id == owner.id).order_by(TimelineRow.event_time)))
    selected_owner_ids = {owner.id, *(planet["ownerId"] for planet in [*friend_planets, *sample_planets])}
    activities = [
        activity for activity in visible_activities(db, owner, relationships)
        if activity["authorUserId"] in selected_owner_ids
    ]
    total_planets = total_planets if relationships else len(sample_planets)
    return {
        "profile": serialize_profile(owner),
        "selfPlanet": serialize_planet(owner, owner_planet, 1, (0, 0, 0), True),
        "friendPlanets": friend_planets,
        "samplePlanets": sample_planets,
        "relationships": serialized_relationships,
        "memories": [
            loads(row.memory_json, {}) | {"relationshipId": row.relationship_id, "shared": False}
            for row in memory_rows
        ] + [
            loads(row.memory_json, {}) | {
                "relationshipId": share.recipient_relationship_id,
                "shared": True,
                "sharedByUserId": share.owner_user_id,
                "sharedByName": (db.get(UserRow, share.owner_user_id).display_name if db.get(UserRow, share.owner_user_id) else None),
            }
            for share, row in shared_memory_rows
        ],
        "timeline": [{
            "id": row.id,
            "relationshipId": row.relationship_id,
            "eventTime": row.event_time,
            "eventType": row.event_type,
            "intimacy": row.intimacy,
            "interactionFrequency": row.interaction_frequency,
            "emotionalTone": row.emotional_tone,
            "description": row.description,
            "sourceMemoryId": row.source_memory_id,
        } for row in timeline_rows],
        "activities": activities,
        "memorySignals": list_memory_signals(db, owner),
        "universePagination": {
            "offset": 0,
            "limit": planet_limit,
            "total": total_planets,
            "nextOffset": len(friend_planets or sample_planets) if total_planets > len(friend_planets or sample_planets) else None,
            "hasMore": total_planets > len(friend_planets or sample_planets),
        },
    }
