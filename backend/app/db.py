from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class UserRow(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    display_name: Mapped[str] = mapped_column(String(80))
    bio: Mapped[str] = mapped_column(Text, default="")
    tags_json: Mapped[str] = mapped_column(Text, default="[]")
    intake_json: Mapped[str] = mapped_column(Text, default="{}")
    planet_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SessionRow(Base):
    __tablename__ = "auth_sessions"

    token: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EmailVerificationRow(Base):
    __tablename__ = "email_verifications"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    purpose: Mapped[str] = mapped_column(String(40), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PlanetRow(Base):
    __tablename__ = "planets"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    identity_json: Mapped[str] = mapped_column(Text)
    visual_json: Mapped[str] = mapped_column(Text)
    score_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ActivityPostRow(Base):
    __tablename__ = "activity_posts"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    planet_id: Mapped[str] = mapped_column(ForeignKey("planets.id", ondelete="CASCADE"), index=True)
    content_json: Mapped[str] = mapped_column(Text)
    media_json: Mapped[str] = mapped_column(Text, default="[]")
    ecosystem_json: Mapped[str] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(30), default="friends", index=True)
    signal_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ActivityBroadcastReceiptRow(Base):
    __tablename__ = "activity_broadcast_receipts"
    __table_args__ = (UniqueConstraint("activity_id", "viewer_user_id"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    activity_id: Mapped[str] = mapped_column(ForeignKey("activity_posts.id", ondelete="CASCADE"), index=True)
    viewer_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NebulaRow(Base):
    __tablename__ = "nebulae"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    # Unique indexes are used instead of table-level constraints so SQLite
    # databases created by the earlier nebula prototype remain compatible.
    slug: Mapped[str] = mapped_column(String(120), index=True, unique=True)
    join_code: Mapped[str] = mapped_column(String(16), index=True, unique=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    theme_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NebulaMemberRow(Base):
    __tablename__ = "nebula_members"
    __table_args__ = (UniqueConstraint("nebula_id", "user_id"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    nebula_id: Mapped[str] = mapped_column(ForeignKey("nebulae.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(30), default="member")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NebulaGraphEdgeRow(Base):
    __tablename__ = "nebula_graph_edges"
    __table_args__ = (UniqueConstraint("nebula_id", "source_user_id", "target_user_id"),)

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    nebula_id: Mapped[str] = mapped_column(ForeignKey("nebulae.id", ondelete="CASCADE"), index=True)
    source_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    target_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    strength: Mapped[float] = mapped_column(Float)
    basis_json: Mapped[str] = mapped_column(Text, default="[]")
    graph_version: Mapped[str] = mapped_column(String(80), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NebulaSpatialSnapshotRow(Base):
    __tablename__ = "nebula_spatial_snapshots"
    __table_args__ = (UniqueConstraint("nebula_id", "viewer_user_id"),)

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    nebula_id: Mapped[str] = mapped_column(ForeignKey("nebulae.id", ondelete="CASCADE"), index=True)
    viewer_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    graph_version: Mapped[str] = mapped_column(String(80), index=True)
    snapshot_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RelationshipRow(Base):
    __tablename__ = "relationships"
    __table_args__ = (UniqueConstraint("owner_user_id", "target_user_id"),)

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    target_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    relation_type: Mapped[str] = mapped_column(String(40))
    identity_label: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text)
    signals_json: Mapped[str] = mapped_column(Text, default="{}")
    score_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(30), default="active")
    started_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DirectConversationRow(Base):
    __tablename__ = "direct_conversations"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    status: Mapped[str] = mapped_column(String(30), default="active", index=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DirectConversationMemberRow(Base):
    __tablename__ = "direct_conversation_members"
    __table_args__ = (UniqueConstraint("conversation_id", "user_id"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("direct_conversations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DirectMessageRow(Base):
    __tablename__ = "direct_messages"
    __table_args__ = (UniqueConstraint("conversation_id", "sender_user_id", "client_message_id"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("direct_conversations.id", ondelete="CASCADE"), index=True
    )
    sender_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    content: Mapped[str] = mapped_column(Text)
    client_message_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="sent", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GraphDocumentRow(Base):
    __tablename__ = "profile_graph_documents"

    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    graph_version: Mapped[str] = mapped_column(String(80), index=True)
    document_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GraphProjectionOutboxRow(Base):
    __tablename__ = "graph_projection_outbox"
    __table_args__ = (UniqueConstraint("owner_user_id", "graph_version"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    graph_version: Mapped[str] = mapped_column(String(80), index=True)
    operation: Mapped[str] = mapped_column(String(20), default="upsert", index=True)
    document_json: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    projected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GraphNodeRow(Base):
    __tablename__ = "graph_nodes"
    __table_args__ = (UniqueConstraint("owner_user_id", "graph_version", "node_id"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    graph_version: Mapped[str] = mapped_column(String(80), index=True)
    node_id: Mapped[str] = mapped_column(String(160), index=True)
    kind: Mapped[str] = mapped_column(String(80), index=True)
    label: Mapped[str] = mapped_column(String(240))
    properties_json: Mapped[str] = mapped_column(Text)


class GraphEdgeRow(Base):
    __tablename__ = "graph_edges"
    __table_args__ = (UniqueConstraint("owner_user_id", "graph_version", "edge_id"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    graph_version: Mapped[str] = mapped_column(String(80), index=True)
    edge_id: Mapped[str] = mapped_column(String(160), index=True)
    source_node_id: Mapped[str] = mapped_column(String(160), index=True)
    target_node_id: Mapped[str] = mapped_column(String(160), index=True)
    edge_type: Mapped[str] = mapped_column(String(80), index=True)
    properties_json: Mapped[str] = mapped_column(Text)


class SpatialSnapshotRow(Base):
    __tablename__ = "spatial_snapshots"

    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    graph_version: Mapped[str] = mapped_column(String(80), index=True)
    snapshot_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MemoryRow(Base):
    __tablename__ = "memories"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    relationship_id: Mapped[str | None] = mapped_column(ForeignKey("relationships.id", ondelete="SET NULL"), nullable=True, index=True)
    memory_json: Mapped[str] = mapped_column(Text)
    event_time: Mapped[str] = mapped_column(String(30), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MemoryShareRow(Base):
    __tablename__ = "memory_shares"
    __table_args__ = (UniqueConstraint("memory_id", "recipient_user_id"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    memory_id: Mapped[str] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"), index=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    recipient_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    owner_relationship_id: Mapped[str] = mapped_column(ForeignKey("relationships.id", ondelete="CASCADE"), index=True)
    recipient_relationship_id: Mapped[str | None] = mapped_column(
        ForeignKey("relationships.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(30), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MemorySignalRow(Base):
    __tablename__ = "memory_signals"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    memory_id: Mapped[str] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"), index=True)
    sender_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    recipient_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source_planet_id: Mapped[str | None] = mapped_column(
        ForeignKey("planets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    target_planet_id: Mapped[str | None] = mapped_column(
        ForeignKey("planets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    memory_version: Mapped[int] = mapped_column(Integer, default=1)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MemorySignalReceiptRow(Base):
    __tablename__ = "memory_signal_receipts"
    __table_args__ = (UniqueConstraint("signal_id", "viewer_user_id"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    signal_id: Mapped[str] = mapped_column(ForeignKey("memory_signals.id", ondelete="CASCADE"), index=True)
    viewer_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MediaAssetRow(Base):
    __tablename__ = "media_assets"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    parent_asset_id: Mapped[str | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(30), index=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    storage_key: Mapped[str] = mapped_column(String(500), unique=True)
    storage_url: Mapped[str] = mapped_column(Text, default="")
    content_hash: Mapped[str] = mapped_column(String(128), index=True)
    mime_type: Mapped[str] = mapped_column(String(160))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AnalysisJobRow(Base):
    __tablename__ = "analysis_jobs"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    job_type: Mapped[str] = mapped_column(String(40), default="memory_analysis", index=True)
    source_type: Mapped[str] = mapped_column(String(30), index=True)
    status: Mapped[str] = mapped_column(String(40), default="created", index=True)
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    provider: Mapped[str] = mapped_column(String(120), default="")
    input_hash: Mapped[str] = mapped_column(String(128), index=True)
    input_json: Mapped[str] = mapped_column(Text)
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AnalysisJobDeletionAuditRow(Base):
    __tablename__ = "analysis_job_deletion_audit"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str] = mapped_column(String(100), unique=True)
    prior_status: Mapped[str] = mapped_column(String(40), index=True)
    input_hash: Mapped[str] = mapped_column(String(128), index=True)
    reason: Mapped[str] = mapped_column(String(240))
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SyntheticAccountDeletionAuditRow(Base):
    __tablename__ = "synthetic_account_deletion_audit"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    email_hash: Mapped[str] = mapped_column(String(64), index=True)
    deleted_job_count: Mapped[int] = mapped_column(Integer, default=0)
    deleted_conversation_count: Mapped[int] = mapped_column(Integer, default=0)
    reason: Mapped[str] = mapped_column(String(240))
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MemoryDraftRow(Base):
    __tablename__ = "memory_drafts"
    __table_args__ = (UniqueConstraint("job_id", "candidate_memory_id"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("analysis_jobs.id", ondelete="CASCADE"), index=True)
    relationship_id: Mapped[str | None] = mapped_column(
        ForeignKey("relationships.id", ondelete="SET NULL"), nullable=True, index=True
    )
    candidate_memory_id: Mapped[str] = mapped_column(String(100), index=True)
    schema_version: Mapped[str] = mapped_column(String(40), default="memory.v1")
    candidate_json: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default="awaiting_confirmation", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    confirmed_memory_id: Mapped[str | None] = mapped_column(
        ForeignKey("memories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MemorySourceRow(Base):
    __tablename__ = "memory_sources"
    __table_args__ = (
        UniqueConstraint("analysis_job_id", "source_order"),
        CheckConstraint(
            "analysis_job_id IS NOT NULL OR draft_id IS NOT NULL OR memory_id IS NOT NULL",
            name="ck_memory_sources_has_parent",
        ),
    )

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    analysis_job_id: Mapped[str | None] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    draft_id: Mapped[str | None] = mapped_column(
        ForeignKey("memory_drafts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    memory_id: Mapped[str | None] = mapped_column(
        ForeignKey("memories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    media_asset_id: Mapped[str | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    agent_conversation_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    agent_message_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    source_type: Mapped[str] = mapped_column(String(30), index=True)
    source_order: Mapped[int] = mapped_column(Integer, default=0)
    content_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MemoryRevisionRow(Base):
    __tablename__ = "memory_revisions"
    __table_args__ = (UniqueConstraint("memory_id", "version"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    memory_id: Mapped[str] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    author_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reason: Mapped[str] = mapped_column(String(240), default="user_confirmation")
    document_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IntegrationOutboxRow(Base):
    __tablename__ = "integration_outbox"
    __table_args__ = (UniqueConstraint("destination", "dedupe_key"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    destination: Mapped[str] = mapped_column(String(80), index=True)
    aggregate_type: Mapped[str] = mapped_column(String(80), index=True)
    aggregate_id: Mapped[str] = mapped_column(String(120), index=True)
    aggregate_version: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(120), index=True)
    dedupe_key: Mapped[str] = mapped_column(String(240))
    payload_json: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(Text, default="")
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    claim_token: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    dead_lettered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentMemorySessionRow(Base):
    __tablename__ = "agent_memory_sessions"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "provider", "session_key"),
        UniqueConstraint("owner_user_id", "provider", "external_session_id"),
    )

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(80), index=True)
    session_key: Mapped[str] = mapped_column(String(240))
    external_session_id: Mapped[str] = mapped_column(String(240))
    object_key: Mapped[str] = mapped_column(String(160), index=True)
    status: Mapped[str] = mapped_column(String(30), default="active", index=True)
    last_commit_task_id: Mapped[str | None] = mapped_column(String(240), nullable=True, index=True)
    last_commit_status: Mapped[str] = mapped_column(String(40), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentMemorySyncStateRow(Base):
    __tablename__ = "agent_memory_sync_state"
    __table_args__ = (UniqueConstraint("owner_user_id", "provider", "object_key"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(80), index=True)
    object_key: Mapped[str] = mapped_column(String(160), index=True)
    version: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(40), default="pending", index=True)
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("agent_memory_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    outbox_id: Mapped[int | None] = mapped_column(
        ForeignKey("integration_outbox.id", ondelete="SET NULL"), nullable=True, index=True
    )
    external_task_id: Mapped[str | None] = mapped_column(String(240), nullable=True, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(Text, default="")
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentConversationRow(Base):
    __tablename__ = "agent_conversations"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    mode: Mapped[str] = mapped_column(String(40), default="memory_companion", index=True)
    relationship_id: Mapped[str | None] = mapped_column(
        ForeignKey("relationships.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(30), default="active", index=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentMessageRow(Base):
    __tablename__ = "agent_messages"
    __table_args__ = (UniqueConstraint("conversation_id", "client_message_id"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("agent_conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20), index=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    content: Mapped[str] = mapped_column(Text, default="")
    client_message_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    memory_draft_id: Mapped[str | None] = mapped_column(
        ForeignKey("memory_drafts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentRunRow(Base):
    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("agent_conversations.id", ondelete="CASCADE"), index=True
    )
    user_message_id: Mapped[str] = mapped_column(
        ForeignKey("agent_messages.id", ondelete="CASCADE"), unique=True
    )
    assistant_message_id: Mapped[str] = mapped_column(
        ForeignKey("agent_messages.id", ondelete="CASCADE"), unique=True
    )
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    provider: Mapped[str] = mapped_column(String(120), default="")
    retrieval_degraded: Mapped[bool] = mapped_column(Boolean, default=False)
    last_error: Mapped[str] = mapped_column(Text, default="")
    creation_request_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    execution_request_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    provider_request_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    first_token_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_cost_microusd: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentRunEventRow(Base):
    __tablename__ = "agent_run_events"
    __table_args__ = (UniqueConstraint("run_id", "sequence"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentMessageCitationRow(Base):
    __tablename__ = "agent_message_citations"
    __table_args__ = (UniqueConstraint("message_id", "memory_id"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[str] = mapped_column(ForeignKey("agent_messages.id", ondelete="CASCADE"), index=True)
    memory_id: Mapped[str] = mapped_column(String(100), index=True)
    summary: Mapped[str] = mapped_column(Text)
    event_time: Mapped[str] = mapped_column(String(30))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentMessageFeedbackRow(Base):
    __tablename__ = "agent_message_feedback"
    __table_args__ = (UniqueConstraint("owner_user_id", "message_id"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[str] = mapped_column(ForeignKey("agent_messages.id", ondelete="CASCADE"), index=True)
    rating: Mapped[str] = mapped_column(String(30), index=True)
    comment: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

class TimelineRow(Base):
    __tablename__ = "timeline_entries"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    relationship_id: Mapped[str] = mapped_column(ForeignKey("relationships.id", ondelete="CASCADE"), index=True)
    event_time: Mapped[str] = mapped_column(String(30), index=True)
    event_type: Mapped[str] = mapped_column(String(80))
    intimacy: Mapped[float] = mapped_column(Float)
    interaction_frequency: Mapped[float] = mapped_column(Float)
    emotional_tone: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text)
    source_memory_id: Mapped[str | None] = mapped_column(ForeignKey("memories.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserBehaviorEventRow(Base):
    __tablename__ = "user_behavior_events"
    __table_args__ = (UniqueConstraint("owner_user_id", "dedupe_key"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    target_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    weight: Mapped[float] = mapped_column(Float)
    dedupe_key: Mapped[str] = mapped_column(String(200))
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Database:
    def __init__(self, url: str | None = None) -> None:
        if url is None:
            url = os.getenv("SOCIAL_COSMOS_DATABASE_URL")
            if not url:
                default_path = Path(__file__).resolve().parents[1] / "data" / "social-cosmos-fastapi.db"
                default_path.parent.mkdir(parents=True, exist_ok=True)
                url = f"sqlite:///{default_path.as_posix()}"
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        engine_options: dict[str, object] = {"connect_args": connect_args, "pool_pre_ping": True}
        if not url.startswith("sqlite"):
            engine_options.update({
                "pool_size": max(1, int(os.getenv("SOCIAL_COSMOS_DB_POOL_SIZE", "5"))),
                "max_overflow": max(0, int(os.getenv("SOCIAL_COSMOS_DB_MAX_OVERFLOW", "5"))),
                "pool_timeout": max(1, int(os.getenv("SOCIAL_COSMOS_DB_POOL_TIMEOUT_SECONDS", "10"))),
                "pool_recycle": max(60, int(os.getenv("SOCIAL_COSMOS_DB_POOL_RECYCLE_SECONDS", "1800"))),
            })
        self.engine = create_engine(url, **engine_options)
        self.session_factory = sessionmaker(self.engine, expire_on_commit=False)

    def create_schema(self) -> None:
        if self.engine.dialect.name == "sqlite" or os.getenv("SOCIAL_COSMOS_AUTO_CREATE_SCHEMA", "").lower() == "true":
            Base.metadata.create_all(self.engine)

    @contextmanager
    def session(self) -> Iterator[Session]:
        session = self.session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()
