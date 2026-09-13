from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import datetime, timezone

from app.domain.scoring import relationship_rest_length
from app.schemas.universe import (
    SphericalPosition,
    SpatialBounds,
    SpatialEdgeState,
    SpatialNodeState,
    SpatialSnapshot,
    SpatialVector3,
)


@dataclass(frozen=True)
class PlanetBody:
    planet_id: str
    physical_mass: float
    mass_score: float
    visual_radius: float


@dataclass(frozen=True)
class RelationshipLink:
    source_planet_id: str
    target_planet_id: str
    strength: float


@dataclass(frozen=True)
class SphericalCoordinate:
    radius: float
    azimuth: float
    elevation: float


def stable_spherical_coordinate(key: str, radius: float) -> SphericalCoordinate:
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    u = int.from_bytes(digest[:8], "big") / (2**64 - 1)
    v = int.from_bytes(digest[8:16], "big") / (2**64 - 1)
    return SphericalCoordinate(
        radius=radius,
        azimuth=2 * math.pi * v,
        elevation=math.asin(2 * u - 1),
    )


def spherical_to_cartesian(coordinate: SphericalCoordinate) -> list[float]:
    horizontal = coordinate.radius * math.cos(coordinate.elevation)
    return [
        horizontal * math.cos(coordinate.azimuth),
        coordinate.radius * math.sin(coordinate.elevation),
        horizontal * math.sin(coordinate.azimuth),
    ]


def cartesian_to_spherical(vector: list[float]) -> SphericalCoordinate:
    radius = _length(vector)
    if radius == 0:
        return SphericalCoordinate(radius=0, azimuth=0, elevation=0)
    return SphericalCoordinate(
        radius=radius,
        azimuth=math.atan2(vector[2], vector[0]),
        elevation=math.asin(max(-1.0, min(1.0, vector[1] / radius))),
    )


def _direction(key: str) -> list[float]:
    return spherical_to_cartesian(stable_spherical_coordinate(key, 1.0))


def _length(vector: list[float]) -> float:
    return math.sqrt(sum(value * value for value in vector))


def create_spatial_snapshot(
    center_planet_id: str,
    bodies: list[PlanetBody],
    links: list[RelationshipLink],
    graph_version: str,
    *,
    previous_positions: dict[str, tuple[float, float, float]] | None = None,
    iterations: int = 180,
    generated_at: datetime | None = None,
) -> SpatialSnapshot:
    body_by_id = {body.planet_id: body for body in bodies}
    if center_planet_id not in body_by_id:
        raise ValueError("center planet must be included in bodies")
    previous_positions = previous_positions or {}
    center_links = {
        link.target_planet_id if link.source_planet_id == center_planet_id else link.source_planet_id: link
        for link in links
        if center_planet_id in {link.source_planet_id, link.target_planet_id}
    }
    positions: dict[str, list[float]] = {center_planet_id: [0.0, 0.0, 0.0]}
    for body in sorted(bodies, key=lambda item: item.planet_id):
        if body.planet_id == center_planet_id:
            continue
        if body.planet_id in previous_positions:
            positions[body.planet_id] = list(previous_positions[body.planet_id])
            continue
        link = center_links.get(body.planet_id)
        center = body_by_id[center_planet_id]
        distance = relationship_rest_length(link.strength, center.visual_radius, body.visual_radius) if link else 16.0
        coordinate = stable_spherical_coordinate(
            f"layout.v2|{center_planet_id}|{body.planet_id}",
            distance,
        )
        positions[body.planet_id] = spherical_to_cartesian(coordinate)

    ordered_ids = sorted(body_by_id)
    for iteration in range(max(0, iterations)):
        forces = {planet_id: [0.0, 0.0, 0.0] for planet_id in ordered_ids}
        for link in links:
            if link.source_planet_id not in positions or link.target_planet_id not in positions:
                continue
            source = positions[link.source_planet_id]
            target = positions[link.target_planet_id]
            delta = [target[axis] - source[axis] for axis in range(3)]
            distance = _length(delta) or 1e-6
            desired = relationship_rest_length(
                link.strength,
                body_by_id[link.source_planet_id].visual_radius,
                body_by_id[link.target_planet_id].visual_radius,
            )
            magnitude = (0.08 + 0.20 * link.strength) * (distance - desired)
            for axis in range(3):
                force = magnitude * delta[axis] / distance
                forces[link.source_planet_id][axis] += force
                forces[link.target_planet_id][axis] -= force

        for left_index, left_id in enumerate(ordered_ids):
            for right_id in ordered_ids[left_index + 1 :]:
                delta = [positions[right_id][axis] - positions[left_id][axis] for axis in range(3)]
                distance = _length(delta)
                if distance < 1e-8:
                    delta = _direction(f"collision|{left_id}|{right_id}")
                    distance = 1e-3
                minimum = body_by_id[left_id].visual_radius + body_by_id[right_id].visual_radius + 0.35
                repulsion = 0.35 / max(distance * distance, 0.25)
                if distance < minimum:
                    repulsion += 0.9 * (minimum - distance)
                for axis in range(3):
                    force = repulsion * delta[axis] / distance
                    forces[left_id][axis] -= force
                    forces[right_id][axis] += force

        if previous_positions:
            for planet_id, previous in previous_positions.items():
                if planet_id == center_planet_id or planet_id not in positions:
                    continue
                for axis in range(3):
                    forces[planet_id][axis] += 0.025 * (previous[axis] - positions[planet_id][axis])

        step = 0.16 * (1 - iteration / max(iterations, 1)) + 0.015
        for planet_id in ordered_ids:
            if planet_id == center_planet_id:
                continue
            for axis in range(3):
                positions[planet_id][axis] += max(-0.6, min(0.6, forces[planet_id][axis])) * step

    node_states: list[SpatialNodeState] = []
    for planet_id in ordered_ids:
        body = body_by_id[planet_id]
        position = positions[planet_id]
        distance = _length(position)
        strength = center_links.get(planet_id).strength if planet_id in center_links else (1.0 if planet_id == center_planet_id else 0.0)
        gravity_magnitude = (body.physical_mass / 100) * (0.3 + strength)
        gravity = [(-value / distance) * gravity_magnitude if distance else 0.0 for value in position]
        spherical = cartesian_to_spherical(position)
        node_states.append(
            SpatialNodeState(
                planet_id=planet_id,
                position=SpatialVector3(x=position[0], y=position[1], z=position[2]),
                gravity_vector=SpatialVector3(x=gravity[0], y=gravity[1], z=gravity[2]),
                mass=body.physical_mass,
                mass_score=body.mass_score,
                visual_radius=body.visual_radius,
                relationship_force=strength,
                cluster_id="self" if planet_id == center_planet_id else ("inner-circle" if strength >= 0.72 else "extended-circle"),
                orbit_band=distance,
                spherical_position=SphericalPosition(
                    radius=spherical.radius,
                    azimuth=spherical.azimuth,
                    elevation=spherical.elevation,
                ),
            )
        )
    edge_states = [
        SpatialEdgeState(
            source_planet_id=link.source_planet_id,
            target_planet_id=link.target_planet_id,
            strength=link.strength,
            rest_length=relationship_rest_length(
                link.strength,
                body_by_id[link.source_planet_id].visual_radius,
                body_by_id[link.target_planet_id].visual_radius,
            ),
            flow=0.25 + 0.75 * link.strength,
        )
        for link in links
        if link.source_planet_id in body_by_id and link.target_planet_id in body_by_id
    ]
    bounds_radius = max(10.0, *(state.orbit_band + state.visual_radius for state in node_states))
    return SpatialSnapshot(
        generated_at=generated_at or datetime.now(timezone.utc),
        center_planet_id=center_planet_id,
        graph_version=graph_version,
        nodes=node_states,
        edges=edge_states,
        bounds=SpatialBounds(radius=bounds_radius, center=SpatialVector3(x=0, y=0, z=0)),
    )

