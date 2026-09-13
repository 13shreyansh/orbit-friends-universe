"""Add direct user-to-user conversations and messages."""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260725_0014"
down_revision: str | None = "20260725_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "direct_conversations",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="active"),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for column in ("status", "last_message_at"):
        op.create_index(f"ix_direct_conversations_{column}", "direct_conversations", [column])

    op.create_table(
        "direct_conversation_members",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("conversation_id", sa.String(100), sa.ForeignKey("direct_conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("conversation_id", "user_id"),
    )
    for column in ("conversation_id", "user_id"):
        op.create_index(f"ix_direct_conversation_members_{column}", "direct_conversation_members", [column])

    op.create_table(
        "direct_messages",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("conversation_id", sa.String(100), sa.ForeignKey("direct_conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("client_message_id", sa.String(100), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="sent"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("conversation_id", "sender_user_id", "client_message_id"),
    )
    for column in ("conversation_id", "sender_user_id", "status", "created_at"):
        op.create_index(f"ix_direct_messages_{column}", "direct_messages", [column])


def downgrade() -> None:
    op.drop_table("direct_messages")
    op.drop_table("direct_conversation_members")
    op.drop_table("direct_conversations")
