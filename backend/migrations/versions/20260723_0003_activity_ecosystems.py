"""Add activity posts and their ecosystem effects."""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260723_0003"
down_revision: str | None = "20260723_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "activity_posts",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("planet_id", sa.String(80), sa.ForeignKey("planets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_json", sa.Text(), nullable=False),
        sa.Column("media_json", sa.Text(), nullable=False),
        sa.Column("ecosystem_json", sa.Text(), nullable=False),
        sa.Column("visibility", sa.String(30), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_activity_posts_owner_user_id", "activity_posts", ["owner_user_id"])
    op.create_index("ix_activity_posts_planet_id", "activity_posts", ["planet_id"])
    op.create_index("ix_activity_posts_visibility", "activity_posts", ["visibility"])
    op.create_index("ix_activity_posts_published_at", "activity_posts", ["published_at"])


def downgrade() -> None:
    op.drop_table("activity_posts")
