from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import datetime, timezone

from app.domain.layout import spherical_to_cartesian, stable_spherical_coordinate
from app.domain.scoring import relationship_rest_length

NEBULA_GRAPH_ALGORITHM_VERSION = "nebula.graph.v3"
NEBULA_LAYOUT_ALGORITHM_VERSION = "nebula.layout.v5"
# The relationship rest length is already expressed in scene-space units.
# Doubling it made a group's member universe unnecessarily sparse and forced
# the camera so far back that planets became difficult to inspect.
NEBULA_RADIAL_SCALE = 1.0
NEBULA_COLLISION_PADDING = 0.75
NEBULA_COLLISION_SCALE = 1.15


@dataclass(frozen=True)
class NebulaBody:
    user_id: str
    planet_id: str
    physical_mass: float
    visual_radius: float
    feature_keys: frozenset[str]


@dataclass(frozen=True)
class NebulaGraphLink:
    source_user_id: str
    target_user_id: str
    strength: float
    basis: tuple[str, ...]


def _separate_overlapping_nodes(
    nodes: list[dict],
    bodies: list[NebulaBody],
    center_planet_id: str,
    *,
    iterations: int = 18,
) -> None:
    """Deterministically separate rendered planet spheres without moving the viewer."""
    body_by_planet = {body.planet_id: body for body in bodies}
    node_by_planet = {node["planetId"]: node for node in nodes}
    ordered_ids = sorted(node_by_planet)
    max_visual_radius = max(body.visual_radius for body in bodies)
    cell_size = max_visual_radius * 2 * NEBULA_COLLISION_SCALE + NEBULA_COLLISION_PADDING
    for _ in range(max(0, iterations)):
        moved = False
        cells: dict[tuple[int, int, int], list[str]] = {}
        for planet_id in ordered_ids:
            position = node_by_planet[planet_id]["position"]
            cell = tuple(math.floor(position[axis] / cell_size) for axis in ("x", "y", "z"))
            cells.setdefault(cell, []).append(planet_id)

        for left_id in ordered_ids:
            left = node_by_planet[left_id]["position"]
            left_cell = tuple(math.floor(left[axis] / cell_size) for axis in ("x", "y", "z"))
            nearby_ids = []
            for x_offset in (-1, 0, 1):
                for y_offset in (-1, 0, 1):
                    for z_offset in (-1, 0, 1):
                        nearby_ids.extend(cells.get((
                            left_cell[0] + x_offset,
                            left_cell[1] + y_offset,
                            left_cell[2] + z_offset,
                        ), ()))
            for right_id in sorted(right_id for right_id in nearby_ids if right_id > left_id):
                right = node_by_planet[right_id]["position"]
                delta = [right[axis] - left[axis] for axis in ("x", "y", "z")]
                distance = math.sqrt(sum(value * value for value in delta))
                if distance < 1e-8:
                    direction = stable_spherical_coordinate(
                        f"{NEBULA_LAYOUT_ALGORITHM_VERSION}|collision|{left_id}|{right_id}",
                        1.0,
                    )
                    delta = spherical_to_cartesian(direction)
                    distance = 1.0
                minimum = (
                    body_by_planet[left_id].visual_radius
                    + body_by_planet[right_id].visual_radius
                ) * NEBULA_COLLISION_SCALE + NEBULA_COLLISION_PADDING
                if distance >= minimum:
                    continue
                moved = True
                overlap = minimum - distance
                left_share = 0.0 if left_id == center_planet_id else (1.0 if right_id == center_planet_id else 0.5)
                right_share = 0.0 if right_id == center_planet_id else (1.0 if left_id == center_planet_id else 0.5)
                for axis_index, axis in enumerate(("x", "y", "z")):
                    unit = delta[axis_index] / distance
                    left[axis] -= unit * overlap * left_share
                    right[axis] += unit * overlap * right_share
        if not moved:
            break

    for node in nodes:
        position = node["position"]
        radius = math.sqrt(sum(position[axis] ** 2 for axis in ("x", "y", "z")))
        node["orbitBand"] = radius
        node["sphericalPosition"]["radius"] = radius
        length = radius or 1.0
        gravity = math.sqrt(sum(node["gravityVector"][axis] ** 2 for axis in ("x", "y", "z")))
        node["gravityVector"] = {
            axis: -position[axis] / length * gravity
            for axis in ("x", "y", "z")
        }


def build_sparse_member_graph(
    bodies: list[NebulaBody],
    explicit_strengths: dict[tuple[str, str], float] | None = None,
    *,
    neighbors_per_feature: int = 3,
    max_neighbors_per_member: int = 4,
) -> list[NebulaGraphLink]:
    explicit_strengths = explicit_strengths or {}
    members_by_feature: dict[str, list[str]] = {}
    for body in bodies:
        for feature in body.feature_keys:
            members_by_feature.setdefault(feature, []).append(body.user_id)

    pair_basis: dict[tuple[str, str], set[str]] = {}
    for feature, member_ids in members_by_feature.items():
        ordered = sorted(set(member_ids))
        count = len(ordered)
        if count < 2:
            continue
        for index, source in enumerate(ordered):
            for offset in range(1, min(neighbors_per_feature, count - 1) + 1):
                target = ordered[(index + offset) % count]
                pair = tuple(sorted((source, target)))
                pair_basis.setdefault(pair, set()).add(feature)

    for pair in explicit_strengths:
        pair_basis.setdefault(tuple(sorted(pair)), set()).add("relationship:explicit")

    candidates = []
    for pair, basis in sorted(pair_basis.items()):
        explicit = explicit_strengths.get(pair) or explicit_strengths.get((pair[1], pair[0]))
        strength = explicit if explicit is not None else min(0.78, 0.1 + len(basis) * 0.11)
        candidates.append(NebulaGraphLink(pair[0], pair[1], round(strength, 6), tuple(sorted(basis))))

    # Explicit relationships are product facts and are always retained. Feature
    # similarity only fills the remaining local degree budget so a large shared
    # community cannot become a visually meaningless near-complete graph.
    explicit_links = [link for link in candidates if "relationship:explicit" in link.basis]
    inferred_links = [link for link in candidates if "relationship:explicit" not in link.basis]
    degree = {body.user_id: 0 for body in bodies}
    links = []
    for link in sorted(explicit_links, key=lambda item: (-item.strength, item.source_user_id, item.target_user_id)):
        links.append(link)
        degree[link.source_user_id] += 1
        degree[link.target_user_id] += 1
    for link in sorted(inferred_links, key=lambda item: (-item.strength, item.source_user_id, item.target_user_id)):
        if degree[link.source_user_id] >= max_neighbors_per_member:
            continue
        if degree[link.target_user_id] >= max_neighbors_per_member:
            continue
        links.append(link)
        degree[link.source_user_id] += 1
        degree[link.target_user_id] += 1
    return links


def create_nebula_snapshot(
    nebula_id: str,
    viewer_user_id: str,
    bodies: list[NebulaBody],
    links: list[NebulaGraphLink],
    graph_version: str,
    *,
    generated_at: datetime | None = None,
) -> dict:
    generated_at = generated_at or datetime.now(timezone.utc)
    body_by_user = {body.user_id: body for body in bodies}
    viewer = body_by_user.get(viewer_user_id)
    if viewer is None:
        raise ValueError("viewer must be a nebula member")

    direct: dict[str, NebulaGraphLink] = {}
    for link in links:
        if link.source_user_id == viewer_user_id:
            direct[link.target_user_id] = link
        elif link.target_user_id == viewer_user_id:
            direct[link.source_user_id] = link

    nodes = []
    max_radius = 8.0
    for body in sorted(bodies, key=lambda item: item.user_id):
        if body.user_id == viewer_user_id:
            position = [0.0, 0.0, 0.0]
            strength = 1.0
            cluster_id = "self"
            spherical = {"radius": 0.0, "azimuth": 0.0, "elevation": 0.0}
        else:
            link = direct.get(body.user_id)
            shared_features = viewer.feature_keys.intersection(body.feature_keys)
            strength = link.strength if link else min(0.78, 0.1 + len(shared_features) * 0.11) if shared_features else 0.035
            radius = relationship_rest_length(strength, viewer.visual_radius, body.visual_radius) * NEBULA_RADIAL_SCALE
            cluster_key = next(
                (item for item in (link.basis if link else tuple(sorted(shared_features))) if not item.startswith("relationship:")),
                "community",
            )
            coordinate = stable_spherical_coordinate(
                f"{NEBULA_LAYOUT_ALGORITHM_VERSION}|{nebula_id}|{viewer_user_id}|{cluster_key}|{body.user_id}",
                radius,
            )
            position = spherical_to_cartesian(coordinate)
            cluster_id = f"cluster-{hashlib.sha1(cluster_key.encode('utf-8')).hexdigest()[:8]}"
            spherical = {
                "radius": coordinate.radius,
                "azimuth": coordinate.azimuth,
                "elevation": coordinate.elevation,
            }
            max_radius = max(max_radius, radius + body.visual_radius)
        length = math.sqrt(sum(value * value for value in position)) or 1.0
        gravity = min(2.5, body.physical_mass / 100 * (0.25 + strength))
        nodes.append({
            "planetId": body.planet_id,
            "position": {"x": position[0], "y": position[1], "z": position[2]},
            "velocity": {"x": 0.0, "y": 0.0, "z": 0.0},
            "gravityVector": {
                "x": -position[0] / length * gravity,
                "y": -position[1] / length * gravity,
                "z": -position[2] / length * gravity,
            },
            "mass": body.physical_mass,
            "relationshipForce": strength,
            "clusterId": cluster_id,
            "orbitBand": spherical["radius"],
            "sphericalPosition": spherical,
        })

    _separate_overlapping_nodes(nodes, bodies, viewer.planet_id)
    body_by_planet = {body.planet_id: body for body in bodies}
    max_radius = max(
        8.0,
        *(node["orbitBand"] + body_by_planet[node["planetId"]].visual_radius for node in nodes),
    )

    planet_by_user = {body.user_id: body.planet_id for body in bodies}
    spatial_edges = [{
        "sourcePlanetId": planet_by_user[link.source_user_id],
        "targetPlanetId": planet_by_user[link.target_user_id],
        "strength": link.strength,
        "restLength": relationship_rest_length(
            link.strength,
            body_by_user[link.source_user_id].visual_radius,
            body_by_user[link.target_user_id].visual_radius,
        ) * NEBULA_RADIAL_SCALE,
        "flow": 0.2 + link.strength * 0.8,
    } for link in links]
    return {
        "schemaVersion": 2,
        "coordinateSystem": "social-spherical-v1",
        "layoutAlgorithmVersion": NEBULA_LAYOUT_ALGORITHM_VERSION,
        "graphVersion": graph_version,
        "generatedAt": generated_at.isoformat(),
        "centerPlanetId": viewer.planet_id,
        "nodes": nodes,
        "edges": spatial_edges,
        "bounds": {"radius": round(max_radius, 6), "center": {"x": 0, "y": 0, "z": 0}},
    }
