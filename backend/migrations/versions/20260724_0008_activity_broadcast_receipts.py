"""Add closable activity broadcasts and per-viewer read receipts."""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260724_0008"
down_revision: str | None = "20260724_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # SQLite development bootstrapping uses metadata.create_all, which may have
    # already created the new receipt table without altering activity_posts.
    # Guard both operations so that such partially bootstrapped databases can
    # still be upgraded safely.
    inspector = sa.inspect(op.get_bind())
    activity_columns = {column["name"] for column in inspector.get_columns("activity_posts")}
    activity_indexes = {index["name"] for index in inspector.get_indexes("activity_posts")}
    with op.batch_alter_table("activity_posts") as batch_op:
        if "signal_active" not in activity_columns:
            batch_op.add_column(sa.Column("signal_active", sa.Boolean(), nullable=False, server_default=sa.true()))
        if "ix_activity_posts_signal_active" not in activity_indexes:
            batch_op.create_index("ix_activity_posts_signal_active", ["signal_active"])

    inspector = sa.inspect(op.get_bind())
    if "activity_broadcast_receipts" not in inspector.get_table_names():
        op.create_table(
            "activity_broadcast_receipts",
            sa.Column("id", sa.String(100), primary_key=True),
            sa.Column("activity_id", sa.String(100), sa.ForeignKey("activity_posts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("viewer_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("activity_id", "viewer_user_id"),
        )
    receipt_indexes = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("activity_broadcast_receipts")}
    if "ix_activity_broadcast_receipts_activity_id" not in receipt_indexes:
        op.create_index("ix_activity_broadcast_receipts_activity_id", "activity_broadcast_receipts", ["activity_id"])
    if "ix_activity_broadcast_receipts_viewer_user_id" not in receipt_indexes:
        op.create_index("ix_activity_broadcast_receipts_viewer_user_id", "activity_broadcast_receipts", ["viewer_user_id"])


def downgrade() -> None:
    op.drop_table("activity_broadcast_receipts")
    with op.batch_alter_table("activity_posts") as batch_op:
        batch_op.drop_index("ix_activity_posts_signal_active")
        batch_op.drop_column("signal_active")
