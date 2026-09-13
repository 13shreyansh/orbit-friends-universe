from __future__ import annotations

import argparse
import asyncio
import json
import signal
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select, update

from app.application.memory import analyze_memory
from app.application.memory_revision import persist_confirmed_memory
from app.application.serialization import dumps, loads
from app.db import (
    DirectConversationMemberRow,
    DirectMessageRow,
    Database,
    IntegrationOutboxRow,
    RelationshipRow,
    UserRow,
)
from app.infrastructure.memory_analysis import memory_analysis_provider_from_environment
from app.schemas.memory import AnalyzeMemoryRequest


CHAT_ANALYSIS_DESTINATION = "chat_memory_analysis"


@dataclass(frozen=True)
class ClaimedChatAnalysis:
    id: int
    claim_token: str
    message_id: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _eligible(now: datetime):
    ready = and_(
        IntegrationOutboxRow.status.in_(('pending', 'retry')),
        or_(IntegrationOutboxRow.next_attempt_at.is_(None), IntegrationOutboxRow.next_attempt_at <= now),
    )
    abandoned = and_(
        IntegrationOutboxRow.status == 'processing',
        IntegrationOutboxRow.lease_expires_at.is_not(None),
        IntegrationOutboxRow.lease_expires_at <= now,
    )
    return and_(IntegrationOutboxRow.destination == CHAT_ANALYSIS_DESTINATION, or_(ready, abandoned))


def claim_events(database: Database, *, batch_size: int = 10, lease_seconds: int = 180) -> list[ClaimedChatAnalysis]:
    claimed_at = _now()
    claim_token = uuid.uuid4().hex
    lease_expires_at = claimed_at + timedelta(seconds=lease_seconds)
    claimed_ids: list[int] = []
    with database.session() as db:
        candidates = list(db.scalars(
            select(IntegrationOutboxRow.id)
            .where(_eligible(claimed_at))
            .order_by(IntegrationOutboxRow.created_at, IntegrationOutboxRow.id)
            .limit(batch_size * 4)
        ))
        for event_id in candidates:
            result = db.execute(update(IntegrationOutboxRow).where(
                IntegrationOutboxRow.id == event_id, _eligible(claimed_at)
            ).values(
                status='processing', claim_token=claim_token, claimed_at=claimed_at,
                lease_expires_at=lease_expires_at, updated_at=claimed_at,
            ))
            if result.rowcount:
                claimed_ids.append(event_id)
            if len(claimed_ids) >= batch_size:
                break
        rows = list(db.scalars(select(IntegrationOutboxRow).where(
            IntegrationOutboxRow.id.in_(claimed_ids),
            IntegrationOutboxRow.claim_token == claim_token,
        ))) if claimed_ids else []
        return [ClaimedChatAnalysis(row.id, claim_token, row.aggregate_id) for row in rows]


def _complete(database: Database, claimed: ClaimedChatAnalysis) -> None:
    with database.session() as db:
        event = db.scalar(select(IntegrationOutboxRow).where(
            IntegrationOutboxRow.id == claimed.id,
            IntegrationOutboxRow.status == 'processing',
            IntegrationOutboxRow.claim_token == claimed.claim_token,
        ))
        if not event:
            return
        event.status = 'completed'
        event.last_error = ''
        event.claim_token = None
        event.claimed_at = None
        event.lease_expires_at = None
        event.next_attempt_at = None
        event.processed_at = _now()
        event.updated_at = event.processed_at


async def _process_event(database: Database, provider: object, claimed: ClaimedChatAnalysis) -> None:
    with database.session() as db:
        event = db.scalar(select(IntegrationOutboxRow).where(
            IntegrationOutboxRow.id == claimed.id,
            IntegrationOutboxRow.status == 'processing',
            IntegrationOutboxRow.claim_token == claimed.claim_token,
        ).with_for_update())
        if not event:
            raise RuntimeError('Chat analysis lease was lost before processing.')
        message = db.get(DirectMessageRow, claimed.message_id)
        sender = db.get(UserRow, event.owner_user_id)
        recipient_id = db.scalar(select(DirectConversationMemberRow.user_id).where(
            DirectConversationMemberRow.conversation_id == message.conversation_id,
            DirectConversationMemberRow.user_id != event.owner_user_id,
        )) if message else None
        relationship = db.scalar(select(RelationshipRow).where(
            RelationshipRow.owner_user_id == event.owner_user_id,
            RelationshipRow.target_user_id == recipient_id,
        )) if recipient_id else None
        if not message or not sender or not relationship:
            _complete(database, claimed)
            return
        memory = await analyze_memory(db, sender, AnalyzeMemoryRequest(
            source_type='text', raw_text=message.content,
        ), provider)
        persist_confirmed_memory(
            db,
            sender,
            memory,
            relationship_id=relationship.id,
            reason='chat_message',
        )
    _complete(database, claimed)


def _fail(database: Database, claimed: ClaimedChatAnalysis, error: Exception, *, max_attempts: int) -> bool:
    now = _now()
    with database.session() as db:
        event = db.scalar(select(IntegrationOutboxRow).where(
            IntegrationOutboxRow.id == claimed.id,
            IntegrationOutboxRow.status == 'processing',
            IntegrationOutboxRow.claim_token == claimed.claim_token,
        ))
        if not event:
            return False
        event.attempts += 1
        event.last_error = str(error)[:2000]
        event.claim_token = None
        event.claimed_at = None
        event.lease_expires_at = None
        event.updated_at = now
        dead_lettered = event.attempts >= max_attempts
        if dead_lettered:
            event.status = 'dead_letter'
            event.dead_lettered_at = now
            event.next_attempt_at = None
        else:
            event.status = 'retry'
            event.next_attempt_at = now + timedelta(seconds=min(900, 5 * (2 ** (event.attempts - 1))))
        return dead_lettered


async def drain_once(database: Database, provider: object, *, batch_size: int = 10, max_attempts: int = 8) -> dict[str, int]:
    claimed = claim_events(database, batch_size=batch_size)
    result = {'claimed': len(claimed), 'completed': 0, 'failed': 0, 'dead_lettered': 0}
    for event in claimed:
        try:
            await _process_event(database, provider, event)
            result['completed'] += 1
        except Exception as error:  # noqa: BLE001 - durable queue owns retries
            dead_lettered = _fail(database, event, error, max_attempts=max_attempts)
            result['failed'] += 1
            result['dead_lettered'] += int(dead_lettered)
    return result


async def run_worker(database: Database, provider: object, *, poll_seconds: float = 2.0, once: bool = False) -> int:
    stop = asyncio.Event()
    total_failed = 0
    while not stop.is_set():
        result = await drain_once(database, provider)
        if once or result['claimed']:
            print(json.dumps(result, ensure_ascii=False, sort_keys=True), flush=True)
        total_failed += result['failed']
        if once:
            break
        try:
            await asyncio.wait_for(stop.wait(), timeout=poll_seconds)
        except asyncio.TimeoutError:
            pass
    return int(once and total_failed > 0)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='Analyze direct chat messages outside the request path.')
    parser.add_argument('--database-url')
    parser.add_argument('--poll-seconds', type=float, default=2.0)
    parser.add_argument('--once', action='store_true')
    return parser


async def _main_async(args: argparse.Namespace) -> int:
    database = Database(args.database_url)
    provider = memory_analysis_provider_from_environment()
    return await run_worker(database, provider, poll_seconds=args.poll_seconds, once=args.once)


def main(argv: Sequence[str] | None = None) -> int:
    return asyncio.run(_main_async(build_parser().parse_args(argv)))


if __name__ == '__main__':
    raise SystemExit(main())
