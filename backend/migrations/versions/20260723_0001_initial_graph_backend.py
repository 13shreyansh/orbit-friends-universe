"""Initial Social Cosmos graph backend schema."""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260723_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("display_name", sa.String(80), nullable=False),
        sa.Column("bio", sa.Text(), nullable=False),
        sa.Column("tags_json", sa.Text(), nullable=False),
        sa.Column("intake_json", sa.Text(), nullable=False),
        sa.Column("planet_id", sa.String(80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "auth_sessions",
        sa.Column("token", sa.String(128), primary_key=True),
        sa.Column("user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])

    op.create_table(
        "planets",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("identity_json", sa.Text(), nullable=False),
        sa.Column("visual_json", sa.Text(), nullable=False),
        sa.Column("score_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_planets_owner_user_id", "planets", ["owner_user_id"], unique=True)

    op.create_table(
        "relationships",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relation_type", sa.String(40), nullable=False),
        sa.Column("identity_label", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("declared_strength", sa.Float(), nullable=False),
        sa.Column("signals_json", sa.Text(), nullable=False),
        sa.Column("score_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("started_at", sa.String(30), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_user_id", "target_user_id"),
    )
    op.create_index("ix_relationships_owner_user_id", "relationships", ["owner_user_id"])
    op.create_index("ix_relationships_target_user_id", "relationships", ["target_user_id"])

    op.create_table(
        "profile_graph_documents",
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("graph_version", sa.String(80), nullable=False),
        sa.Column("document_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_profile_graph_documents_graph_version", "profile_graph_documents", ["graph_version"])

    op.create_table(
        "graph_projection_outbox",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("graph_version", sa.String(80), nullable=False),
        sa.Column("document_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("projected_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("owner_user_id", "graph_version"),
    )
    op.create_index("ix_graph_projection_outbox_owner_user_id", "graph_projection_outbox", ["owner_user_id"])
    op.create_index("ix_graph_projection_outbox_graph_version", "graph_projection_outbox", ["graph_version"])
    op.create_index("ix_graph_projection_outbox_status", "graph_projection_outbox", ["status"])

    op.create_table(
        "graph_nodes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("graph_version", sa.String(80), nullable=False),
        sa.Column("node_id", sa.String(160), nullable=False),
        sa.Column("kind", sa.String(80), nullable=False),
        sa.Column("label", sa.String(240), nullable=False),
        sa.Column("properties_json", sa.Text(), nullable=False),
        sa.UniqueConstraint("owner_user_id", "graph_version", "node_id"),
    )
    for column in ("owner_user_id", "graph_version", "node_id", "kind"):
        op.create_index(f"ix_graph_nodes_{column}", "graph_nodes", [column])

    op.create_table(
        "graph_edges",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("graph_version", sa.String(80), nullable=False),
        sa.Column("edge_id", sa.String(160), nullable=False),
        sa.Column("source_node_id", sa.String(160), nullable=False),
        sa.Column("target_node_id", sa.String(160), nullable=False),
        sa.Column("edge_type", sa.String(80), nullable=False),
        sa.Column("properties_json", sa.Text(), nullable=False),
        sa.UniqueConstraint("owner_user_id", "graph_version", "edge_id"),
    )
    for column in ("owner_user_id", "graph_version", "edge_id", "source_node_id", "target_node_id", "edge_type"):
        op.create_index(f"ix_graph_edges_{column}", "graph_edges", [column])

    op.create_table(
        "spatial_snapshots",
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("graph_version", sa.String(80), nullable=False),
        sa.Column("snapshot_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_spatial_snapshots_graph_version", "spatial_snapshots", ["graph_version"])

    op.create_table(
        "memories",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relationship_id", sa.String(80), sa.ForeignKey("relationships.id", ondelete="SET NULL"), nullable=True),
        sa.Column("memory_json", sa.Text(), nullable=False),
        sa.Column("event_time", sa.String(30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_memories_owner_user_id", "memories", ["owner_user_id"])
    op.create_index("ix_memories_relationship_id", "memories", ["relationship_id"])
    op.create_index("ix_memories_event_time", "memories", ["event_time"])

    op.create_table(
        "timeline_entries",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relationship_id", sa.String(80), sa.ForeignKey("relationships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_time", sa.String(30), nullable=False),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("intimacy", sa.Float(), nullable=False),
        sa.Column("interaction_frequency", sa.Float(), nullable=False),
        sa.Column("emotional_tone", sa.String(80), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("source_memory_id", sa.String(100), sa.ForeignKey("memories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_timeline_entries_owner_user_id", "timeline_entries", ["owner_user_id"])
    op.create_index("ix_timeline_entries_relationship_id", "timeline_entries", ["relationship_id"])
    op.create_index("ix_timeline_entries_event_time", "timeline_entries", ["event_time"])


def downgrade() -> None:
    for table in (
        "timeline_entries",
        "memories",
        "spatial_snapshots",
        "graph_edges",
        "graph_nodes",
        "graph_projection_outbox",
        "profile_graph_documents",
        "relationships",
        "planets",
        "auth_sessions",
        "users",
    ):
        op.drop_table(table)
