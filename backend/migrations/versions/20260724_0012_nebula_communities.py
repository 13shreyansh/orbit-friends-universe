"""Add real nebula communities, membership graph edges and spatial snapshots."""

import hashlib
from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260724_0012"
down_revision: str | None = "20260724_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _tables()
    if "nebulae" not in tables:
        op.create_table(
            "nebulae",
            sa.Column("id", sa.String(length=80), primary_key=True),
            sa.Column("slug", sa.String(length=120), nullable=False),
            sa.Column("join_code", sa.String(length=16), nullable=False),
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("owner_user_id", sa.String(length=80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("theme_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_nebulae_slug", "nebulae", ["slug"], unique=True)
        op.create_index("ix_nebulae_join_code", "nebulae", ["join_code"], unique=True)
        op.create_index("ix_nebulae_owner_user_id", "nebulae", ["owner_user_id"])
    else:
        columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("nebulae")}
        if "join_code" not in columns:
            with op.batch_alter_table("nebulae") as batch:
                batch.add_column(sa.Column("join_code", sa.String(length=16), nullable=True))
            rows = op.get_bind().execute(sa.text("SELECT id FROM nebulae")).fetchall()
            for row in rows:
                join_code = hashlib.sha1(str(row.id).encode("utf-8")).hexdigest()[:8].upper()
                op.get_bind().execute(
                    sa.text("UPDATE nebulae SET join_code = :join_code WHERE id = :id"),
                    {"join_code": join_code, "id": row.id},
                )
            with op.batch_alter_table("nebulae") as batch:
                batch.alter_column("join_code", existing_type=sa.String(length=16), nullable=False)
                batch.create_index("ix_nebulae_join_code", ["join_code"], unique=True)

    tables = _tables()
    if "nebula_members" not in tables:
        op.create_table(
            "nebula_members",
            sa.Column("id", sa.String(length=100), primary_key=True),
            sa.Column("nebula_id", sa.String(length=80), sa.ForeignKey("nebulae.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String(length=80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("role", sa.String(length=30), nullable=False, server_default="member"),
            sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("nebula_id", "user_id"),
        )
        op.create_index("ix_nebula_members_nebula_id", "nebula_members", ["nebula_id"])
        op.create_index("ix_nebula_members_user_id", "nebula_members", ["user_id"])

    tables = _tables()
    if "nebula_graph_edges" not in tables:
        op.create_table(
            "nebula_graph_edges",
            sa.Column("id", sa.String(length=120), primary_key=True),
            sa.Column("nebula_id", sa.String(length=80), sa.ForeignKey("nebulae.id", ondelete="CASCADE"), nullable=False),
            sa.Column("source_user_id", sa.String(length=80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("target_user_id", sa.String(length=80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("strength", sa.Float(), nullable=False),
            sa.Column("basis_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("graph_version", sa.String(length=80), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("nebula_id", "source_user_id", "target_user_id"),
        )
        op.create_index("ix_nebula_graph_edges_nebula_id", "nebula_graph_edges", ["nebula_id"])
        op.create_index("ix_nebula_graph_edges_source_user_id", "nebula_graph_edges", ["source_user_id"])
        op.create_index("ix_nebula_graph_edges_target_user_id", "nebula_graph_edges", ["target_user_id"])
        op.create_index("ix_nebula_graph_edges_graph_version", "nebula_graph_edges", ["graph_version"])

    tables = _tables()
    if "nebula_spatial_snapshots" not in tables:
        op.create_table(
            "nebula_spatial_snapshots",
            sa.Column("id", sa.String(length=120), primary_key=True),
            sa.Column("nebula_id", sa.String(length=80), sa.ForeignKey("nebulae.id", ondelete="CASCADE"), nullable=False),
            sa.Column("viewer_user_id", sa.String(length=80), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("graph_version", sa.String(length=80), nullable=False),
            sa.Column("snapshot_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("nebula_id", "viewer_user_id"),
        )
        op.create_index("ix_nebula_spatial_snapshots_nebula_id", "nebula_spatial_snapshots", ["nebula_id"])
        op.create_index("ix_nebula_spatial_snapshots_viewer_user_id", "nebula_spatial_snapshots", ["viewer_user_id"])
        op.create_index("ix_nebula_spatial_snapshots_graph_version", "nebula_spatial_snapshots", ["graph_version"])


def downgrade() -> None:
    tables = _tables()
    for table in ("nebula_spatial_snapshots", "nebula_graph_edges", "nebula_members", "nebulae"):
        if table in tables:
            op.drop_table(table)
