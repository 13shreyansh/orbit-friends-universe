"""Add provider metrics and request correlation to Agent runs."""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260724_0011"
down_revision: str | None = "20260724_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    columns = (
        sa.Column("creation_request_id", sa.String(128), nullable=True),
        sa.Column("execution_request_id", sa.String(128), nullable=True),
        sa.Column("provider_request_id", sa.String(255), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("provider_latency_ms", sa.Integer(), nullable=True),
        sa.Column("total_latency_ms", sa.Integer(), nullable=True),
        sa.Column("first_token_latency_ms", sa.Integer(), nullable=True),
        sa.Column("estimated_cost_microusd", sa.Integer(), nullable=True),
    )
    for column in columns:
        op.add_column("agent_runs", column)
    for column in ("creation_request_id", "execution_request_id", "provider_request_id"):
        op.create_index(f"ix_agent_runs_{column}", "agent_runs", [column])


def downgrade() -> None:
    for column in ("provider_request_id", "execution_request_id", "creation_request_id"):
        op.drop_index(f"ix_agent_runs_{column}", table_name="agent_runs")
    for column in (
        "estimated_cost_microusd",
        "first_token_latency_ms",
        "total_latency_ms",
        "provider_latency_ms",
        "total_tokens",
        "completion_tokens",
        "prompt_tokens",
        "provider_request_id",
        "execution_request_id",
        "creation_request_id",
    ):
        op.drop_column("agent_runs", column)
