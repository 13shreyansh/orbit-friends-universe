"""Add redacted analysis job deletion audit records."""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260724_0010"
down_revision: str | None = "20260724_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_deleted_at", "users", ["deleted_at"])
    op.add_column(
        "graph_projection_outbox",
        sa.Column("operation", sa.String(20), nullable=False, server_default="upsert"),
    )
    op.create_index("ix_graph_projection_outbox_operation", "graph_projection_outbox", ["operation"])
    op.create_table(
        "analysis_job_deletion_audit",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_id", sa.String(100), nullable=False, unique=True),
        sa.Column("prior_status", sa.String(40), nullable=False),
        sa.Column("input_hash", sa.String(128), nullable=False),
        sa.Column("reason", sa.String(240), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
    )
    for column in ("owner_user_id", "prior_status", "input_hash"):
        op.create_index(f"ix_analysis_job_deletion_audit_{column}", "analysis_job_deletion_audit", [column])
    op.create_table(
        "synthetic_account_deletion_audit",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.String(80),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("email_hash", sa.String(64), nullable=False),
        sa.Column("deleted_job_count", sa.Integer(), nullable=False),
        sa.Column("deleted_conversation_count", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(240), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_synthetic_account_deletion_audit_email_hash", "synthetic_account_deletion_audit", ["email_hash"])


def downgrade() -> None:
    op.drop_table("synthetic_account_deletion_audit")
    op.drop_table("analysis_job_deletion_audit")
    op.drop_index("ix_graph_projection_outbox_operation", table_name="graph_projection_outbox")
    op.drop_column("graph_projection_outbox", "operation")
    op.drop_index("ix_users_deleted_at", table_name="users")
    op.drop_column("users", "deleted_at")
