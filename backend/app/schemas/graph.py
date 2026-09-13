from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from .base import ApiModel


class GraphNode(ApiModel):
    id: str
    kind: str
    label: str
    properties: dict[str, Any] = Field(default_factory=dict)


class GraphEdge(ApiModel):
    id: str
    source: str
    target: str
    type: str
    properties: dict[str, Any] = Field(default_factory=dict)


class GraphOntology(ApiModel):
    shape: Literal["property_graph"] = "property_graph"
    node_kinds: list[str] = Field(default_factory=list)
    edge_types: list[str] = Field(default_factory=list)


class ProfileGraphDocument(ApiModel):
    graph_id: str
    owner_user_id: str
    schema_version: Literal["profile_graph.v1"] = "profile_graph.v1"
    graph_version: str
    ontology: GraphOntology
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    metadata: dict[str, Any] = Field(default_factory=dict)

