from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.application.direct_chat import (
    get_or_create_conversation,
    list_conversations,
    list_messages,
    mark_read,
    send_message,
)
from app.db import UserRow
from app.schemas.direct_chat import (
    DirectConversationCreateRequest,
    DirectConversationPage,
    DirectConversationView,
    DirectMessageAcceptedView,
    DirectMessageCreateRequest,
    DirectMessagePage,
)

from ..dependencies import current_user, db_session


router = APIRouter()


@router.get("/api/v1/chat/conversations", response_model=DirectConversationPage)
def chat_conversations(
    limit: int = Query(default=50, ge=1, le=100),
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> DirectConversationPage:
    return list_conversations(db, user, limit=limit)


@router.post(
    "/api/v1/chat/conversations",
    response_model=DirectConversationView,
    status_code=status.HTTP_201_CREATED,
)
def create_chat_conversation(
    body: DirectConversationCreateRequest,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> DirectConversationView:
    result = get_or_create_conversation(db, user, body)
    db.commit()
    return result


@router.get("/api/v1/chat/conversations/{conversation_id}/messages", response_model=DirectMessagePage)
def chat_messages(
    conversation_id: str,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> DirectMessagePage:
    return list_messages(db, user, conversation_id, cursor=cursor, limit=limit)


@router.post(
    "/api/v1/chat/conversations/{conversation_id}/messages",
    response_model=DirectMessageAcceptedView,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_chat_message(
    conversation_id: str,
    body: DirectMessageCreateRequest,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> DirectMessageAcceptedView:
    result = send_message(db, user, conversation_id, body)
    db.commit()
    return result


@router.post("/api/v1/chat/conversations/{conversation_id}/read", response_model=DirectConversationView)
def read_chat(
    conversation_id: str,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> DirectConversationView:
    result = mark_read(db, user, conversation_id)
    db.commit()
    return result
