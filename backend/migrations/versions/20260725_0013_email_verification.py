"""Add verified-email registration state and one-time verification codes."""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260725_0013"
down_revision: str | None = "20260724_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "email_verified_at" not in user_columns:
        with op.batch_alter_table("users") as batch:
            batch.add_column(sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
            batch.create_index("ix_users_email_verified_at", ["email_verified_at"])

    if "email_verifications" not in set(sa.inspect(op.get_bind()).get_table_names()):
        op.create_table(
            "email_verifications",
            sa.Column("id", sa.String(length=100), primary_key=True),
            sa.Column("email", sa.String(length=320), nullable=False),
            sa.Column("purpose", sa.String(length=40), nullable=False),
            sa.Column("code_hash", sa.String(length=64), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        for column in ("email", "purpose", "expires_at", "consumed_at", "sent_at"):
            op.create_index(f"ix_email_verifications_{column}", "email_verifications", [column])


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "email_verifications" in tables:
        op.drop_table("email_verifications")
    user_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    if "email_verified_at" in user_columns:
        with op.batch_alter_table("users") as batch:
            batch.drop_index("ix_users_email_verified_at")
            batch.drop_column("email_verified_at")

