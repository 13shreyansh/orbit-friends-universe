from __future__ import annotations

import asyncio
import json
from typing import Annotated, AsyncIterator

from fastapi import APIRouter, Depends, Header, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.application.conversation import (
    cancel_run,
    create_conversation,
    create_message_run,
    delete_conversation,
    execute_run,
    get_active_run,
    get_conversation,
    get_run,
    list_conversations,
    list_messages,
    run_events,
    save_feedback,
    update_conversation,
)
from app.application.serialization import loads
from app.db import UserRow
from app.schemas.conversation import (
    AgentRunView,
    ConversationCreateRequest,
    ConversationDeletedView,
    ConversationPage,
    ConversationUpdateRequest,
    ConversationView,
    FeedbackCreateRequest,
    FeedbackView,
    MessageAcceptedView,
    MessageCreateRequest,
    MessagePage,
)

from ..dependencies import current_user, db_session


router = APIRouter()


@router.post(
    "/api/v1/agent/conversations",
    response_model=ConversationView,
    status_code=status.HTTP_201_CREATED,
)
def create_agent_conversation(
    body: ConversationCreateRequest,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> ConversationView:
    result = create_conversation(db, user, body)
    db.commit()
    return result


@router.get("/api/v1/agent/conversations", response_model=ConversationPage)
def agent_conversations(
    cursor: str | None = None,
    limit: int = 20,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> ConversationPage:
    return list_conversations(
        db,
        user,
        cursor=cursor,
        limit=limit,
        status=status_filter,
    )


@router.get("/api/v1/agent/conversations/{conversation_id}", response_model=ConversationView)
def agent_conversation(
    conversation_id: str,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> ConversationView:
    return get_conversation(db, user, conversation_id)


@router.patch("/api/v1/agent/conversations/{conversation_id}", response_model=ConversationView)
def revise_agent_conversation(
    conversation_id: str,
    body: ConversationUpdateRequest,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> ConversationView:
    result = update_conversation(db, user, conversation_id, body)
    db.commit()
    return result


@router.delete("/api/v1/agent/conversations/{conversation_id}", response_model=ConversationDeletedView)
def remove_agent_conversation(
    conversation_id: str,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict:
    result = delete_conversation(db, user, conversation_id)
    db.commit()
    return result


@router.get("/api/v1/agent/conversations/{conversation_id}/messages", response_model=MessagePage)
def agent_messages(
    conversation_id: str,
    cursor: str | None = None,
    limit: int = 50,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> MessagePage:
    return list_messages(db, user, conversation_id, cursor=cursor, limit=limit)


@router.get(
    "/api/v1/agent/conversations/{conversation_id}/active-run",
    response_model=AgentRunView | None,
)
def active_agent_run(
    conversation_id: str,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> AgentRunView | None:
    return get_active_run(db, user, conversation_id)


@router.post(
    "/api/v1/agent/conversations/{conversation_id}/messages",
    response_model=MessageAcceptedView,
    status_code=status.HTTP_202_ACCEPTED,
)
def send_agent_message(
    conversation_id: str,
    body: MessageCreateRequest,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> MessageAcceptedView:
    result = create_message_run(
        db,
        user,
        conversation_id,
        body,
        request.app.state.conversation_agent,
        request.state.request_id,
    )
    db.commit()
    return result


@router.get("/api/v1/agent/runs/{run_id}", response_model=AgentRunView)
def agent_run(
    run_id: str,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> AgentRunView:
    return get_run(db, user, run_id)


@router.get("/api/v1/agent/runs/{run_id}/events", response_model=None)
async def agent_run_event_stream(
    run_id: str,
    request: Request,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> StreamingResponse:
    try:
        after_sequence = max(0, int(last_event_id or "0"))
    except ValueError:
        after_sequence = 0
    database = request.app.state.database
    owner_user_id = user.id
    initial_run = get_run(db, user, run_id)
    # The response streams for the lifetime of the Agent run. Release the
    # request-scoped read transaction before background execution writes to
    # SQLite; PostgreSQL also benefits from not holding an idle transaction.
    db.rollback()

    async def stream() -> AsyncIterator[str]:
        current = initial_run
        execution_task: asyncio.Task[None] | None = None
        if current.status == "queued":
            execution_task = asyncio.create_task(
                execute_run(
                    database,
                    owner_user_id=owner_user_id,
                    run_id=run_id,
                    provider=request.app.state.conversation_agent,
                    agent_memory_store=request.app.state.agent_memory_store,
                    memory_analysis_provider=request.app.state.memory_agent,
                    recall_top_k=request.app.state.agent_memory_recall_top_k,
                    execution_request_id=request.state.request_id,
                )
            )
        next_sequence = after_sequence
        while True:
            with database.session() as db:
                events = run_events(db, owner_user_id, run_id, next_sequence)
                stream_owner = db.get(UserRow, owner_user_id)
                if stream_owner is None:
                    break
                current = get_run(db, stream_owner, run_id)
            for event in events:
                next_sequence = event.sequence
                payload = loads(event.payload_json, {})
                yield (
                    f"id: {event.sequence}\n"
                    f"event: {event.event_type}\n"
                    f"data: {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n\n"
                )
            if current.status in {"completed", "failed", "cancelled"}:
                break
            if execution_task is not None and execution_task.done():
                execution_task.result()
            await asyncio.sleep(0.05)
        if execution_task is not None:
            await execution_task

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/v1/agent/runs/{run_id}/cancel", response_model=AgentRunView)
def cancel_agent_run(
    run_id: str,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> AgentRunView:
    result = cancel_run(db, user, run_id)
    db.commit()
    return result


@router.post("/api/v1/agent/messages/{message_id}/feedback", response_model=FeedbackView)
def agent_message_feedback(
    message_id: str,
    body: FeedbackCreateRequest,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> FeedbackView:
    result = save_feedback(db, user, message_id, body)
    db.commit()
    return result
