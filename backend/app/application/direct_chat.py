from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.db import (
    DirectConversationMemberRow,
    DirectConversationRow,
    DirectMessageRow,
    IntegrationOutboxRow,
    PlanetRow,
    RelationshipRow,
    UserRow,
)
from app.schemas.direct_chat import (
    DirectConversationCreateRequest,
    DirectConversationPage,
    DirectConversationView,
    DirectMessageAcceptedView,
    DirectMessageCreateRequest,
    DirectMessagePage,
    DirectMessageView,
)

from .behavior import record_user_behavior
from .errors import InvalidRequestError, ResourceNotFoundError, ResourceStateError
from .pagination import decode_cursor, encode_cursor
from .serialization import dumps, new_id


CHAT_ANALYSIS_DESTINATION = "chat_memory_analysis"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _relationship_between(db: Session, owner_id: str, target_id: str) -> RelationshipRow | None:
    return db.scalar(select(RelationshipRow).where(
        or_(
            and_(RelationshipRow.owner_user_id == owner_id, RelationshipRow.target_user_id == target_id),
            and_(RelationshipRow.owner_user_id == target_id, RelationshipRow.target_user_id == owner_id),
        )
    ))


def _conversation_for_pair(db: Session, user_id: str, target_user_id: str) -> DirectConversationRow | None:
    target_membership = select(DirectConversationMemberRow.conversation_id).where(
        DirectConversationMemberRow.user_id == target_user_id
    )
    return db.scalar(select(DirectConversationRow).where(
        DirectConversationRow.id.in_(select(DirectConversationMemberRow.conversation_id).where(
            DirectConversationMemberRow.user_id == user_id,
            DirectConversationMemberRow.conversation_id.in_(target_membership),
        ))
    ))


def _owned_conversation(db: Session, user_id: str, conversation_id: str) -> DirectConversationRow:
    row = db.scalar(select(DirectConversationRow).where(
        DirectConversationRow.id == conversation_id,
        DirectConversationRow.id.in_(select(DirectConversationMemberRow.conversation_id).where(
            DirectConversationMemberRow.user_id == user_id,
        )),
    ))
    if not row:
        raise ResourceNotFoundError("Chat conversation not found.")
    return row


def _other_member(db: Session, conversation_id: str, user_id: str) -> UserRow:
    target_id = db.scalar(select(DirectConversationMemberRow.user_id).where(
        DirectConversationMemberRow.conversation_id == conversation_id,
        DirectConversationMemberRow.user_id != user_id,
    ))
    target = db.get(UserRow, target_id) if target_id else None
    if not target:
        raise ResourceNotFoundError("Chat participant not found.")
    return target


def _serialize_conversation(
    db: Session,
    owner: UserRow,
    target: UserRow,
    conversation: DirectConversationRow | None,
) -> DirectConversationView:
    last_message = None
    unread_count = 0
    member = None
    if conversation:
        member = db.scalar(select(DirectConversationMemberRow).where(
            DirectConversationMemberRow.conversation_id == conversation.id,
            DirectConversationMemberRow.user_id == owner.id,
        ))
        last_message = db.scalar(select(DirectMessageRow).where(
            DirectMessageRow.conversation_id == conversation.id,
        ).order_by(DirectMessageRow.created_at.desc(), DirectMessageRow.id.desc()).limit(1))
        unread_statement = select(func.count()).select_from(DirectMessageRow).where(
            DirectMessageRow.conversation_id == conversation.id,
            DirectMessageRow.sender_user_id != owner.id,
        )
        if member and member.last_read_at:
            unread_statement = unread_statement.where(DirectMessageRow.created_at > member.last_read_at)
        unread_count = int(db.scalar(unread_statement) or 0)
    return DirectConversationView(
        conversation_id=conversation.id if conversation else None,
        target_user_id=target.id,
        target_name=target.display_name,
        target_bio=target.bio,
        target_planet_id=target.planet_id,
        last_message_preview=last_message.content[:160] if last_message else "",
        last_message_at=last_message.created_at if last_message else None,
        unread_count=unread_count,
        created_at=conversation.created_at if conversation else None,
        updated_at=conversation.updated_at if conversation else None,
    )


def _serialize_message(db: Session, row: DirectMessageRow, viewer_id: str) -> DirectMessageView:
    sender = db.get(UserRow, row.sender_user_id)
    return DirectMessageView(
        id=row.id,
        conversation_id=row.conversation_id,
        sender_user_id=row.sender_user_id,
        sender_name=sender.display_name if sender else "Unknown traveler",
        content=row.content,
        status=row.status,
        mine=row.sender_user_id == viewer_id,
        created_at=row.created_at,
    )


def _enqueue_chat_analysis(db: Session, owner_id: str, row: DirectMessageRow, recipient_id: str) -> None:
    dedupe_key = f"chat-message:{row.id}:analysis:v1"
    if db.scalar(select(IntegrationOutboxRow.id).where(
        IntegrationOutboxRow.destination == CHAT_ANALYSIS_DESTINATION,
        IntegrationOutboxRow.dedupe_key == dedupe_key,
    )):
        return
    db.add(IntegrationOutboxRow(
        owner_user_id=owner_id,
        destination=CHAT_ANALYSIS_DESTINATION,
        aggregate_type="direct_message",
        aggregate_id=row.id,
        aggregate_version=1,
        event_type="chat.message.analysis.requested",
        dedupe_key=dedupe_key,
        payload_json=dumps({
            "messageId": row.id,
            "conversationId": row.conversation_id,
            "senderUserId": owner_id,
            "recipientUserId": recipient_id,
        }),
    ))


def list_conversations(db: Session, owner: UserRow, *, limit: int = 50) -> DirectConversationPage:
    if limit < 1 or limit > 100:
        raise InvalidRequestError("Chat page limit must be between 1 and 100.")
    relationships = list(db.scalars(select(RelationshipRow).where(
        or_(RelationshipRow.owner_user_id == owner.id, RelationshipRow.target_user_id == owner.id),
        RelationshipRow.status == "active",
    )))
    target_ids = {
        row.target_user_id if row.owner_user_id == owner.id else row.owner_user_id
        for row in relationships
    }
    targets = list(db.scalars(select(UserRow).where(
        UserRow.id.in_(target_ids), UserRow.deleted_at.is_(None)
    ))) if target_ids else []
    items = [
        _serialize_conversation(db, owner, target, _conversation_for_pair(db, owner.id, target.id))
        for target in targets
    ]
    items.sort(key=lambda item: (
        item.last_message_at is not None,
        item.last_message_at or datetime.min.replace(tzinfo=timezone.utc),
        item.target_name.casefold(),
    ), reverse=True)
    return DirectConversationPage(items=items[:limit])


def get_or_create_conversation(
    db: Session,
    owner: UserRow,
    body: DirectConversationCreateRequest,
) -> DirectConversationView:
    if body.target_user_id == owner.id:
        raise InvalidRequestError("You cannot chat with yourself.")
    target = db.get(UserRow, body.target_user_id)
    if not target or target.deleted_at is not None:
        raise ResourceNotFoundError("Chat participant not found.")
    if not _relationship_between(db, owner.id, target.id):
        raise ResourceStateError("Add this person as a friend before starting a chat.")
    conversation = _conversation_for_pair(db, owner.id, target.id)
    if not conversation:
        now = _now()
        conversation = DirectConversationRow(id=new_id("direct-chat"), created_at=now, updated_at=now)
        db.add(conversation)
        db.flush()
        db.add_all([
            DirectConversationMemberRow(id=new_id("chat-member"), conversation_id=conversation.id, user_id=owner.id, joined_at=now),
            DirectConversationMemberRow(id=new_id("chat-member"), conversation_id=conversation.id, user_id=target.id, joined_at=now),
        ])
        db.flush()
    return _serialize_conversation(db, owner, target, conversation)


def list_messages(
    db: Session,
    owner: UserRow,
    conversation_id: str,
    *,
    cursor: str | None,
    limit: int,
) -> DirectMessagePage:
    _owned_conversation(db, owner.id, conversation_id)
    if limit < 1 or limit > 100:
        raise InvalidRequestError("Message page limit must be between 1 and 100.")
    statement = select(DirectMessageRow).where(DirectMessageRow.conversation_id == conversation_id)
    decoded = decode_cursor(cursor, size=2)
    if decoded:
        try:
            created_at = datetime.fromisoformat(str(decoded[0]))
        except ValueError as error:
            raise InvalidRequestError("Invalid pagination cursor.") from error
        message_id = str(decoded[1])
        statement = statement.where(or_(
            DirectMessageRow.created_at > created_at,
            and_(DirectMessageRow.created_at == created_at, DirectMessageRow.id > message_id),
        ))
    rows = list(db.scalars(
        statement.order_by(DirectMessageRow.created_at, DirectMessageRow.id).limit(limit + 1)
    ))
    page_rows = rows[:limit]
    next_cursor = None
    if len(rows) > limit and page_rows:
        last = page_rows[-1]
        next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
    return DirectMessagePage(
        items=[_serialize_message(db, row, owner.id) for row in page_rows],
        next_cursor=next_cursor,
    )


def send_message(
    db: Session,
    owner: UserRow,
    conversation_id: str,
    body: DirectMessageCreateRequest,
) -> DirectMessageAcceptedView:
    conversation = _owned_conversation(db, owner.id, conversation_id)
    if conversation.status != "active":
        raise ResourceStateError("This chat is no longer active.")
    content = body.content.strip()
    if not content:
        raise InvalidRequestError("Message content cannot be empty.")
    existing = db.scalar(select(DirectMessageRow).where(
        DirectMessageRow.conversation_id == conversation_id,
        DirectMessageRow.sender_user_id == owner.id,
        DirectMessageRow.client_message_id == body.client_message_id,
    ))
    if existing:
        return DirectMessageAcceptedView(
            message=_serialize_message(db, existing, owner.id),
            analysis={"status": "queued"},
        )
    recipient = _other_member(db, conversation_id, owner.id)
    now = _now()
    row = DirectMessageRow(
        id=new_id("direct-message"),
        conversation_id=conversation_id,
        sender_user_id=owner.id,
        content=content,
        client_message_id=body.client_message_id,
        status="sent",
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    conversation.last_message_at = now
    conversation.updated_at = now
    record_user_behavior(
        db,
        owner.id,
        "message_sent",
        dedupe_key=f"direct-message:{row.id}",
        target_user_id=recipient.id,
        metadata={"conversationId": conversation_id, "messageId": row.id},
    )
    db.flush()
    _enqueue_chat_analysis(db, owner.id, row, recipient.id)
    db.flush()
    return DirectMessageAcceptedView(
        message=_serialize_message(db, row, owner.id),
        analysis={"status": "queued"},
    )


def mark_read(db: Session, owner: UserRow, conversation_id: str) -> DirectConversationView:
    conversation = _owned_conversation(db, owner.id, conversation_id)
    member = db.scalar(select(DirectConversationMemberRow).where(
        DirectConversationMemberRow.conversation_id == conversation_id,
        DirectConversationMemberRow.user_id == owner.id,
    ))
    if not member:
        raise ResourceNotFoundError("Chat membership not found.")
    member.last_read_at = _now()
    target = _other_member(db, conversation_id, owner.id)
    db.flush()
    return _serialize_conversation(db, owner, target, conversation)
