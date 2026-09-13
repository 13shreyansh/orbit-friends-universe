import json

import pytest

from app.domain.graph_compiler import ProfileGraphCompiler
from app.graph_repository import EDGE_TYPES, NODE_KINDS, Neo4jGraphProjection
from app.schemas.graph import GraphNode
from app.schemas.profile import EducationInput, PlaceInput, ProfileIntake, WorkInput


class _Consumed:
    def consume(self):
        return self


class _RecordingTransaction:
    def __init__(self) -> None:
        self.calls = []

    def run(self, query, **parameters):
        self.calls.append((query, parameters))
        return _Consumed()


def _graph(user_id: str, organization: str = "Cosmos Labs"):
    return ProfileGraphCompiler().compile(
        user_id,
        ProfileIntake(
            display_name=f"User {user_id}",
            bio="private biography",
            birth_date="1994-03-12",
            birth_place=PlaceInput(
                name="Suzhou",
                country_code="CN",
                latitude=31.2989,
                longitude=120.5853,
            ),
            education=[EducationInput(institution=organization, level="bachelor")],
            work=[WorkInput(organization=organization, role="Engineer")],
        ),
    )


def test_neo4j_projection_enforces_ontology_whitelist() -> None:
    graph = _graph("a")
    invalid = graph.model_copy(update={
        "nodes": [*graph.nodes, GraphNode(id="x", kind="ExecutablePlugin", label="unsafe")],
    })
    projection = Neo4jGraphProjection.__new__(Neo4jGraphProjection)

    with pytest.raises(ValueError, match="unsupported graph ontology"):
        projection.project(invalid)


def test_neo4j_projection_accepts_current_profile_ontology() -> None:
    assert {"PersonalityType", "ProfileAttribute"} <= NODE_KINDS
    assert {"HAS_PERSONALITY_TYPE", "HAS_PROFILE_ATTRIBUTE"} <= EDGE_TYPES


def test_neo4j_projection_redacts_private_profile_fields() -> None:
    graph = _graph("a")
    transaction = _RecordingTransaction()
    Neo4jGraphProjection._replace_projection(transaction, graph)

    node_calls = [params for query, params in transaction.calls if "MERGE (n:GraphEntity" in query]
    edge_calls = [params for query, params in transaction.calls if "PROFILE_EDGE" in query and "edge_key" in params]
    person = next(json.loads(call["properties_json"]) for call in node_calls if call["kind"] == "Person")
    place = next(json.loads(call["properties_json"]) for call in node_calls if call["kind"] == "Place")
    born_in = next(json.loads(call["properties_json"]) for call in edge_calls if call["edge_type"] == "BORN_IN")

    assert "bio" not in person
    assert "latitude" not in place and "longitude" not in place
    assert born_in["birth_year"] == "1994"
    assert "birth_date" not in born_in


def test_canonical_organization_merges_to_same_neo4j_entity_key() -> None:
    first = _graph("a", "Cosmos Labs")
    second = _graph("b", "  cosmos   labs ")
    first_key = next(node.id for node in first.nodes if node.kind == "Organization")
    second_key = next(node.id for node in second.nodes if node.kind == "Organization")

    assert first_key == second_key
