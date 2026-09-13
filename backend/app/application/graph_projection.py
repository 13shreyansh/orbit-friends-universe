from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import GraphDocumentRow, GraphEdgeRow, GraphNodeRow, GraphProjectionOutboxRow
from app.domain.graph_compiler import ProfileGraphCompiler
from app.graph_repository import GraphProjectionRepository
from app.schemas.graph import ProfileGraphDocument
from app.schemas.profile import ProfileIntake

from .serialization import dumps, loads


def store_profile_graph(db: Session, user_id: str, profile: ProfileIntake) -> ProfileGraphDocument:
    graph = ProfileGraphCompiler().compile(user_id, profile)
    db.execute(delete(GraphNodeRow).where(GraphNodeRow.owner_user_id == user_id))
    db.execute(delete(GraphEdgeRow).where(GraphEdgeRow.owner_user_id == user_id))
    current = db.get(GraphDocumentRow, user_id)
    if current:
        current.graph_version = graph.graph_version
        current.document_json = dumps(graph)
        current.created_at = datetime.now(timezone.utc)
    else:
        db.add(GraphDocumentRow(owner_user_id=user_id, graph_version=graph.graph_version, document_json=dumps(graph)))
    outbox = db.scalar(select(GraphProjectionOutboxRow).where(
        GraphProjectionOutboxRow.owner_user_id == user_id,
        GraphProjectionOutboxRow.graph_version == graph.graph_version,
    ))
    if not outbox:
        db.add(GraphProjectionOutboxRow(
            owner_user_id=user_id,
            graph_version=graph.graph_version,
            document_json=dumps(graph),
        ))
    db.add_all(
        GraphNodeRow(
            owner_user_id=user_id,
            graph_version=graph.graph_version,
            node_id=node.id,
            kind=node.kind,
            label=node.label,
            properties_json=dumps(node.properties),
        )
        for node in graph.nodes
    )
    db.add_all(
        GraphEdgeRow(
            owner_user_id=user_id,
            graph_version=graph.graph_version,
            edge_id=edge.id,
            source_node_id=edge.source,
            target_node_id=edge.target,
            edge_type=edge.type,
            properties_json=dumps(edge.properties),
        )
        for edge in graph.edges
    )
    db.flush()
    return graph


def project_graph_outbox(
    db: Session,
    repository: GraphProjectionRepository,
    *,
    owner_user_id: str | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    statement = select(GraphProjectionOutboxRow).where(GraphProjectionOutboxRow.status != "completed")
    if owner_user_id:
        statement = statement.where(GraphProjectionOutboxRow.owner_user_id == owner_user_id)
    statement = statement.order_by(GraphProjectionOutboxRow.id).limit(limit).with_for_update(skip_locked=True)
    rows = list(db.scalars(statement))
    completed = 0
    failed = 0
    for row in rows:
        row.attempts += 1
        row.updated_at = datetime.now(timezone.utc)
        try:
            if row.operation == "delete":
                repository.delete_owner(row.owner_user_id)
            else:
                graph = ProfileGraphDocument.model_validate(loads(row.document_json, {}))
                repository.project(graph)
            row.status = "completed"
            row.last_error = ""
            row.projected_at = datetime.now(timezone.utc)
            completed += 1
        except Exception as error:
            row.status = "failed"
            row.last_error = str(error)[:2000]
            failed += 1
    db.flush()
    return {
        "backend": repository.backend_name,
        "processed": len(rows),
        "completed": completed,
        "failed": failed,
    }

