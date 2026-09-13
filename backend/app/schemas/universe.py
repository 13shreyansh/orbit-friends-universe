from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from .base import ApiModel


class ScoreFeature(ApiModel):
    name: str
    value: float = Field(ge=0, le=1)
    weight: float = Field(ge=0, le=1)
    contribution: float = Field(ge=0)
    confidence: float = Field(default=1, ge=0, le=1)


class PlanetScore(ApiModel):
    algorithm_version: Literal["mass.v2"] = "mass.v2"
    mass_score: float = Field(ge=0, le=100)
    physical_mass: float = Field(ge=0)
    visual_radius: float = Field(gt=0)
    confidence: float = Field(ge=0, le=1)
    memory_count: int = Field(default=0, ge=0)
    behavior_event_count: int = Field(default=0, ge=0)
    social_behavior_event_count: int = Field(default=0, ge=0)
    features: list[ScoreFeature]
    computed_at: datetime


class RelationshipSignals(ApiModel):
    profile_affinity: float | None = Field(default=None, ge=0, le=1)
    interaction_frequency: float | None = Field(default=None, ge=0, le=1)
    recency: float | None = Field(default=None, ge=0, le=1)
    shared_experience: float | None = Field(default=None, ge=0, le=1)
    duration: float | None = Field(default=None, ge=0, le=1)
    reciprocity: float | None = Field(default=None, ge=0, le=1)
    semantic_interaction: float | None = Field(default=None, ge=0, le=1)
    trust_emotion: float | None = Field(default=None, ge=0, le=1)
    graph_context: float | None = Field(default=None, ge=0, le=1)
    confidences: dict[str, float] = Field(default_factory=dict)


class RelationshipScore(ApiModel):
    algorithm_version: Literal["relationship.v4"] = "relationship.v4"
    relationship_type: str
    strength: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    profile_affinity: float | None = Field(default=None, ge=0, le=1)
    dynamic_evidence: float = Field(default=0, ge=0, le=1)
    memory_count: int = Field(default=0, ge=0)
    behavior_event_count: int = Field(default=0, ge=0)
    features: list[ScoreFeature]
    profile_features: list[ScoreFeature] = Field(default_factory=list)
    computed_at: datetime


class SpatialVector3(ApiModel):
    x: float
    y: float
    z: float


class SphericalPosition(ApiModel):
    radius: float = Field(ge=0)
    azimuth: float
    elevation: float


class SpatialNodeState(ApiModel):
    planet_id: str
    position: SpatialVector3
    velocity: SpatialVector3 = Field(default_factory=lambda: SpatialVector3(x=0, y=0, z=0))
    gravity_vector: SpatialVector3
    mass: float
    mass_score: float
    visual_radius: float
    relationship_force: float
    cluster_id: str | None = None
    orbit_band: float
    spherical_position: SphericalPosition


class SpatialEdgeState(ApiModel):
    source_planet_id: str
    target_planet_id: str
    strength: float
    rest_length: float
    flow: float


class SpatialBounds(ApiModel):
    radius: float
    center: SpatialVector3


class SpatialSnapshot(ApiModel):
    schema_version: Literal[2] = 2
    coordinate_system: Literal["social-cartesian-v1"] = "social-cartesian-v1"
    layout_algorithm_version: Literal["layout.v2"] = "layout.v2"
    generated_at: datetime
    center_planet_id: str
    graph_version: str
    nodes: list[SpatialNodeState]
    edges: list[SpatialEdgeState]
    bounds: SpatialBounds
