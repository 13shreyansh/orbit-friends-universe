"""Add dynamic user behavior events."""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260723_0002"
down_revision: str | None = "20260723_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_behavior_events",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("weight", sa.Float(), nullable=False),
        sa.Column("dedupe_key", sa.String(200), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_user_id", "dedupe_key"),
    )
    op.create_index("ix_user_behavior_events_owner_user_id", "user_behavior_events", ["owner_user_id"])
    op.create_index("ix_user_behavior_events_target_user_id", "user_behavior_events", ["target_user_id"])
    op.create_index("ix_user_behavior_events_event_type", "user_behavior_events", ["event_type"])
    op.create_index("ix_user_behavior_events_occurred_at", "user_behavior_events", ["occurred_at"])


def downgrade() -> None:
    op.drop_table("user_behavior_events")
