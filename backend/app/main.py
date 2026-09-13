from __future__ import annotations

import os
import secrets
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.agents.conversation import E2EConversationAgent, LocalConversationAgent
from app.agents.memory import EmbeddedMemoryAgent
from app.api.errors import install_application_error_handler
from app.api.middleware import install_abuse_protection, install_request_context
from app.api.routes import (
    activity_router,
    auth_router,
    conversations_router,
    direct_chat_router,
    ingestion_router,
    jobs_router,
    memories_router,
    memory_signals_router,
    nebula_router,
    profile_router,
    social_router,
    system_router,
    test_data_router,
    universe_router,
)
from app.application.graph_projection import project_graph_outbox
from app.db import Database
from app.domain.ecosystem import LocalSemanticEcosystemGenerator
from app.infrastructure.conversation_agent import remote_conversation_agent_from_environment
from app.infrastructure.email_delivery import email_sender_from_environment
from app.infrastructure.graph_projection import graph_repository_from_environment
from app.infrastructure.local_object_storage import LocalObjectStorage
from app.infrastructure.media_storage import LocalMediaStorage
from app.infrastructure.memory_analysis import memory_analysis_provider_from_environment
from app.infrastructure.openviking_memory import openviking_memory_from_environment
from app.infrastructure.rate_limit import RateLimiter, rate_limiter_from_environment
from app.infrastructure.semantic_similarity import semantic_similarity_from_environment
from app.ports.agent_memory import AgentMemoryStore
from app.ports.conversation_agent import AgentConversationProvider
from app.ports.graph_projection import GraphProjectionRepository
from app.ports.ecosystem_generation import EcosystemGenerator
from app.ports.email_delivery import VerificationEmailSender
from app.ports.media_storage import MediaStorage
from app.ports.object_storage import ObjectStorage
from app.schemas.auth import AuthRequest
from app.schemas.relationship import RelationshipRequest
from app.ports.semantic_similarity import SemanticSimilarity
from app.seed import seed_database
from app.orbit_albums import router as orbit_albums_router
from app.orbit_visits import router as orbit_visits_router


def create_app(
    database_url: str | None = None,
    *,
    seed_demo: bool | None = None,
    graph_repository: GraphProjectionRepository | None = None,
    memory_agent: EmbeddedMemoryAgent | None = None,
    memory_analysis_provider: EmbeddedMemoryAgent | None = None,
    activity_upload_directory: str | Path | None = None,
    media_storage: MediaStorage | None = None,
    ecosystem_generator: EcosystemGenerator | None = None,
    object_storage: ObjectStorage | None = None,
    agent_memory_store: AgentMemoryStore | None = None,
    agent_memory_recall_top_k: int | None = None,
    conversation_agent: AgentConversationProvider | None = None,
    semantic_similarity: SemanticSimilarity | None = None,
    email_sender: VerificationEmailSender | None = None,
    rate_limiter: RateLimiter | None = None,
    email_verification_required: bool | None = None,
) -> FastAPI:
    """Compose the FastAPI transport with replaceable backend adapters."""
    application = FastAPI(title="Social Cosmos API", version="1.0.0")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_application_error_handler(application)
    install_request_context(application)

    application.state.rate_limiter = rate_limiter or rate_limiter_from_environment()
    install_abuse_protection(application, application.state.rate_limiter)
    application.state.email_sender = email_sender or email_sender_from_environment()
    configured_required = os.getenv("EMAIL_VERIFICATION_REQUIRED")
    application.state.email_verification_required = (
        email_verification_required
        if email_verification_required is not None
        else (
            configured_required.strip().lower() == "true"
            if configured_required is not None
            else application.state.email_sender.provider_name == "qq-smtp"
        )
    )
    verification_secret = os.getenv("EMAIL_VERIFICATION_SECRET", "").strip()
    if application.state.email_verification_required and len(verification_secret) < 32:
        raise RuntimeError("EMAIL_VERIFICATION_SECRET must contain at least 32 characters.")
    application.state.email_verification_secret = verification_secret or secrets.token_urlsafe(32)
    application.state.email_verification_ttl_seconds = max(
        120, int(os.getenv("EMAIL_VERIFICATION_TTL_SECONDS", "600"))
    )
    application.state.email_verification_resend_seconds = max(
        30, int(os.getenv("EMAIL_VERIFICATION_RESEND_SECONDS", "60"))
    )
    configured_upload_directory = (
        activity_upload_directory
        or os.getenv("SOCIAL_COSMOS_UPLOAD_DIRECTORY")
        or os.getenv("SOCIAL_COSMOS_UPLOAD_DIR")
    )
    upload_directory = (
        Path(configured_upload_directory).expanduser()
        if configured_upload_directory
        else Path(__file__).resolve().parents[1] / "data" / "uploads"
    )
    upload_directory.mkdir(parents=True, exist_ok=True)
    application.mount("/uploads", StaticFiles(directory=upload_directory), name="activity-uploads")

    database = Database(database_url)
    database.create_schema()
    application.state.database = database
    application.state.graph_repository = graph_repository or graph_repository_from_environment()
    if memory_agent and memory_analysis_provider:
        raise ValueError("Pass memory_agent only; memory_analysis_provider is a compatibility alias.")
    application.state.memory_agent = (
        memory_agent
        or memory_analysis_provider
        or memory_analysis_provider_from_environment()
    )
    if conversation_agent is not None:
        application.state.conversation_agent = conversation_agent
    elif os.getenv("CONVERSATION_AGENT_PROVIDER", "local").strip().lower() == "local":
        application.state.conversation_agent = LocalConversationAgent()
    elif (
        os.getenv("CONVERSATION_AGENT_PROVIDER", "").strip().lower() == "e2e"
        and os.getenv("SOCIAL_COSMOS_E2E_CONTROLS", "").strip().lower() == "true"
    ):
        application.state.conversation_agent = E2EConversationAgent()
    else:
        application.state.conversation_agent = remote_conversation_agent_from_environment()
    application.state.agent_memory_store = agent_memory_store or openviking_memory_from_environment()
    application.state.agent_memory_recall_top_k = (
        agent_memory_recall_top_k
        if agent_memory_recall_top_k is not None
        else int(os.getenv("AGENT_MEMORY_RECALL_TOP_K", "5"))
    )
    if application.state.agent_memory_recall_top_k < 0:
        raise ValueError("Agent Memory recall top_k cannot be negative")
    application.state.media_storage = media_storage or LocalMediaStorage(upload_directory)
    application.state.object_storage = object_storage or LocalObjectStorage(upload_directory / "ingestion")
    application.state.ecosystem_generator = ecosystem_generator or LocalSemanticEcosystemGenerator()
    application.state.semantic_similarity = semantic_similarity or semantic_similarity_from_environment()

    should_seed = seed_demo if seed_demo is not None else os.getenv(
        "SOCIAL_COSMOS_SEED_DEMO",
        "true" if database.engine.dialect.name == "sqlite" else "false",
    ).lower() == "true"
    with database.session() as db:
        seed_database(db, should_seed)
    if os.getenv("SOCIAL_COSMOS_PROJECT_GRAPH_ON_STARTUP", "true").strip().lower() == "true":
        with database.session() as db:
            project_graph_outbox(db, application.state.graph_repository)

    application.include_router(system_router)
    application.include_router(test_data_router)
    application.include_router(auth_router)
    application.include_router(conversations_router)
    application.include_router(direct_chat_router)
    application.include_router(ingestion_router)
    application.include_router(jobs_router)
    application.include_router(memories_router)
    application.include_router(memory_signals_router)
    application.include_router(profile_router)
    application.include_router(universe_router)
    application.include_router(social_router)
    application.include_router(activity_router)
    application.include_router(nebula_router)
    application.include_router(orbit_albums_router)
    application.include_router(orbit_visits_router)
    return application


app = create_app()


__all__ = ["AuthRequest", "RelationshipRequest", "app", "create_app"]
