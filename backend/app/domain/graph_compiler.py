from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from datetime import date
from enum import Enum
from typing import Any

from app.schemas.graph import GraphEdge, GraphNode, GraphOntology, ProfileGraphDocument
from app.schemas.profile import PlaceInput, ProfileIntake


def _json_value(value: Any) -> Any:
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    return value


def _canonical(value: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", value.strip().lower()).strip("-")


def _stable_id(kind: str, *parts: str) -> str:
    payload = "|".join(str(part).strip().lower() for part in parts)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
    return f"{kind}:{digest}"


class _Builder:
    def __init__(self) -> None:
        self.nodes: dict[str, GraphNode] = {}
        self.edges: dict[str, GraphEdge] = {}

    def node(self, node_id: str, kind: str, label: str, properties: dict[str, Any] | None = None) -> str:
        data = _json_value(properties or {})
        if node_id in self.nodes:
            current = self.nodes[node_id]
            self.nodes[node_id] = current.model_copy(update={"properties": {**current.properties, **data}})
        else:
            self.nodes[node_id] = GraphNode(id=node_id, kind=kind, label=label, properties=data)
        return node_id

    def edge(self, source: str, target: str, edge_type: str, properties: dict[str, Any] | None = None) -> None:
        data = _json_value(properties or {})
        encoded = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        edge_id = _stable_id("edge", source, edge_type, target, encoded)
        self.edges.setdefault(edge_id, GraphEdge(id=edge_id, source=source, target=target, type=edge_type, properties=data))


class ProfileGraphCompiler:
    """Compile validated profile intake into a deterministic property graph."""

    def compile(self, user_id: str, profile: ProfileIntake) -> ProfileGraphDocument:
        builder = _Builder()
        person_id = f"person:{user_id}"
        builder.node(
            person_id,
            "Person",
            profile.display_name,
            {
                "user_id": user_id,
                "display_name": profile.display_name,
                "bio": profile.bio,
                "personality_type": profile.personality_type,
            },
        )
        if profile.personality_type:
            personality_id = _stable_id("personality", profile.personality_type.value)
            builder.node(personality_id, "PersonalityType", profile.personality_type.value)
            builder.edge(person_id, personality_id, "HAS_PERSONALITY_TYPE")
        if profile.birth_place:
            place = self._place(builder, profile.birth_place)
            builder.edge(person_id, place, "BORN_IN", {"birth_date": profile.birth_date})

        for index, residence in enumerate(profile.residences):
            place = self._place(builder, residence.place)
            builder.edge(person_id, place, "LIVED_IN", {"period": residence.period.model_dump(), "order": index})

        for index, education in enumerate(profile.education):
            experience_id = _stable_id("education", user_id, education.institution, str(index), str(education.period.start_date))
            builder.node(experience_id, "EducationExperience", education.institution, education.model_dump(exclude={"place"}))
            organization_id = self._organization(builder, education.institution, "school")
            builder.edge(person_id, experience_id, "HAS_EDUCATION", {"order": index})
            builder.edge(experience_id, organization_id, "AT_ORGANIZATION")
            if education.place:
                builder.edge(experience_id, self._place(builder, education.place), "OCCURRED_AT")

        for index, work in enumerate(profile.work):
            experience_id = _stable_id("work", user_id, work.organization, work.role, str(index), str(work.period.start_date))
            builder.node(experience_id, "WorkExperience", f"{work.role} · {work.organization}", work.model_dump(exclude={"place"}))
            organization_id = self._organization(builder, work.organization, "company")
            builder.edge(person_id, experience_id, "HAS_WORK", {"order": index})
            builder.edge(experience_id, organization_id, "AT_ORGANIZATION")
            if work.place:
                builder.edge(experience_id, self._place(builder, work.place), "OCCURRED_AT")

        for index, project in enumerate(profile.projects):
            node_id = _stable_id("project", user_id, project.title, str(index), str(project.period.start_date))
            builder.node(node_id, "ProjectExperience", project.title, project.model_dump())
            builder.edge(person_id, node_id, "HAS_PROJECT", {"order": index})

        for skill in profile.skills:
            node_id = _stable_id("skill", _canonical(skill.name))
            builder.node(node_id, "Skill", skill.name, {"canonical_name": _canonical(skill.name), "category": skill.category})
            builder.edge(person_id, node_id, "HAS_SKILL", {"proficiency": skill.proficiency, "verification": skill.verification})

        for interest in profile.interests:
            node_id = _stable_id("interest", _canonical(interest.name))
            builder.node(node_id, "Interest", interest.name, {"canonical_name": _canonical(interest.name), "category": interest.category})
            builder.edge(person_id, node_id, "INTERESTED_IN")

        for index, achievement in enumerate(profile.achievements):
            node_id = _stable_id("achievement", user_id, achievement.title, str(index), str(achievement.occurred_at))
            builder.node(node_id, "Achievement", achievement.title, achievement.model_dump())
            builder.edge(person_id, node_id, "HAS_ACHIEVEMENT")

        for index, attribute in enumerate(profile.attributes):
            node_id = _stable_id("attribute", user_id, attribute.key, str(index))
            builder.node(
                node_id,
                "ProfileAttribute",
                attribute.label or attribute.key,
                attribute.model_dump(),
            )
            builder.edge(person_id, node_id, "HAS_PROFILE_ATTRIBUTE", {"key": attribute.key})

        nodes = sorted(builder.nodes.values(), key=lambda item: item.id)
        edges = sorted(builder.edges.values(), key=lambda item: item.id)
        content = {
            "owner": user_id,
            "nodes": [item.model_dump(mode="json") for item in nodes],
            "edges": [item.model_dump(mode="json") for item in edges],
        }
        graph_version = hashlib.sha256(
            json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:20]
        node_counts = Counter(node.kind for node in nodes)
        edge_counts = Counter(edge.type for edge in edges)
        return ProfileGraphDocument(
            graph_id=f"profile-graph:{user_id}",
            owner_user_id=user_id,
            graph_version=graph_version,
            ontology=GraphOntology(node_kinds=sorted(node_counts), edge_types=sorted(edge_counts)),
            nodes=nodes,
            edges=edges,
            metadata={"compiled_by": "ProfileGraphCompiler", "node_counts": dict(node_counts), "edge_counts": dict(edge_counts)},
        )

    @staticmethod
    def _place(builder: _Builder, place: PlaceInput) -> str:
        key = "|".join(filter(None, [_canonical(place.name), (place.country_code or "").lower()]))
        node_id = _stable_id("place", key)
        return builder.node(node_id, "Place", place.name, {**place.model_dump(), "canonical_key": key})

    @staticmethod
    def _organization(builder: _Builder, name: str, organization_type: str) -> str:
        key = f"{organization_type}|{_canonical(name)}"
        node_id = _stable_id("organization", key)
        return builder.node(node_id, "Organization", name, {"canonical_key": key, "organization_type": organization_type})
