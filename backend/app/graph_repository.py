from __future__ import annotations

import json
import os
from typing import Any, Protocol

from app.schemas.graph import ProfileGraphDocument


NODE_KINDS = {
    "Person",
    "Place",
    "Organization",
    "EducationExperience",
    "WorkExperience",
    "ProjectExperience",
    "Skill",
    "Interest",
    "Achievement",
    "PersonalityType",
    "ProfileAttribute",
}

EDGE_TYPES = {
    "BORN_IN",
    "LIVED_IN",
    "HAS_EDUCATION",
    "HAS_WORK",
    "HAS_PROJECT",
    "HAS_SKILL",
    "INTERESTED_IN",
    "HAS_ACHIEVEMENT",
    "HAS_PERSONALITY_TYPE",
    "HAS_PROFILE_ATTRIBUTE",
    "AT_ORGANIZATION",
    "OCCURRED_AT",
    "SHARED_CONTEXT",
}


class GraphProjectionRepository(Protocol):
    backend_name: str

    def project(self, graph: ProfileGraphDocument) -> None: ...
    def close(self) -> None: ...
    def health(self) -> dict[str, Any]: ...


class LocalGraphProjection:
    """The SQL graph_nodes/graph_edges tables are the local projection."""

    backend_name = "sql-property-graph"

    def project(self, graph: ProfileGraphDocument) -> None:
        return None

    def close(self) -> None:
        return None

    def health(self) -> dict[str, Any]:
        return {"backend": self.backend_name, "status": "ok"}


class Neo4jGraphProjection:
    """Neo4j projection of the versioned graph document.

    Nodes use the compiler's deterministic id as a global entity key, so two
    users who reference the same canonical organization or place converge on
    the same graph entity. Relationships remain scoped to the profile owner.
    """

    backend_name = "neo4j"

    def __init__(self, uri: str, username: str, password: str, database: str = "neo4j") -> None:
        try:
            from neo4j import GraphDatabase
        except ImportError as error:
            raise RuntimeError("Neo4j support requires the 'neo4j' Python package") from error
        self.driver = GraphDatabase.driver(uri, auth=(username, password))
        self.database = database
        self._last_error = ""
        self._ensure_constraints()

    def _ensure_constraints(self) -> None:
        with self.driver.session(database=self.database) as session:
            session.run(
                "CREATE CONSTRAINT graph_entity_key IF NOT EXISTS "
                "FOR (n:GraphEntity) REQUIRE n.entity_key IS UNIQUE"
            ).consume()

    def project(self, graph: ProfileGraphDocument) -> None:
        invalid_nodes = {node.kind for node in graph.nodes} - NODE_KINDS
        invalid_edges = {edge.type for edge in graph.edges} - EDGE_TYPES
        if invalid_nodes or invalid_edges:
            raise ValueError(f"unsupported graph ontology: nodes={sorted(invalid_nodes)}, edges={sorted(invalid_edges)}")
        try:
            with self.driver.session(database=self.database) as session:
                session.execute_write(self._replace_projection, graph)
            self._last_error = ""
        except Exception as error:
            self._last_error = str(error)
            raise

    @staticmethod
    def _replace_projection(tx: Any, graph: ProfileGraphDocument) -> None:
        tx.run(
            "MATCH ()-[r:PROFILE_EDGE {projection_owner: $owner}]->() DELETE r",
            owner=graph.owner_user_id,
        ).consume()
        for node in graph.nodes:
            properties = _safe_properties(node.kind, node.properties)
            tx.run(
                "MERGE (n:GraphEntity {entity_key: $entity_key}) "
                "SET n.kind = $kind, n.label = $label, n.properties_json = $properties_json, "
                "n.updated_graph_version = $graph_version",
                entity_key=node.id,
                kind=node.kind,
                label=node.label,
                properties_json=json.dumps(properties, ensure_ascii=False, sort_keys=True),
                graph_version=graph.graph_version,
            ).consume()
        for edge in graph.edges:
            tx.run(
                "MATCH (source:GraphEntity {entity_key: $source}), (target:GraphEntity {entity_key: $target}) "
                "MERGE (source)-[r:PROFILE_EDGE {edge_key: $edge_key, projection_owner: $owner}]->(target) "
                "SET r.edge_type = $edge_type, r.properties_json = $properties_json, r.graph_version = $graph_version",
                source=edge.source,
                target=edge.target,
                edge_key=edge.id,
                owner=graph.owner_user_id,
                edge_type=edge.type,
                properties_json=json.dumps(_safe_edge_properties(edge.properties), ensure_ascii=False, sort_keys=True),
                graph_version=graph.graph_version,
            ).consume()

    def health(self) -> dict[str, Any]:
        try:
            self.driver.verify_connectivity()
            return {"backend": self.backend_name, "status": "ok"}
        except Exception as error:
            self._last_error = str(error)
            return {"backend": self.backend_name, "status": "degraded", "error": self._last_error[:240]}

    def close(self) -> None:
        self.driver.close()


def _safe_properties(kind: str, properties: dict[str, Any]) -> dict[str, Any]:
    blocked = {"bio", "latitude", "longitude"}
    if kind == "Person":
        allowed = {"user_id", "display_name"}
        return {key: value for key, value in properties.items() if key in allowed}
    return {key: value for key, value in properties.items() if key not in blocked}


def _safe_edge_properties(properties: dict[str, Any]) -> dict[str, Any]:
    result = dict(properties)
    if "birth_date" in result and result["birth_date"]:
        result["birth_year"] = str(result.pop("birth_date"))[:4]
    return result


def graph_repository_from_environment() -> GraphProjectionRepository:
    uri = os.getenv("NEO4J_URI", "").strip()
    if not uri:
        return LocalGraphProjection()
    return Neo4jGraphProjection(
        uri=uri,
        username=os.getenv("NEO4J_USERNAME", "neo4j"),
        password=os.getenv("NEO4J_PASSWORD", ""),
        database=os.getenv("NEO4J_DATABASE", "neo4j"),
    )
