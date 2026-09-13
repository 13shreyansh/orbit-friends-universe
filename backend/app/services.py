"""Backward-compatible imports for the pre-refactor service module.

New code should import from ``app.application`` modules directly. Keeping this
facade prevents workers, seeds, extensions, and teammate code from breaking in
the same release as the internal decomposition.
"""

from app.application.activity import serialize_activity, visible_activities
from app.application.behavior import record_user_behavior
from app.application.graph_projection import project_graph_outbox, store_profile_graph
from app.application.profile import (
    default_visual,
    ensure_user_projection,
    serialize_planet,
    serialize_profile,
    upsert_intake,
)
from app.application.scoring import (
    calculate_current_planet_score,
    calculate_current_relationship_score,
    owned_memory_objects,
    simulation_tick,
)
from app.application.serialization import content_dedupe_key, dumps, loads, new_id
from app.application.universe import get_cosmos, recompute_universe

__all__ = [
    "calculate_current_planet_score",
    "calculate_current_relationship_score",
    "content_dedupe_key",
    "default_visual",
    "dumps",
    "ensure_user_projection",
    "get_cosmos",
    "loads",
    "new_id",
    "owned_memory_objects",
    "project_graph_outbox",
    "recompute_universe",
    "record_user_behavior",
    "serialize_activity",
    "serialize_planet",
    "serialize_profile",
    "simulation_tick",
    "store_profile_graph",
    "upsert_intake",
    "visible_activities",
]
