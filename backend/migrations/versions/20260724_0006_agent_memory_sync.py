"""Add Agent Memory session/sync state and integration outbox leases."""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260724_0006"
down_revision: str | None = "20260723_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("integration_outbox", sa.Column("claim_token", sa.String(100), nullable=True))
    op.add_column("integration_outbox", sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("integration_outbox", sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("integration_outbox", sa.Column("dead_lettered_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_integration_outbox_claim_token", "integration_outbox", ["claim_token"])
    op.create_index("ix_integration_outbox_lease_expires_at", "integration_outbox", ["lease_expires_at"])

    op.create_table(
        "agent_memory_sessions",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(80), nullable=False),
        sa.Column("session_key", sa.String(240), nullable=False),
        sa.Column("external_session_id", sa.String(240), nullable=False),
        sa.Column("object_key", sa.String(160), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("last_commit_task_id", sa.String(240), nullable=True),
        sa.Column("last_commit_status", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_user_id", "provider", "session_key"),
        sa.UniqueConstraint("owner_user_id", "provider", "external_session_id"),
    )
    for column in (
        "owner_user_id",
        "provider",
        "object_key",
        "status",
        "last_commit_task_id",
    ):
        op.create_index(f"ix_agent_memory_sessions_{column}", "agent_memory_sessions", [column])

    op.create_table(
        "agent_memory_sync_state",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(80), nullable=False),
        sa.Column("object_key", sa.String(160), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column(
            "session_id",
            sa.String(100),
            sa.ForeignKey("agent_memory_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "outbox_id",
            sa.Integer(),
            sa.ForeignKey("integration_outbox.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("external_task_id", sa.String(240), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_user_id", "provider", "object_key"),
    )
    for column in (
        "owner_user_id",
        "provider",
        "object_key",
        "status",
        "session_id",
        "outbox_id",
        "external_task_id",
    ):
        op.create_index(f"ix_agent_memory_sync_state_{column}", "agent_memory_sync_state", [column])


def downgrade() -> None:
    op.drop_table("agent_memory_sync_state")
    op.drop_table("agent_memory_sessions")
    op.drop_index("ix_integration_outbox_lease_expires_at", table_name="integration_outbox")
    op.drop_index("ix_integration_outbox_claim_token", table_name="integration_outbox")
    op.drop_column("integration_outbox", "dead_lettered_at")
    op.drop_column("integration_outbox", "lease_expires_at")
    op.drop_column("integration_outbox", "claimed_at")
    op.drop_column("integration_outbox", "claim_token")
