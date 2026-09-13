"""Add relationship-scoped memory sharing and per-user memory signals."""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260725_0015"
down_revision: str | None = "20260725_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "memory_shares",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("memory_id", sa.String(100), sa.ForeignKey("memories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_relationship_id", sa.String(80), sa.ForeignKey("relationships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient_relationship_id", sa.String(80), sa.ForeignKey("relationships.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("memory_id", "recipient_user_id"),
    )
    for column in ("memory_id", "owner_user_id", "recipient_user_id", "owner_relationship_id", "recipient_relationship_id", "status"):
        op.create_index(f"ix_memory_shares_{column}", "memory_shares", [column])

    op.create_table(
        "memory_signals",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("memory_id", sa.String(100), sa.ForeignKey("memories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_planet_id", sa.String(80), sa.ForeignKey("planets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("target_planet_id", sa.String(80), sa.ForeignKey("planets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("memory_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for column in ("memory_id", "sender_user_id", "recipient_user_id", "source_planet_id", "target_planet_id", "active", "created_at"):
        op.create_index(f"ix_memory_signals_{column}", "memory_signals", [column])

    op.create_table(
        "memory_signal_receipts",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("signal_id", sa.String(100), sa.ForeignKey("memory_signals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("viewer_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("signal_id", "viewer_user_id"),
    )
    for column in ("signal_id", "viewer_user_id"):
        op.create_index(f"ix_memory_signal_receipts_{column}", "memory_signal_receipts", [column])


def downgrade() -> None:
    op.drop_table("memory_signal_receipts")
    op.drop_table("memory_signals")
    op.drop_table("memory_shares")
