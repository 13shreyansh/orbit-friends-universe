from __future__ import annotations

import hashlib
import re
import secrets
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.db import (
    ActivityPostRow,
    GraphDocumentRow,
    GraphNodeRow,
    NebulaGraphEdgeRow,
    NebulaMemberRow,
    NebulaRow,
    NebulaSpatialSnapshotRow,
    PlanetRow,
    RelationshipRow,
    UserBehaviorEventRow,
    UserRow,
)
from app.domain.nebula_layout import (
    NEBULA_GRAPH_ALGORITHM_VERSION,
    NEBULA_LAYOUT_ALGORITHM_VERSION,
    NebulaBody,
    NebulaGraphLink,
    build_sparse_member_graph,
    create_nebula_snapshot,
)
from app.ports.semantic_similarity import SemanticSimilarity

from .activity import serialize_activity
from .errors import ResourceNotFoundError, ResourceStateError
from .profile import serialize_planet
from .scoring import calculate_current_relationship_score, simulation_tick
from .serialization import dumps, loads, new_id


GRAPH_FEATURE_KINDS = {"Place", "Organization", "Skill", "Interest", "PersonalityType", "ProfileAttribute"}
JOIN_CODE_DIGITS = "0123456789"
UNSCORED_RELATIONSHIP_STRENGTH = 0.04


def _summary(db: Session, nebula: NebulaRow, viewer_id: str) -> dict:
    count = db.scalar(select(func.count()).select_from(NebulaMemberRow).where(NebulaMemberRow.nebula_id == nebula.id)) or 0
    membership = db.scalar(select(NebulaMemberRow).where(
        NebulaMemberRow.nebula_id == nebula.id,
        NebulaMemberRow.user_id == viewer_id,
    ))
    return {
        "id": nebula.id,
        "slug": nebula.slug,
        "joinCode": nebula.join_code,
        "name": nebula.name,
        "description": nebula.description,
        "ownerUserId": nebula.owner_user_id,
        "memberCount": count,
        "joined": membership is not None,
        "role": membership.role if membership else None,
        "theme": loads(nebula.theme_json, {}),
    }


def list_nebulae(
    db: Session,
    viewer: UserRow,
    query: str = "",
    recommendation_limit: int = 5,
    page: int = 1,
    page_size: int = 6,
) -> dict:
    joined_rows = list(db.scalars(
        select(NebulaRow)
        .join(NebulaMemberRow, NebulaMemberRow.nebula_id == NebulaRow.id)
        .where(NebulaMemberRow.user_id == viewer.id)
        .order_by(NebulaMemberRow.joined_at.desc())
    ))
    limit = max(1, min(recommendation_limit, 5))
    featured = db.scalar(select(NebulaRow).where(NebulaRow.slug == "adventurex"))
    recommendation_statement = select(NebulaRow)
    if featured:
        recommendation_statement = recommendation_statement.where(NebulaRow.id != featured.id)
    random_rows = list(db.scalars(recommendation_statement.order_by(func.random()).limit(limit - int(featured is not None))))
    recommendation_rows = ([featured] if featured else []) + random_rows
    normalized_query = query.strip()
    search_rows: list[NebulaRow] = []
    catalog_statement = select(NebulaRow)
    if normalized_query:
        pattern = f"%{normalized_query}%"
        catalog_statement = catalog_statement.where(or_(
            func.lower(NebulaRow.name).like(pattern.lower()),
            func.lower(NebulaRow.slug).like(pattern.lower()),
            NebulaRow.join_code == normalized_query.upper(),
        ))
    total = db.scalar(select(func.count()).select_from(catalog_statement.subquery())) or 0
    catalog_rows = list(db.scalars(
        catalog_statement.order_by(NebulaRow.name).offset((page - 1) * page_size).limit(page_size)
    ))
    if normalized_query:
        search_rows = catalog_rows
    return {
        "joined": [_summary(db, row, viewer.id) for row in joined_rows],
        "recommended": [_summary(db, row, viewer.id) for row in recommendation_rows],
        "searchResults": [_summary(db, row, viewer.id) for row in search_rows],
        "catalog": [_summary(db, row, viewer.id) for row in catalog_rows],
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "total": total,
            "totalPages": max(1, (total + page_size - 1) // page_size),
        },
    }


def _join_code(db: Session) -> str:
    for _ in range(12):
        value = "".join(secrets.choice(JOIN_CODE_DIGITS) for _ in range(6))
        if not db.scalar(select(NebulaRow.id).where(NebulaRow.join_code == value)):
            return value
    raise ResourceStateError("Could not allocate a unique nebula join code.")


def _slug(db: Session, name: str, requested: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", requested.strip().lower()).strip("-")
    if not base:
        base = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-") or "nebula"
    candidate = base
    suffix = 2
    while db.scalar(select(NebulaRow.id).where(NebulaRow.slug == candidate)):
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def create_nebula(db: Session, owner: UserRow, body: dict) -> dict:
    name = str(body.get("name", "")).strip()
    if not name:
        raise ResourceStateError("Nebula name is required.")
    slug = _slug(db, name, str(body.get("slug", "")))
    if not owner.planet_id:
        raise ResourceStateError("Create your planet before creating a nebula.")
    nebula = NebulaRow(
        id=new_id("nebula"), slug=slug, join_code=_join_code(db), name=name,
        description=str(body.get("description", "")).strip(), owner_user_id=owner.id,
        theme_json=dumps(body.get("theme", {})),
    )
    db.add(nebula)
    db.flush()
    db.add(NebulaMemberRow(id=new_id("nebula-member"), nebula_id=nebula.id, user_id=owner.id, role="owner"))
    db.flush()
    return _summary(db, nebula, owner.id)


def join_nebula(db: Session, viewer: UserRow, nebula_id: str) -> dict:
    nebula = db.get(NebulaRow, nebula_id)
    if not nebula:
        raise ResourceNotFoundError("Nebula not found.")
    if not viewer.planet_id:
        raise ResourceStateError("Create your planet before joining a nebula.")
    membership = db.scalar(select(NebulaMemberRow).where(
        NebulaMemberRow.nebula_id == nebula_id,
        NebulaMemberRow.user_id == viewer.id,
    ))
    if not membership:
        db.add(NebulaMemberRow(id=new_id("nebula-member"), nebula_id=nebula_id, user_id=viewer.id))
        db.flush()
    return _summary(db, nebula, viewer.id)


def join_nebula_by_code(db: Session, viewer: UserRow, join_code: str) -> dict:
    normalized = join_code.strip().upper()
    nebula = db.scalar(select(NebulaRow).where(NebulaRow.join_code == normalized))
    if not nebula:
        raise ResourceNotFoundError("Nebula join code not found.")
    return join_nebula(db, viewer, nebula.id)


def _member_data(db: Session, nebula_id: str) -> tuple[list[NebulaMemberRow], dict[str, UserRow], dict[str, PlanetRow]]:
    memberships = list(db.scalars(select(NebulaMemberRow).where(NebulaMemberRow.nebula_id == nebula_id)))
    user_ids = [item.user_id for item in memberships]
    users = {item.id: item for item in db.scalars(select(UserRow).where(UserRow.id.in_(user_ids)))}
    planets = {item.owner_user_id: item for item in db.scalars(select(PlanetRow).where(PlanetRow.owner_user_id.in_(user_ids)))}
    return memberships, users, planets


def _graph_features(db: Session, user_ids: list[str]) -> tuple[dict[str, frozenset[str]], dict[str, str]]:
    features: dict[str, set[str]] = defaultdict(set)
    versions = {row.owner_user_id: row.graph_version for row in db.scalars(
        select(GraphDocumentRow).where(GraphDocumentRow.owner_user_id.in_(user_ids))
    )}
    rows = db.scalars(select(GraphNodeRow).where(
        GraphNodeRow.owner_user_id.in_(user_ids),
        GraphNodeRow.kind.in_(GRAPH_FEATURE_KINDS),
    ))
    for row in rows:
        features[row.owner_user_id].add(f"{row.kind}:{row.label.strip().casefold()}")
    return {user_id: frozenset(features[user_id]) for user_id in user_ids}, versions


def _stored_v4_strength(row: RelationshipRow) -> float | None:
    score = loads(row.score_json, {})
    if score.get("algorithmVersion") != "relationship.v4":
        return None
    try:
        return max(0.0, min(1.0, float(score["strength"])))
    except (KeyError, TypeError, ValueError):
        return None


def _explicit_strengths(
    db: Session,
    member_ids: list[str],
    *,
    viewer_user_id: str,
    computed_at: datetime,
    semantic_similarity: SemanticSimilarity | None,
) -> dict[tuple[str, str], float]:
    # Nebula coordinates are viewer-centred. Recompute every direct viewer
    # edge at the current hourly tick so newly confirmed semantic evidence is
    # consumed immediately. Other member-to-member edges use the v4 score
    # persisted by the hourly simulation worker; an unscored legacy edge stays
    # in the outer shell instead of inheriting an invented strong default.
    pair_values: dict[tuple[str, str], list[float]] = defaultdict(list)
    rows = db.scalars(select(RelationshipRow).where(
        RelationshipRow.owner_user_id.in_(member_ids),
        RelationshipRow.target_user_id.in_(member_ids),
    ))
    for row in rows:
        if viewer_user_id in {row.owner_user_id, row.target_user_id}:
            strength = calculate_current_relationship_score(
                db,
                row,
                computed_at=computed_at,
                semantic_similarity=semantic_similarity,
            ).strength
        else:
            strength = _stored_v4_strength(row)
            if strength is None:
                strength = UNSCORED_RELATIONSHIP_STRENGTH
        pair_values[tuple(sorted((row.owner_user_id, row.target_user_id)))].append(strength)
    return {
        pair: round(sum(values) / len(values), 6)
        for pair, values in pair_values.items()
    }


def _graph_version(
    nebula_id: str,
    memberships: list[NebulaMemberRow],
    versions: dict[str, str],
    planets: dict[str, PlanetRow],
    strengths: dict[tuple[str, str], float],
) -> str:
    member_versions = [
        f"{item.user_id}:{versions.get(item.user_id, 'none')}:{planets[item.user_id].updated_at.isoformat()}"
        for item in memberships
        if item.user_id in planets
    ]
    relationship_versions = [f"{source}:{target}:{strength:.6f}" for (source, target), strength in strengths.items()]
    payload = "|".join([
        NEBULA_GRAPH_ALGORITHM_VERSION,
        NEBULA_LAYOUT_ALGORITHM_VERSION,
        nebula_id,
        *sorted(member_versions),
        *sorted(relationship_versions),
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


def _recompute_space(
    db: Session,
    nebula: NebulaRow,
    viewer: UserRow,
    *,
    semantic_similarity: SemanticSimilarity | None,
) -> tuple[dict, list[NebulaGraphLink]]:
    memberships, users, planets = _member_data(db, nebula.id)
    if viewer.id not in {item.user_id for item in memberships}:
        raise ResourceStateError("Join this nebula before entering its space.")
    usable_ids = [item.user_id for item in memberships if item.user_id in users and item.user_id in planets]
    features, versions = _graph_features(db, usable_ids)
    tick = simulation_tick()
    explicit_strengths = _explicit_strengths(
        db,
        usable_ids,
        viewer_user_id=viewer.id,
        computed_at=tick,
        semantic_similarity=semantic_similarity,
    )
    version = _graph_version(nebula.id, memberships, versions, planets, explicit_strengths)
    cached = db.scalar(select(NebulaSpatialSnapshotRow).where(
        NebulaSpatialSnapshotRow.nebula_id == nebula.id,
        NebulaSpatialSnapshotRow.viewer_user_id == viewer.id,
        NebulaSpatialSnapshotRow.graph_version == version,
    ))
    if cached:
        links = [NebulaGraphLink(row.source_user_id, row.target_user_id, row.strength, tuple(loads(row.basis_json, []))) for row in db.scalars(
            select(NebulaGraphEdgeRow).where(NebulaGraphEdgeRow.nebula_id == nebula.id)
        )]
        return loads(cached.snapshot_json, {}), links

    bodies = []
    for user_id in usable_ids:
        score = loads(planets[user_id].score_json, {})
        visual = loads(planets[user_id].visual_json, {})
        bodies.append(NebulaBody(
            user_id=user_id,
            planet_id=planets[user_id].id,
            physical_mass=float(score.get("physicalMass", 50)),
            visual_radius=float(score.get("visualRadius", visual.get("radius", 1))),
            feature_keys=features.get(user_id, frozenset()),
        ))
    links = build_sparse_member_graph(bodies, explicit_strengths)
    snapshot = create_nebula_snapshot(nebula.id, viewer.id, bodies, links, version)
    db.execute(delete(NebulaGraphEdgeRow).where(NebulaGraphEdgeRow.nebula_id == nebula.id))
    db.add_all(NebulaGraphEdgeRow(
        id=new_id("nebula-edge"), nebula_id=nebula.id,
        source_user_id=link.source_user_id, target_user_id=link.target_user_id,
        strength=link.strength, basis_json=dumps(link.basis), graph_version=version,
    ) for link in links)
    old = db.scalar(select(NebulaSpatialSnapshotRow).where(
        NebulaSpatialSnapshotRow.nebula_id == nebula.id,
        NebulaSpatialSnapshotRow.viewer_user_id == viewer.id,
    ))
    if old:
        old.graph_version = version
        old.snapshot_json = dumps(snapshot)
        old.created_at = datetime.now(timezone.utc)
    else:
        db.add(NebulaSpatialSnapshotRow(
            id=new_id("nebula-snapshot"), nebula_id=nebula.id, viewer_user_id=viewer.id,
            graph_version=version, snapshot_json=dumps(snapshot),
        ))
    db.flush()
    return snapshot, links


def get_nebula_space(
    db: Session,
    viewer: UserRow,
    nebula_id: str,
    *,
    offset: int = 0,
    limit: int = 24,
    semantic_similarity: SemanticSimilarity | None = None,
) -> dict:
    nebula = db.get(NebulaRow, nebula_id)
    if not nebula:
        raise ResourceNotFoundError("Nebula not found.")
    snapshot, links = _recompute_space(
        db,
        nebula,
        viewer,
        semantic_similarity=semantic_similarity,
    )
    memberships, users, planets = _member_data(db, nebula.id)
    node_by_planet = {node["planetId"]: node for node in snapshot["nodes"]}
    center_planet_id = snapshot["centerPlanetId"]
    ordered_nodes = sorted(
        (node for node in snapshot["nodes"] if node["planetId"] != center_planet_id),
        key=lambda node: (float(node.get("orbitBand", 0)), node["planetId"]),
    )
    page_nodes = ordered_nodes[offset:offset + limit]
    page_planet_ids = {node["planetId"] for node in page_nodes}
    visible_planet_ids = {center_planet_id, *page_planet_ids}
    visible_snapshot = {
        **snapshot,
        "nodes": [node for node in snapshot["nodes"] if node["planetId"] in visible_planet_ids],
        # Preserve incident edges so later windows can complete their endpoints
        # without requesting the graph topology a second time.
        "edges": [edge for edge in snapshot["edges"] if (
            edge["sourcePlanetId"] in page_planet_ids
            or edge["targetPlanetId"] in page_planet_ids
        )],
    }
    member_ids = list(users)
    relation_targets = set(db.scalars(select(RelationshipRow.target_user_id).where(RelationshipRow.owner_user_id == viewer.id)))
    allowed_owner_ids = {viewer.id, *relation_targets, *member_ids}
    visible_user_ids = {
        user_id for user_id, planet in planets.items()
        if planet.id in visible_planet_ids
    }
    activity_rows = list(db.scalars(select(ActivityPostRow).where(
        ActivityPostRow.owner_user_id.in_(visible_user_ids),
        or_(ActivityPostRow.visibility == "public", ActivityPostRow.owner_user_id.in_(allowed_owner_ids)),
    ).order_by(ActivityPostRow.published_at.desc()).limit(160)))
    activities = [serialize_activity(db, row, viewer.id) for row in activity_rows]
    latest_by_user = {}
    for activity in activities:
        latest_by_user.setdefault(activity["authorUserId"], activity)
    last_events = {row.owner_user_id: row.occurred_at for row in db.scalars(
        select(UserBehaviorEventRow).where(UserBehaviorEventRow.owner_user_id.in_(member_ids)).order_by(UserBehaviorEventRow.occurred_at.desc())
    )}
    members = []
    for membership in memberships:
        user = users.get(membership.user_id)
        planet = planets.get(membership.user_id)
        if not user or not planet or planet.id not in visible_planet_ids or planet.id not in node_by_planet:
            continue
        node = node_by_planet[planet.id]
        activity = latest_by_user.get(user.id)
        members.append({
            "userId": user.id,
            "role": membership.role,
            "joinedAt": membership.joined_at,
            "status": "broadcasting" if activity and activity["broadcast"]["visible"] else "active" if user.id in last_events else "quiet",
            "distance": node["orbitBand"],
            "planet": serialize_planet(user, planet, node["relationshipForce"], (
                node["position"]["x"], node["position"]["y"], node["position"]["z"],
            ), user.id == viewer.id),
            "latestActivityId": activity["id"] if activity else None,
        })
    next_offset = offset + len(page_nodes)
    return {
        "nebula": _summary(db, nebula, viewer.id),
        "graph": {"backend": "sql-property-graph", "version": snapshot["graphVersion"], "edgeCount": len(links)},
        "snapshot": visible_snapshot,
        "members": members,
        "activities": activities,
        "pagination": {
            "offset": offset,
            "limit": limit,
            "total": len(ordered_nodes),
            "nextOffset": next_offset if next_offset < len(ordered_nodes) else None,
            "hasMore": next_offset < len(ordered_nodes),
        },
    }
