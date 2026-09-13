"""Remove user-declared relationship strength.

Relationship strength is now derived from objective profile affinity, memory,
behavior and graph evidence. Profile extensions remain JSON-backed and need no
relational schema change.
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260724_0007"
down_revision: str | None = "20260724_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("relationships")
    }
    if "declared_strength" in columns:
        with op.batch_alter_table("relationships") as batch_op:
            batch_op.drop_column("declared_strength")


def downgrade() -> None:
    columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("relationships")
    }
    if "declared_strength" not in columns:
        with op.batch_alter_table("relationships") as batch_op:
            batch_op.add_column(sa.Column("declared_strength", sa.Float(), nullable=False, server_default="0.5"))
