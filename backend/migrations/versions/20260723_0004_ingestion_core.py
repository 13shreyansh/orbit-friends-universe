"""Add ingestion media, jobs, drafts, and source provenance."""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260723_0004"
down_revision: str | None = "20260723_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "media_assets",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_asset_id", sa.String(100), sa.ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("storage_key", sa.String(500), nullable=False, unique=True),
        sa.Column("storage_url", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(128), nullable=False),
        sa.Column("mime_type", sa.String(160), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for column in ("owner_user_id", "parent_asset_id", "kind", "status", "content_hash"):
        op.create_index(f"ix_media_assets_{column}", "media_assets", [column])

    op.create_table(
        "analysis_jobs",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_type", sa.String(40), nullable=False),
        sa.Column("source_type", sa.String(30), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(120), nullable=False),
        sa.Column("input_hash", sa.String(128), nullable=False),
        sa.Column("input_json", sa.Text(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    for column in ("owner_user_id", "job_type", "source_type", "status", "input_hash"):
        op.create_index(f"ix_analysis_jobs_{column}", "analysis_jobs", [column])

    op.create_table(
        "memory_drafts",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_id", sa.String(100), sa.ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relationship_id", sa.String(80), sa.ForeignKey("relationships.id", ondelete="SET NULL"), nullable=True),
        sa.Column("candidate_memory_id", sa.String(100), nullable=False),
        sa.Column("schema_version", sa.String(40), nullable=False),
        sa.Column("candidate_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("confirmed_memory_id", sa.String(100), sa.ForeignKey("memories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("job_id", "candidate_memory_id"),
    )
    for column in (
        "owner_user_id",
        "job_id",
        "relationship_id",
        "candidate_memory_id",
        "status",
        "confirmed_memory_id",
        "expires_at",
    ):
        op.create_index(f"ix_memory_drafts_{column}", "memory_drafts", [column])

    op.create_table(
        "memory_sources",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("owner_user_id", sa.String(80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("analysis_job_id", sa.String(100), sa.ForeignKey("analysis_jobs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("draft_id", sa.String(100), sa.ForeignKey("memory_drafts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("memory_id", sa.String(100), sa.ForeignKey("memories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("media_asset_id", sa.String(100), sa.ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_type", sa.String(30), nullable=False),
        sa.Column("source_order", sa.Integer(), nullable=False),
        sa.Column("content_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "analysis_job_id IS NOT NULL OR draft_id IS NOT NULL OR memory_id IS NOT NULL",
            name="ck_memory_sources_has_parent",
        ),
        sa.UniqueConstraint("analysis_job_id", "source_order"),
    )
    for column in (
        "owner_user_id",
        "analysis_job_id",
        "draft_id",
        "memory_id",
        "media_asset_id",
        "source_type",
    ):
        op.create_index(f"ix_memory_sources_{column}", "memory_sources", [column])


def downgrade() -> None:
    for table in ("memory_sources", "memory_drafts", "analysis_jobs", "media_assets"):
        op.drop_table(table)
