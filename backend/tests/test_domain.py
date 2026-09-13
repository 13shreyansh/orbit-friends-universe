from datetime import date, datetime, timezone

import pytest

from app.domain.graph_compiler import ProfileGraphCompiler
from app.domain.layout import PlanetBody, RelationshipLink, create_spatial_snapshot
from app.domain.nebula_layout import NebulaBody, build_sparse_member_graph, create_nebula_snapshot
from app.domain.memory_context import StoredMemory, relevant_relationship_memories
from app.domain.planet_generator import PlanetGenerationRequest, planet_generator
from app.domain.profile_affinity import calculate_profile_affinity
from app.domain.semantic_evidence import validate_memory_semantic_evidence
from app.domain.scoring import (
    BehaviorEvidence,
    aggregate_relationship_memory_signals,
    calculate_planet_score,
    calculate_relationship_score,
    deduplicate_memories,
    effective_behavior_evidence_count,
    relationship_rest_length,
)
from app.schemas.memory import MemoryObject
from app.schemas.profile import (
    AchievementInput,
    DateRange,
    EducationInput,
    EducationLevel,
    ProfileIntake,
    PersonalityType,
    ProfileAttributeInput,
    ProjectInput,
    SkillInput,
    Verification,
    WorkInput,
)
from app.infrastructure.semantic_similarity import LocalSemanticSimilarity
from app.infrastructure.semantic_similarity import RemoteEmbeddingSemanticSimilarity
from app.infrastructure.semantic_similarity import ResilientSemanticSimilarity
from app.infrastructure.semantic_similarity import semantic_similarity_from_environment
from app.schemas.universe import RelationshipSignals


NOW = datetime(2026, 7, 23, tzinfo=timezone.utc)


class ConceptEmbeddingClient:
    """Contract-compatible fake; application tests never invoke legacy scoring."""

    def embed_query(self, text: str) -> list[float]:
        normalized = text.casefold()
        if any(value in normalized for value in ("physics", "mathemat", "statistics", "物理", "数学", "统计", "天文")):
            return [1.0, 0.1, 0.0]
        if any(value in normalized for value in ("computer", "software", "计算机", "软件")):
            return [0.2, 1.0, 0.0]
        if any(value in normalized for value in ("film", "cinema", "literature", "影视", "文学")):
            return [0.0, 0.1, 1.0]
        return [0.1, 0.1, 0.1]


class FailingEmbeddingClient:
    def embed_query(self, text: str) -> list[float]:
        raise RuntimeError(f"teammate embedding unavailable for {text}")


class InconsistentEmbeddingClient:
    def embed_query(self, text: str) -> list[float]:
        return [1.0, 0.0] if "physics" in text else [1.0, 0.0, 0.0]


def test_planet_generator_is_deterministic_and_centralizes_system_visuals() -> None:
    request = PlanetGenerationRequest(mode="guide", seed=20453, archetype="crystalline")
    first = planet_generator.generate(request)
    second = planet_generator.generate(request)
    another_owner = planet_generator.generate_for_owner("another-user")

    assert first == second
    assert first["generatorVersion"] == "planet-generator.v1"
    assert first["generationMode"] == "guide"
    assert (another_owner["archetype"], another_owner["seed"]) != (first["archetype"], first["seed"])


def relationship_memory(
    memory_id: str,
    *,
    event_time: date = date(2026, 7, 20),
    change: str = "closer",
    intimacy: float = 90,
    semantic_type: str | None = None,
) -> MemoryObject:
    payload = {
        "id": memory_id,
        "sourceType": "text",
        "rawText": "A long meaningful conversation.",
        "people": [{"id": "friend", "name": "Friend", "isExisting": True}],
        "eventTime": event_time.isoformat(),
        "location": "Shanghai",
        "eventType": "conversation",
        "summary": "We talked and understood each other better.",
        "facts": ["We met"],
        "emotions": [{"name": "warmth", "intensity": intimacy}],
        "relationshipSignals": {
            "interactionFrequency": 88,
            "emotionalIntimacy": intimacy,
            "initiativeBalance": 50,
            "relationshipChange": change,
        },
        "keywords": ["friendship", "conversation"],
        "narrative": "Two worlds moved closer.",
        "confidence": 0.9,
        "analysisProvider": "test-agent",
    }
    if semantic_type:
        payload["semanticEvidence"] = {
            "schemaVersion": "semantic-evidence.v1",
            "interactionType": semantic_type,
            "participation": "direct",
            "direction": "mutual",
            "evidenceSpans": ["meaningful conversation"],
            "confidence": 0.95,
        }
    return MemoryObject.model_validate(payload)


def rich_profile() -> ProfileIntake:
    return ProfileIntake(
        display_name="Atlas",
        bio="Builder, researcher and community mentor.",
        birth_date=date(1994, 3, 12),
        education=[
            EducationInput(
                institution="Example University",
                level=EducationLevel.MASTER,
                field_of_study="Computer Science",
                period=DateRange(start_date=date(2012, 9, 1), end_date=date(2018, 6, 30)),
                verification=Verification.VERIFIED,
            )
        ],
        work=[
            WorkInput(
                organization="Cosmos Labs",
                role="Engineering Lead",
                industry="Software",
                seniority="lead",
                period=DateRange(start_date=date(2018, 7, 1), is_current=True),
                highlights=["Built a platform", "Mentored a team"],
                verification=Verification.VERIFIED,
            )
        ],
        projects=[
            ProjectInput(
                title="Open night school",
                kind="community",
                domain="education",
                description="A recurring public learning program.",
                collaborator_count=8,
                period=DateRange(start_date=date(2021, 1, 1), is_current=True),
                verification=Verification.VERIFIED,
            )
        ],
        skills=[
            SkillInput(name="Python", category="engineering", proficiency=5, verification=Verification.VERIFIED),
            SkillInput(name="Teaching", category="education", proficiency=4),
        ],
        interests=[{"name": "Astronomy", "category": "science"}],
        achievements=[AchievementInput(title="Community award", verification=Verification.VERIFIED)],
    )


def test_profile_graph_is_deterministic_and_graph_native() -> None:
    compiler = ProfileGraphCompiler()
    first = compiler.compile("user-a", rich_profile())
    second = compiler.compile("user-a", rich_profile())

    assert first.graph_version == second.graph_version
    assert {node.kind for node in first.nodes} >= {
        "Person", "EducationExperience", "WorkExperience", "ProjectExperience", "Organization", "Skill"
    }
    assert {edge.type for edge in first.edges} >= {"HAS_EDUCATION", "HAS_WORK", "HAS_PROJECT", "AT_ORGANIZATION"}


def test_profile_graph_preserves_personality_and_unregistered_extension_facts() -> None:
    profile = ProfileIntake(
        display_name="Extensible",
        personality_type=PersonalityType.INTP,
        attributes=[ProfileAttributeInput(
            key="lifestyle.sleep_schedule",
            label="Sleep schedule",
            category="lifestyle",
            value="night-owl",
        )],
    )
    graph = ProfileGraphCompiler().compile("user-extensible", profile)

    assert {"PersonalityType", "ProfileAttribute"} <= {node.kind for node in graph.nodes}
    assert {"HAS_PERSONALITY_TYPE", "HAS_PROFILE_ATTRIBUTE"} <= {edge.type for edge in graph.edges}


def test_richer_verified_profile_gets_more_mass_without_linear_radius_growth() -> None:
    sparse = ProfileIntake(display_name="Sparse")
    sparse_score = calculate_planet_score(sparse, computed_at=NOW)
    rich_score = calculate_planet_score(rich_profile(), computed_at=NOW)

    assert rich_score.mass_score > sparse_score.mass_score
    assert rich_score.visual_radius > sparse_score.visual_radius
    assert rich_score.visual_radius <= 2.1
    assert rich_score.physical_mass <= 100
    assert abs(sum(feature.contribution for feature in rich_score.features) - rich_score.mass_score / 100) < 1e-5


def test_all_structured_memories_contribute_to_planet_mass_without_linear_growth() -> None:
    profile = rich_profile()
    without_memories = calculate_planet_score(profile, computed_at=NOW)
    one_memory = calculate_planet_score(profile, [relationship_memory("m1")], computed_at=NOW)
    many_memories = calculate_planet_score(
        profile,
        [relationship_memory(f"m{index}", event_time=date(2026, 7, max(1, 20 - index))) for index in range(1, 9)],
        computed_at=NOW,
    )

    assert one_memory.algorithm_version == "mass.v2"
    assert one_memory.memory_count == 1
    assert one_memory.mass_score > without_memories.mass_score
    assert many_memories.mass_score > one_memory.mass_score
    assert many_memories.mass_score - one_memory.mass_score < 10


def test_identical_memory_content_with_a_new_id_is_one_piece_of_evidence() -> None:
    first = relationship_memory("memory-original")
    duplicate = first.model_copy(update={"id": "memory-replayed"})

    unique = deduplicate_memories([first, duplicate])
    one_score = calculate_planet_score(rich_profile(), [first], computed_at=NOW)
    replayed_score = calculate_planet_score(rich_profile(), [first, duplicate], computed_at=NOW)

    assert [memory.id for memory in unique] == [first.id]
    assert replayed_score.memory_count == 1
    assert replayed_score.mass_score == one_score.mass_score


def test_own_and_incoming_behavior_change_mass_and_decay_on_hourly_ticks() -> None:
    profile = rich_profile()
    own = [BehaviorEvidence("memory_recorded", 0.8, NOW)]
    incoming = [BehaviorEvidence("relationship_created", 0.7, NOW)]
    baseline = calculate_planet_score(profile, computed_at=NOW)
    active = calculate_planet_score(profile, behavior_events=own, social_behavior_events=incoming, computed_at=NOW)
    decayed = calculate_planet_score(
        profile,
        behavior_events=own,
        social_behavior_events=incoming,
        computed_at=datetime(2027, 1, 23, tzinfo=timezone.utc),
    )

    assert active.behavior_event_count == 1
    assert active.social_behavior_event_count == 1
    assert active.mass_score > baseline.mass_score
    assert decayed.mass_score < active.mass_score


def test_repeated_same_day_behavior_is_capped_for_mass_and_relationships() -> None:
    repeated = [BehaviorEvidence("planet_viewed", 0.04, NOW) for _ in range(30)]
    once_mass = calculate_planet_score(rich_profile(), behavior_events=repeated[:1], computed_at=NOW)
    repeated_mass = calculate_planet_score(rich_profile(), behavior_events=repeated, computed_at=NOW)
    assert repeated_mass.mass_score == once_mass.mass_score

    once_signals = aggregate_relationship_memory_signals(
        0.5,
        [],
        outgoing_behavior=repeated[:1],
        profile_affinity_confidence=1,
        computed_at=NOW,
    )
    repeated_signals = aggregate_relationship_memory_signals(
        0.5,
        [],
        outgoing_behavior=repeated,
        profile_affinity_confidence=1,
        computed_at=NOW,
    )
    assert repeated_signals.interaction_frequency == once_signals.interaction_frequency
    assert effective_behavior_evidence_count(repeated) == 1


def test_teammate_embedding_failure_is_visible_and_never_uses_legacy_fallback() -> None:
    adapter = RemoteEmbeddingSemanticSimilarity(embedding_client=FailingEmbeddingClient())

    with pytest.raises(RuntimeError, match="teammate embedding unavailable"):
        adapter.compare(["physics"], ["mathematics"], dimension="field_of_study")


def test_teammate_embedding_rejects_inconsistent_vector_dimensions() -> None:
    adapter = RemoteEmbeddingSemanticSimilarity(embedding_client=InconsistentEmbeddingClient())

    with pytest.raises(RuntimeError, match="inconsistent dimensions"):
        adapter.compare(["physics"], ["mathematics"], dimension="field_of_study")


def test_test_environment_wraps_teammate_embedding_with_fallback() -> None:
    adapter = semantic_similarity_from_environment()
    assert isinstance(adapter, ResilientSemanticSimilarity)
    assert isinstance(adapter.primary, RemoteEmbeddingSemanticSimilarity)


def test_embedding_failure_uses_deterministic_semantic_fallback() -> None:
    adapter = ResilientSemanticSimilarity(
        RemoteEmbeddingSemanticSimilarity(embedding_client=FailingEmbeddingClient()),
        cooldown_seconds=60,
    )

    result = adapter.compare(["physics"], ["mathematics"], dimension="field_of_study")

    assert result is not None
    assert 0 <= result <= 1


def test_legacy_semantics_require_double_opt_in(monkeypatch) -> None:
    monkeypatch.setenv("SOCIAL_COSMOS_SEMANTIC_PROVIDER", "legacy_local")
    monkeypatch.delenv("SOCIAL_COSMOS_ENABLE_LEGACY_SEMANTIC", raising=False)

    with pytest.raises(RuntimeError, match="Legacy semantic similarity is hidden"):
        semantic_similarity_from_environment()

    monkeypatch.setenv("SOCIAL_COSMOS_ENABLE_LEGACY_SEMANTIC", "true")

    assert isinstance(semantic_similarity_from_environment(), LocalSemanticSimilarity)


def test_relationship_v4_aggregates_every_relevant_memory() -> None:
    memories = [relationship_memory("m1"), relationship_memory("m2", event_time=date(2026, 6, 20))]
    signals = aggregate_relationship_memory_signals(0.5, memories, profile_affinity_confidence=1, computed_at=NOW)
    score = calculate_relationship_score("friend", signals, memory_count=len(memories), computed_at=NOW)

    assert score.algorithm_version == "relationship.v4"
    assert score.memory_count == 2
    assert score.strength > 0.25
    assert signals.shared_experience > 0
    assert signals.recency > 0
    family_score = calculate_relationship_score("family", signals, memory_count=len(memories), computed_at=NOW)
    assert family_score.strength == score.strength
    assert all(feature.name != "relationship_type_prior" for feature in score.features)


def test_relationship_v4_consumes_backend_weighted_semantic_evidence() -> None:
    supportive = relationship_memory("support", semantic_type="support")
    conflict = relationship_memory("conflict", semantic_type="conflict")
    supportive_signals = aggregate_relationship_memory_signals(
        0.5, [supportive], profile_affinity_confidence=1, computed_at=NOW,
    )
    conflict_signals = aggregate_relationship_memory_signals(
        0.5, [conflict], profile_affinity_confidence=1, computed_at=NOW,
    )
    supportive_score = calculate_relationship_score(
        "friend", supportive_signals, memory_count=1, computed_at=NOW,
    )
    conflict_score = calculate_relationship_score(
        "friend", conflict_signals, memory_count=1, computed_at=NOW,
    )

    assert supportive_signals.semantic_interaction > 0.5
    assert conflict_signals.semantic_interaction < 0.5
    assert supportive_score.strength > conflict_score.strength
    assert any(feature.name == "semantic_interaction" for feature in supportive_score.features)


def test_semantic_evidence_span_must_exist_in_raw_source() -> None:
    forged = relationship_memory("forged", semantic_type="support").model_copy(
        update={"semantic_evidence": relationship_memory("valid", semantic_type="support").semantic_evidence.model_copy(
            update={"evidence_spans": ["invented quote"]},
        )},
    )

    with pytest.raises(ValueError, match="not present"):
        validate_memory_semantic_evidence(forged)


def test_bilateral_memory_context_includes_both_users_and_excludes_unrelated_memories() -> None:
    from_owner = relationship_memory("owner-memory")
    from_target = relationship_memory("target-memory").model_copy(
        update={"people": [from_owner.people[0].model_copy(update={"id": "owner"})]},
    )
    unrelated = relationship_memory("unrelated").model_copy(
        update={"people": [from_owner.people[0].model_copy(update={"id": "someone-else"})]},
    )
    selected = relevant_relationship_memories(
        [
            StoredMemory("owner", "rel-owner-target", from_owner),
            StoredMemory("target", "rel-target-owner", from_target),
            StoredMemory("target", None, unrelated),
        ],
        owner_user_id="owner",
        target_user_id="target",
        relationship_ids={"rel-owner-target", "rel-target-owner"},
    )

    assert {memory.id for memory in selected} == {"owner-memory", "target-memory"}


def test_duplicate_skills_do_not_inflate_score_linearly() -> None:
    one = ProfileIntake(display_name="One", skills=[SkillInput(name="Python", proficiency=5)])
    duplicates = ProfileIntake(
        display_name="Many",
        skills=[SkillInput(name="Python", proficiency=5) for _ in range(20)],
    )
    assert calculate_planet_score(duplicates, computed_at=NOW).mass_score == calculate_planet_score(one, computed_at=NOW).mass_score


def test_relationship_score_has_no_subjective_type_prior() -> None:
    empty = calculate_relationship_score("friend", RelationshipSignals(), computed_at=NOW)
    close = calculate_relationship_score(
        "friend",
        RelationshipSignals(
            profile_affinity=0.95,
            interaction_frequency=0.9,
            recency=0.92,
            shared_experience=0.8,
            reciprocity=0.9,
            confidences={"profile_affinity": 1, "interaction_frequency": 1, "recency": 1},
        ),
        memory_count=3,
        computed_at=NOW,
    )
    assert empty.strength == 0
    assert empty.confidence == 0
    assert close.strength > empty.strength


def test_profile_affinity_uses_semantics_and_renormalizes_missing_personality() -> None:
    similarity = RemoteEmbeddingSemanticSimilarity(embedding_client=ConceptEmbeddingClient())
    physics = ProfileIntake(
        display_name="Physics",
        education=[EducationInput(institution="A", level="bachelor", field_of_study="物理学")],
        interests=[{"name": "天文学"}],
    )
    mathematics = ProfileIntake(
        display_name="Math",
        education=[EducationInput(institution="B", level="bachelor", field_of_study="数学")],
        interests=[{"name": "统计学"}],
    )
    cinema_computing = ProfileIntake(
        display_name="Cinema Computing",
        education=[EducationInput(institution="C", level="bachelor", field_of_study="计算机科学")],
        interests=[{"name": "影视文学"}],
    )

    nearby = calculate_profile_affinity(physics, mathematics, similarity)
    distant = calculate_profile_affinity(physics, cinema_computing, similarity)

    assert nearby.score is not None and distant.score is not None
    assert nearby.score > distant.score
    assert all(feature.name != "personality_similarity" for feature in nearby.features)


def test_personality_is_structured_similarity_not_a_manual_relationship_score() -> None:
    similarity = LocalSemanticSimilarity()
    intp = ProfileIntake(display_name="INTP", personality_type=PersonalityType.INTP)
    intj = ProfileIntake(display_name="INTJ", personality_type=PersonalityType.INTJ)
    result = calculate_profile_affinity(intp, intj, similarity)

    assert result.score == 0.8
    assert result.features[0].name == "personality_similarity"


def test_stronger_relationship_has_shorter_collision_safe_distance() -> None:
    close = relationship_rest_length(0.95, 1.5, 1.2)
    distant = relationship_rest_length(0.2, 1.5, 1.2)
    assert close < distant
    assert close >= 1.5 + 1.2 + 0.35 - 1e-9


def test_layout_is_deterministic_and_keeps_center_fixed() -> None:
    bodies = [
        PlanetBody("a", 80, 80, 1.8),
        PlanetBody("b", 60, 60, 1.5),
        PlanetBody("c", 40, 40, 1.2),
    ]
    links = [RelationshipLink("a", "b", 0.9), RelationshipLink("a", "c", 0.3)]
    first = create_spatial_snapshot("a", bodies, links, "g1", generated_at=NOW)
    second = create_spatial_snapshot("a", bodies, links, "g1", generated_at=NOW)

    assert first == second
    center = next(node for node in first.nodes if node.planet_id == "a")
    close = next(node for node in first.nodes if node.planet_id == "b")
    distant = next(node for node in first.nodes if node.planet_id == "c")
    assert center.position.x == center.position.y == center.position.z == 0
    assert close.orbit_band < distant.orbit_band
    assert first.layout_algorithm_version == "layout.v2"
    for node in first.nodes:
        assert abs(node.spherical_position.radius - node.orbit_band) < 1e-6


def test_nebula_layout_scales_to_one_thousand_simulated_members_without_dense_edges() -> None:
    import time

    bodies = [
        NebulaBody(
            user_id=f"sim-user-{index}",
            planet_id=f"sim-planet-{index}",
            physical_mass=35 + index % 90,
            visual_radius=0.8 + (index % 7) * 0.08,
            feature_keys=frozenset({
                f"Interest:interest-{index % 19}",
                f"Place:city-{index % 31}",
                f"Skill:skill-{index % 43}",
            }),
        )
        for index in range(1000)
    ]
    started_at = time.perf_counter()
    links = build_sparse_member_graph(bodies)
    snapshot = create_nebula_snapshot(
        "sim-nebula",
        "sim-user-0",
        bodies,
        links,
        "sim-graph-v1",
        generated_at=NOW,
    )
    elapsed = time.perf_counter() - started_at

    assert len(snapshot["nodes"]) == 1000
    assert len(links) <= len(bodies) * 3
    assert len(snapshot["edges"]) == len(links)
    assert snapshot["coordinateSystem"] == "social-spherical-v1"
    assert snapshot["layoutAlgorithmVersion"] == "nebula.layout.v5"
    assert elapsed < 5


def test_nebula_member_distance_is_not_doubled_for_display() -> None:
    bodies = [
        NebulaBody("viewer", "planet-viewer", 50, 1, frozenset()),
        NebulaBody("member", "planet-member", 50, 1, frozenset()),
    ]
    snapshot = create_nebula_snapshot(
        "compact-nebula",
        "viewer",
        bodies,
        [],
        "compact-graph-v1",
        generated_at=NOW,
    )
    member = next(node for node in snapshot["nodes"] if node["planetId"] == "planet-member")

    assert member["orbitBand"] == pytest.approx(relationship_rest_length(0.035, 1, 1))


def test_nebula_graph_keeps_explicit_links_and_caps_inferred_degree() -> None:
    bodies = [
        NebulaBody(
            user_id=f"member-{index}",
            planet_id=f"planet-{index}",
            physical_mass=50,
            visual_radius=1,
            feature_keys=frozenset({"Interest:shared", f"Skill:{index % 3}"}),
        )
        for index in range(30)
    ]
    explicit = {("member-0", f"member-{index}"): 0.9 for index in range(1, 10)}

    links = build_sparse_member_graph(bodies, explicit, max_neighbors_per_member=4)
    explicit_pairs = {
        tuple(sorted((link.source_user_id, link.target_user_id)))
        for link in links
        if "relationship:explicit" in link.basis
    }
    inferred_degree = {body.user_id: 0 for body in bodies}
    for link in links:
        if "relationship:explicit" in link.basis:
            continue
        inferred_degree[link.source_user_id] += 1
        inferred_degree[link.target_user_id] += 1

    assert explicit_pairs == {tuple(sorted(pair)) for pair in explicit}
    assert max(inferred_degree.values()) <= 4
