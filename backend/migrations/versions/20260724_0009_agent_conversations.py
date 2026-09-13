"""Add persisted Agent conversations, runs, citations, feedback, and proposal provenance."""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260724_0009"
down_revision: str | None = "20260724_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_conversations",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("mode", sa.String(40), nullable=False),
        sa.Column("relationship_id", sa.String(80), sa.ForeignKey("relationships.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for column in ("owner_user_id", "mode", "relationship_id", "status", "last_message_at"):
        op.create_index(f"ix_agent_conversations_{column}", "agent_conversations", [column])

    op.create_table(
        "agent_messages",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", sa.String(100), sa.ForeignKey("agent_conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("client_message_id", sa.String(80), nullable=True),
        sa.Column("memory_draft_id", sa.String(100), sa.ForeignKey("memory_drafts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("conversation_id", "client_message_id"),
    )
    for column in ("owner_user_id", "conversation_id", "role", "status", "memory_draft_id", "created_at"):
        op.create_index(f"ix_agent_messages_{column}", "agent_messages", [column])

    op.create_table(
        "agent_runs",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", sa.String(100), sa.ForeignKey("agent_conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_message_id", sa.String(100), sa.ForeignKey("agent_messages.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("assistant_message_id", sa.String(100), sa.ForeignKey("agent_messages.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("provider", sa.String(120), nullable=False),
        sa.Column("retrieval_degraded", sa.Boolean(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    for column in ("owner_user_id", "conversation_id", "status"):
        op.create_index(f"ix_agent_runs_{column}", "agent_runs", [column])

    op.create_table(
        "agent_run_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", sa.String(100), sa.ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("run_id", "sequence"),
    )
    for column in ("owner_user_id", "run_id", "event_type"):
        op.create_index(f"ix_agent_run_events_{column}", "agent_run_events", [column])

    op.create_table(
        "agent_message_citations",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", sa.String(100), sa.ForeignKey("agent_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("memory_id", sa.String(100), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("event_time", sa.String(30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("message_id", "memory_id"),
    )
    for column in ("owner_user_id", "message_id", "memory_id"):
        op.create_index(f"ix_agent_message_citations_{column}", "agent_message_citations", [column])

    op.create_table(
        "agent_message_feedback",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", sa.String(100), sa.ForeignKey("agent_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rating", sa.String(30), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_user_id", "message_id"),
    )
    for column in ("owner_user_id", "message_id", "rating"):
        op.create_index(f"ix_agent_message_feedback_{column}", "agent_message_feedback", [column])

    op.add_column("memory_sources", sa.Column("agent_conversation_id", sa.String(100), nullable=True))
    op.add_column("memory_sources", sa.Column("agent_message_id", sa.String(100), nullable=True))
    op.create_index("ix_memory_sources_agent_conversation_id", "memory_sources", ["agent_conversation_id"])
    op.create_index("ix_memory_sources_agent_message_id", "memory_sources", ["agent_message_id"])


def downgrade() -> None:
    op.drop_index("ix_memory_sources_agent_message_id", table_name="memory_sources")
    op.drop_index("ix_memory_sources_agent_conversation_id", table_name="memory_sources")
    op.drop_column("memory_sources", "agent_message_id")
    op.drop_column("memory_sources", "agent_conversation_id")
    op.drop_table("agent_message_feedback")
    op.drop_table("agent_message_citations")
    op.drop_table("agent_run_events")
    op.drop_table("agent_runs")
    op.drop_table("agent_messages")
    op.drop_table("agent_conversations")
