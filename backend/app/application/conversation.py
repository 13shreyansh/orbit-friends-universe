from __future__ import annotations

from datetime import datetime, timedelta, timezone
import time
from typing import Any

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.db import (
    AgentConversationRow,
    AgentMessageCitationRow,
    AgentMessageFeedbackRow,
    AgentMessageRow,
    AgentRunEventRow,
    AgentRunRow,
    Database,
    MemoryDraftRow,
    MemoryRow,
    MemorySourceRow,
    RelationshipRow,
    UserRow,
)
from app.ports.agent_memory import (
    AgentConversationSessionStore,
    AgentMemorySession,
    AgentMemoryStore,
)
from app.ports.analysis_provider import MemoryAnalysisProvider, MemoryAnalysisRecall
from app.ports.conversation_agent import AgentConversationContext, AgentConversationProvider
from app.schemas.conversation import (
    AgentRunView,
    ConversationCreateRequest,
    ConversationPage,
    ConversationUpdateRequest,
    ConversationView,
    FeedbackCreateRequest,
    FeedbackView,
    MemoryCitationView,
    MemoryProposalView,
    MessageAcceptedView,
    MessageCreateRequest,
    MessagePage,
    MessageView,
)
from app.schemas.ingestion import IngestionCreateRequest
from app.schemas.memory import MemoryObject

from .errors import (
    InvalidRequestError,
    ResourceConflictError,
    ResourceNotFoundError,
    ResourceStateError,
)
from .ingestion import analyze_ingestion_job, create_ingestion_job
from .pagination import decode_cursor, encode_cursor
from .serialization import dumps, loads, new_id


ACTIVE_RUN_STATUSES = {"queued", "retrieving", "generating"}
TERMINAL_RUN_STATUSES = {"completed", "failed", "cancelled"}
CONVERSATION_RECENT_MEMORY_LIMIT = 60
CONVERSATION_SESSION_COMMIT_MESSAGE_THRESHOLD = 100
CONVERSATION_SESSION_KEEP_RECENT_COUNT = 60
CONVERSATION_SESSION_TOKEN_BUDGET = 32_768


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _owned_conversation(
    db: Session,
    owner_user_id: str,
    conversation_id: str,
    *,
    lock: bool = False,
) -> AgentConversationRow:
    statement = select(AgentConversationRow).where(
        AgentConversationRow.id == conversation_id,
        AgentConversationRow.owner_user_id == owner_user_id,
    )
    if lock:
        statement = statement.with_for_update()
    row = db.scalar(statement)
    if not row:
        raise ResourceNotFoundError("Agent conversation not found.")
    return row


def _owned_run(db: Session, owner_user_id: str, run_id: str) -> AgentRunRow:
    row = db.scalar(select(AgentRunRow).where(
        AgentRunRow.id == run_id,
        AgentRunRow.owner_user_id == owner_user_id,
    ))
    if not row:
        raise ResourceNotFoundError("Agent run not found.")
    return row


def _owned_message(db: Session, owner_user_id: str, message_id: str) -> AgentMessageRow:
    row = db.scalar(select(AgentMessageRow).where(
        AgentMessageRow.id == message_id,
        AgentMessageRow.owner_user_id == owner_user_id,
    ))
    if not row:
        raise ResourceNotFoundError("Agent message not found.")
    return row


def serialize_conversation(row: AgentConversationRow) -> ConversationView:
    return ConversationView(
        id=row.id,
        title=row.title,
        mode=row.mode,
        relationship_id=row.relationship_id,
        status=row.status,
        last_message_at=row.last_message_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def serialize_run(row: AgentRunRow) -> AgentRunView:
    return AgentRunView(
        id=row.id,
        conversation_id=row.conversation_id,
        user_message_id=row.user_message_id,
        assistant_message_id=row.assistant_message_id,
        status=row.status,
        provider=row.provider,
        retrieval_degraded=row.retrieval_degraded,
        last_error=row.last_error,
        creation_request_id=row.creation_request_id,
        execution_request_id=row.execution_request_id,
        provider_request_id=row.provider_request_id,
        prompt_tokens=row.prompt_tokens,
        completion_tokens=row.completion_tokens,
        total_tokens=row.total_tokens,
        provider_latency_ms=row.provider_latency_ms,
        total_latency_ms=row.total_latency_ms,
        first_token_latency_ms=row.first_token_latency_ms,
        estimated_cost_microusd=row.estimated_cost_microusd,
        created_at=row.created_at,
        updated_at=row.updated_at,
        completed_at=row.completed_at,
    )


def serialize_message(db: Session, row: AgentMessageRow) -> MessageView:
    citation_rows = list(db.scalars(
        select(AgentMessageCitationRow)
        .where(
            AgentMessageCitationRow.message_id == row.id,
            AgentMessageCitationRow.owner_user_id == row.owner_user_id,
        )
        .order_by(AgentMessageCitationRow.created_at, AgentMessageCitationRow.id)
    ))
    proposal = None
    if row.memory_draft_id:
        draft = db.scalar(select(MemoryDraftRow).where(
            MemoryDraftRow.id == row.memory_draft_id,
            MemoryDraftRow.owner_user_id == row.owner_user_id,
        ))
        if draft:
            candidate = MemoryObject.model_validate(loads(draft.candidate_json, {}))
            proposal = MemoryProposalView(
                draft_id=draft.id,
                status=draft.status,
                summary=candidate.summary,
            )
    return MessageView(
        id=row.id,
        conversation_id=row.conversation_id,
        role=row.role,
        status=row.status,
        content=row.content,
        citations=[
            MemoryCitationView(
                memory_id=citation.memory_id,
                summary=citation.summary,
                event_time=citation.event_time,
            )
            for citation in citation_rows
        ],
        memory_proposal=proposal,
        created_at=row.created_at,
    )


def create_conversation(
    db: Session,
    owner: UserRow,
    body: ConversationCreateRequest,
) -> ConversationView:
    if body.relationship_id:
        relationship = db.scalar(select(RelationshipRow.id).where(
            RelationshipRow.id == body.relationship_id,
            RelationshipRow.owner_user_id == owner.id,
        ))
        if not relationship:
            raise ResourceNotFoundError("Relationship not found.")
    row = AgentConversationRow(
        id=new_id("conversation"),
        owner_user_id=owner.id,
        title=body.title.strip(),
        mode=body.mode,
        relationship_id=body.relationship_id,
    )
    db.add(row)
    db.flush()
    return serialize_conversation(row)


def get_conversation(db: Session, owner: UserRow, conversation_id: str) -> ConversationView:
    return serialize_conversation(_owned_conversation(db, owner.id, conversation_id))


def list_conversations(
    db: Session,
    owner: UserRow,
    *,
    cursor: str | None,
    limit: int,
    status: str | None,
) -> ConversationPage:
    if limit < 1 or limit > 100:
        raise InvalidRequestError("Conversation page limit must be between 1 and 100.")
    if status and status not in {"active", "archived"}:
        raise InvalidRequestError("Unsupported conversation status filter.")
    statement = select(AgentConversationRow).where(AgentConversationRow.owner_user_id == owner.id)
    if status:
        statement = statement.where(AgentConversationRow.status == status)
    decoded = decode_cursor(cursor, size=2)
    if decoded:
        try:
            updated_at = datetime.fromisoformat(str(decoded[0]))
        except ValueError as error:
            raise InvalidRequestError("Invalid pagination cursor.") from error
        conversation_id = str(decoded[1])
        statement = statement.where(or_(
            AgentConversationRow.updated_at < updated_at,
            and_(AgentConversationRow.updated_at == updated_at, AgentConversationRow.id < conversation_id),
        ))
    rows = list(db.scalars(
        statement.order_by(AgentConversationRow.updated_at.desc(), AgentConversationRow.id.desc()).limit(limit + 1)
    ))
    page_rows = rows[:limit]
    next_cursor = None
    if len(rows) > limit and page_rows:
        last = page_rows[-1]
        next_cursor = encode_cursor(last.updated_at.isoformat(), last.id)
    return ConversationPage(items=[serialize_conversation(row) for row in page_rows], next_cursor=next_cursor)


def update_conversation(
    db: Session,
    owner: UserRow,
    conversation_id: str,
    body: ConversationUpdateRequest,
) -> ConversationView:
    row = _owned_conversation(db, owner.id, conversation_id)
    if body.title is None and body.status is None:
        raise InvalidRequestError("Conversation update is empty.")
    if body.title is not None:
        row.title = body.title.strip()
    if body.status is not None:
        row.status = body.status
    row.updated_at = _now()
    db.flush()
    return serialize_conversation(row)


def delete_conversation(db: Session, owner: UserRow, conversation_id: str) -> dict[str, Any]:
    _owned_conversation(db, owner.id, conversation_id)
    message_ids = select(AgentMessageRow.id).where(
        AgentMessageRow.conversation_id == conversation_id,
        AgentMessageRow.owner_user_id == owner.id,
    )
    run_ids = select(AgentRunRow.id).where(
        AgentRunRow.conversation_id == conversation_id,
        AgentRunRow.owner_user_id == owner.id,
    )
    db.execute(delete(AgentMessageFeedbackRow).where(
        AgentMessageFeedbackRow.owner_user_id == owner.id,
        AgentMessageFeedbackRow.message_id.in_(message_ids),
    ))
    db.execute(delete(AgentMessageCitationRow).where(
        AgentMessageCitationRow.owner_user_id == owner.id,
        AgentMessageCitationRow.message_id.in_(message_ids),
    ))
    db.execute(delete(AgentRunEventRow).where(
        AgentRunEventRow.owner_user_id == owner.id,
        AgentRunEventRow.run_id.in_(run_ids),
    ))
    db.execute(delete(AgentRunRow).where(
        AgentRunRow.conversation_id == conversation_id,
        AgentRunRow.owner_user_id == owner.id,
    ))
    db.execute(delete(AgentMessageRow).where(
        AgentMessageRow.conversation_id == conversation_id,
        AgentMessageRow.owner_user_id == owner.id,
    ))
    db.execute(delete(AgentConversationRow).where(
        AgentConversationRow.id == conversation_id,
        AgentConversationRow.owner_user_id == owner.id,
    ))
    return {"deleted": True, "conversationId": conversation_id}


def list_messages(
    db: Session,
    owner: UserRow,
    conversation_id: str,
    *,
    cursor: str | None,
    limit: int,
) -> MessagePage:
    _owned_conversation(db, owner.id, conversation_id)
    if limit < 1 or limit > 100:
        raise InvalidRequestError("Message page limit must be between 1 and 100.")
    statement = select(AgentMessageRow).where(
        AgentMessageRow.conversation_id == conversation_id,
        AgentMessageRow.owner_user_id == owner.id,
    )
    decoded = decode_cursor(cursor, size=2)
    if decoded:
        try:
            created_at = datetime.fromisoformat(str(decoded[0]))
        except ValueError as error:
            raise InvalidRequestError("Invalid pagination cursor.") from error
        message_id = str(decoded[1])
        statement = statement.where(or_(
            AgentMessageRow.created_at > created_at,
            and_(AgentMessageRow.created_at == created_at, AgentMessageRow.id > message_id),
        ))
    rows = list(db.scalars(
        statement.order_by(AgentMessageRow.created_at, AgentMessageRow.id).limit(limit + 1)
    ))
    page_rows = rows[:limit]
    next_cursor = None
    if len(rows) > limit and page_rows:
        last = page_rows[-1]
        next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
    return MessagePage(items=[serialize_message(db, row) for row in page_rows], next_cursor=next_cursor)


def create_message_run(
    db: Session,
    owner: UserRow,
    conversation_id: str,
    body: MessageCreateRequest,
    provider: AgentConversationProvider,
    creation_request_id: str,
) -> MessageAcceptedView:
    conversation = _owned_conversation(db, owner.id, conversation_id, lock=True)
    if conversation.status != "active":
        raise ResourceStateError("Cannot send a message to an archived conversation.")
    existing = db.scalar(select(AgentMessageRow).where(
        AgentMessageRow.conversation_id == conversation_id,
        AgentMessageRow.client_message_id == body.client_message_id,
        AgentMessageRow.owner_user_id == owner.id,
    ))
    if existing:
        run = db.scalar(select(AgentRunRow).where(AgentRunRow.user_message_id == existing.id))
        if not run:
            raise ResourceStateError("The existing message has no Agent run.")
        return MessageAcceptedView(message=serialize_message(db, existing), run=serialize_run(run))
    active_run = db.scalar(select(AgentRunRow.id).where(
        AgentRunRow.conversation_id == conversation_id,
        AgentRunRow.owner_user_id == owner.id,
        AgentRunRow.status.in_(ACTIVE_RUN_STATUSES),
    ).limit(1))
    if active_run:
        raise ResourceConflictError("This conversation already has an active Agent run.")
    now = _now()
    user_message = AgentMessageRow(
        id=new_id("message"),
        owner_user_id=owner.id,
        conversation_id=conversation_id,
        role="user",
        status="completed",
        content=body.content.strip(),
        client_message_id=body.client_message_id,
        created_at=now,
        updated_at=now,
    )
    assistant_message = AgentMessageRow(
        id=new_id("message"),
        owner_user_id=owner.id,
        conversation_id=conversation_id,
        role="assistant",
        status="pending",
        content="",
        created_at=now + timedelta(microseconds=1),
        updated_at=now + timedelta(microseconds=1),
    )
    db.add_all([user_message, assistant_message])
    db.flush()
    run = AgentRunRow(
        id=new_id("run"),
        owner_user_id=owner.id,
        conversation_id=conversation_id,
        user_message_id=user_message.id,
        assistant_message_id=assistant_message.id,
        status="queued",
        provider=getattr(provider, "provider_name", type(provider).__name__),
        creation_request_id=creation_request_id,
        created_at=now,
        updated_at=now,
    )
    db.add(run)
    conversation.last_message_at = now
    conversation.updated_at = now
    db.flush()
    return MessageAcceptedView(message=serialize_message(db, user_message), run=serialize_run(run))


def _add_event(db: Session, run: AgentRunRow, event_type: str, payload: dict[str, Any]) -> AgentRunEventRow:
    sequence = int(db.scalar(
        select(func.max(AgentRunEventRow.sequence)).where(AgentRunEventRow.run_id == run.id)
    ) or 0) + 1
    row = AgentRunEventRow(
        owner_user_id=run.owner_user_id,
        run_id=run.id,
        sequence=sequence,
        event_type=event_type,
        payload_json=dumps(payload),
    )
    db.add(row)
    db.flush()
    return row


async def execute_run(
    database: Database,
    *,
    owner_user_id: str,
    run_id: str,
    provider: AgentConversationProvider,
    agent_memory_store: AgentMemoryStore | None,
    memory_analysis_provider: MemoryAnalysisProvider,
    recall_top_k: int,
    execution_request_id: str,
) -> None:
    execution_started_at = time.perf_counter()
    with database.session() as db:
        claimed = db.execute(
            update(AgentRunRow)
            .where(
                AgentRunRow.id == run_id,
                AgentRunRow.owner_user_id == owner_user_id,
                AgentRunRow.status == "queued",
            )
            .values(
                status="retrieving",
                execution_request_id=execution_request_id,
                updated_at=_now(),
            )
        )
        if claimed.rowcount != 1:
            _owned_run(db, owner_user_id, run_id)
            return
        run = _owned_run(db, owner_user_id, run_id)
        _add_event(db, run, "run.started", {"runId": run.id})
        conversation = _owned_conversation(db, owner_user_id, run.conversation_id)
        conversation_id = conversation.id
        user_message = _owned_message(db, owner_user_id, run.user_message_id)
        prompt = user_message.content
        relationship_id = conversation.relationship_id

    with database.session() as db:
        memory_statement = select(MemoryRow).where(MemoryRow.owner_user_id == owner_user_id)
        if relationship_id:
            memory_statement = memory_statement.where(MemoryRow.relationship_id == relationship_id)
        memory_rows = list(db.scalars(
            memory_statement
            .order_by(MemoryRow.event_time.desc(), MemoryRow.id.desc())
            .limit(CONVERSATION_RECENT_MEMORY_LIMIT)
        ))
        confirmed_memories = [
            MemoryObject.model_validate(loads(row.memory_json, {})) for row in memory_rows
        ]

    recalls: tuple[MemoryAnalysisRecall, ...] = ()
    degraded = False
    if agent_memory_store is not None and recall_top_k > 0:
        try:
            recalled = await agent_memory_store.recall(
                user_id=owner_user_id,
                query=prompt,
                top_k=recall_top_k,
            )
            recalls = tuple(MemoryAnalysisRecall(
                object_key=item.object_key,
                score=item.score,
                content=dict(item.content),
            ) for item in recalled[:recall_top_k])
        except Exception:
            degraded = True

    conversation_session: AgentMemorySession | None = None
    openviking_session_context: dict[str, Any] | None = None
    session_store = (
        agent_memory_store
        if isinstance(agent_memory_store, AgentConversationSessionStore)
        else None
    )
    if session_store is not None:
        try:
            conversation_session = await session_store.get_or_create_session(
                user_id=owner_user_id,
                session_key=f"conversation:{conversation_id}",
            )
            assembled = await session_store.get_conversation_session_context(
                session=conversation_session,
                token_budget=CONVERSATION_SESSION_TOKEN_BUDGET,
            )
            if (
                conversation_session.message_count >= CONVERSATION_SESSION_COMMIT_MESSAGE_THRESHOLD
                or assembled.estimated_tokens >= CONVERSATION_SESSION_TOKEN_BUDGET
            ):
                await session_store.commit_conversation_session(
                    session=conversation_session,
                    keep_recent_count=CONVERSATION_SESSION_KEEP_RECENT_COUNT,
                )
                assembled = await session_store.get_conversation_session_context(
                    session=conversation_session,
                    token_budget=CONVERSATION_SESSION_TOKEN_BUDGET,
                )
            openviking_session_context = {
                "latestArchiveOverview": assembled.latest_archive_overview,
                "messages": [dict(item) for item in assembled.messages],
                "estimatedTokens": assembled.estimated_tokens,
                "stats": dict(assembled.stats),
            }
            await session_store.append_conversation_message(
                session=conversation_session,
                role="user",
                content=prompt,
            )
        except Exception:
            degraded = True
            conversation_session = None
            openviking_session_context = None

    with database.session() as db:
        run = _owned_run(db, owner_user_id, run_id)
        if run.status == "cancelled":
            return
        run.retrieval_degraded = degraded
        run.status = "generating"
        run.updated_at = _now()
        _add_event(db, run, "retrieval.completed", {
            "sqlCount": len(confirmed_memories),
            "recallCount": len(recalls),
            "degraded": degraded,
        })

    provider_started_at: float | None = None
    measured_provider_latency_ms: int | None = None
    try:
        provider_started_at = time.perf_counter()
        answer = await provider.respond(
            prompt,
            AgentConversationContext(
                owner_user_id=owner_user_id,
                relationship_id=relationship_id,
                confirmed_memories=confirmed_memories,
                agent_memory_recalls=recalls,
                openviking_session_context=openviking_session_context,
            ),
        )
        measured_provider_latency_ms = round((time.perf_counter() - provider_started_at) * 1000)
        session_sync_failed = False
        if session_store is not None and conversation_session is not None:
            try:
                await session_store.append_conversation_message(
                    session=conversation_session,
                    role="assistant",
                    content=answer.content,
                )
            except Exception:
                session_sync_failed = True
        proposal_draft_id = None
        if answer.propose_memory:
            with database.session() as db:
                owner = db.get(UserRow, owner_user_id)
                if not owner:
                    raise ResourceNotFoundError("User not found.")
                job = create_ingestion_job(db, owner, IngestionCreateRequest(
                    source_type="text",
                    raw_text=prompt,
                    relationship_id=relationship_id,
                ))
                _job, draft = await analyze_ingestion_job(
                    db,
                    owner,
                    job.id,
                    memory_analysis_provider,
                    # Recall was already attempted for this run. When that
                    # dependency is degraded, do not retry the same failed
                    # store inside proposal analysis and silently turn an
                    # otherwise valid proposal into a failed ingestion job.
                    # The run retains retrieval_degraded=true, while the
                    # analysis Agent can still use confirmed SQL evidence.
                    None if degraded else agent_memory_store,
                    agent_memory_recall_top_k=recall_top_k,
                )
                if draft:
                    proposal_draft_id = draft.id
                    db.execute(update(MemorySourceRow).where(
                        MemorySourceRow.analysis_job_id == job.id
                    ).values(
                        agent_conversation_id=run.conversation_id,
                        agent_message_id=run.user_message_id,
                    ))

        with database.session() as db:
            run = _owned_run(db, owner_user_id, run_id)
            if run.status == "cancelled":
                return
            run.retrieval_degraded = run.retrieval_degraded or session_sync_failed
            assistant = _owned_message(db, owner_user_id, run.assistant_message_id)
            allowed_ids = set(answer.cited_memory_ids)
            cited_rows = [row for row in memory_rows if row.id in allowed_ids]
            for memory_row in cited_rows:
                memory = MemoryObject.model_validate(loads(memory_row.memory_json, {}))
                db.add(AgentMessageCitationRow(
                    id=new_id("citation"),
                    owner_user_id=owner_user_id,
                    message_id=assistant.id,
                    memory_id=memory.id,
                    summary=memory.summary,
                    event_time=memory.event_time.isoformat(),
                ))
            assistant.content = answer.content
            assistant.status = "completed"
            assistant.memory_draft_id = proposal_draft_id
            assistant.updated_at = _now()
            for index in range(0, len(answer.content), 80):
                _add_event(db, run, "assistant.delta", {"delta": answer.content[index:index + 80]})
            for memory_row in cited_rows:
                memory = MemoryObject.model_validate(loads(memory_row.memory_json, {}))
                _add_event(db, run, "citation.added", {
                    "memoryId": memory.id,
                    "summary": memory.summary,
                    "eventTime": memory.event_time.isoformat(),
                })
            if proposal_draft_id:
                draft = db.get(MemoryDraftRow, proposal_draft_id)
                candidate = MemoryObject.model_validate(loads(draft.candidate_json, {})) if draft else None
                _add_event(db, run, "memory.proposal", {
                    "draftId": proposal_draft_id,
                    "status": draft.status if draft else "awaiting_confirmation",
                    "summary": candidate.summary if candidate else "",
                })
            run.status = "completed"
            run.provider_request_id = answer.provider_request_id
            run.prompt_tokens = answer.prompt_tokens
            run.completion_tokens = answer.completion_tokens
            run.total_tokens = answer.total_tokens
            run.provider_latency_ms = answer.provider_latency_ms
            if run.provider_latency_ms is None:
                run.provider_latency_ms = measured_provider_latency_ms
            run.first_token_latency_ms = answer.first_token_latency_ms
            run.estimated_cost_microusd = answer.estimated_cost_microusd
            run.total_latency_ms = round((time.perf_counter() - execution_started_at) * 1000)
            run.completed_at = _now()
            run.updated_at = run.completed_at
            _add_event(db, run, "run.completed", {
                "messageId": assistant.id,
                "metrics": _run_metrics(run),
            })
    except Exception as error:
        with database.session() as db:
            run = _owned_run(db, owner_user_id, run_id)
            if run.status == "cancelled":
                return
            assistant = _owned_message(db, owner_user_id, run.assistant_message_id)
            assistant.status = "failed"
            assistant.updated_at = _now()
            run.status = "failed"
            run.last_error = str(error)[:2000]
            if measured_provider_latency_ms is not None:
                run.provider_latency_ms = measured_provider_latency_ms
            elif provider_started_at is not None:
                run.provider_latency_ms = round((time.perf_counter() - provider_started_at) * 1000)
            run.total_latency_ms = round((time.perf_counter() - execution_started_at) * 1000)
            run.completed_at = _now()
            run.updated_at = run.completed_at
            _add_event(db, run, "run.failed", {
                "errorType": type(error).__name__,
                "message": "Agent response failed.",
            })


def _run_metrics(run: AgentRunRow) -> dict[str, int | None]:
    return {
        "promptTokens": run.prompt_tokens,
        "completionTokens": run.completion_tokens,
        "totalTokens": run.total_tokens,
        "providerLatencyMs": run.provider_latency_ms,
        "totalLatencyMs": run.total_latency_ms,
        "firstTokenLatencyMs": run.first_token_latency_ms,
        "estimatedCostMicrousd": run.estimated_cost_microusd,
    }


def get_run(db: Session, owner: UserRow, run_id: str) -> AgentRunView:
    return serialize_run(_owned_run(db, owner.id, run_id))


def get_active_run(
    db: Session,
    owner: UserRow,
    conversation_id: str,
) -> AgentRunView | None:
    _owned_conversation(db, owner.id, conversation_id)
    row = db.scalar(
        select(AgentRunRow)
        .where(
            AgentRunRow.conversation_id == conversation_id,
            AgentRunRow.owner_user_id == owner.id,
            AgentRunRow.status.in_(ACTIVE_RUN_STATUSES),
        )
        .order_by(AgentRunRow.created_at.desc())
        .limit(1)
    )
    return serialize_run(row) if row else None


def cancel_run(db: Session, owner: UserRow, run_id: str) -> AgentRunView:
    run = _owned_run(db, owner.id, run_id)
    if run.status in TERMINAL_RUN_STATUSES:
        return serialize_run(run)
    run.status = "cancelled"
    run.completed_at = _now()
    run.updated_at = run.completed_at
    assistant = _owned_message(db, owner.id, run.assistant_message_id)
    assistant.status = "cancelled"
    assistant.updated_at = _now()
    _add_event(db, run, "run.cancelled", {"runId": run.id})
    db.flush()
    return serialize_run(run)


def run_events(db: Session, owner_user_id: str, run_id: str, after_sequence: int) -> list[AgentRunEventRow]:
    _owned_run(db, owner_user_id, run_id)
    return list(db.scalars(
        select(AgentRunEventRow)
        .where(
            AgentRunEventRow.run_id == run_id,
            AgentRunEventRow.owner_user_id == owner_user_id,
            AgentRunEventRow.sequence > after_sequence,
        )
        .order_by(AgentRunEventRow.sequence)
    ))


def save_feedback(
    db: Session,
    owner: UserRow,
    message_id: str,
    body: FeedbackCreateRequest,
) -> FeedbackView:
    message = _owned_message(db, owner.id, message_id)
    if message.role != "assistant":
        raise InvalidRequestError("Feedback is only accepted for assistant messages.")
    row = db.scalar(select(AgentMessageFeedbackRow).where(
        AgentMessageFeedbackRow.owner_user_id == owner.id,
        AgentMessageFeedbackRow.message_id == message_id,
    ))
    now = _now()
    if not row:
        row = AgentMessageFeedbackRow(
            id=new_id("feedback"),
            owner_user_id=owner.id,
            message_id=message_id,
            rating=body.rating,
            comment=body.comment,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.rating = body.rating
        row.comment = body.comment
        row.updated_at = now
    db.flush()
    return FeedbackView(
        message_id=row.message_id,
        rating=row.rating,
        comment=row.comment,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
