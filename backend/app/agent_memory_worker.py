from __future__ import annotations

import argparse
import asyncio
import inspect
import json
import signal
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, or_, select, update

from app.db import (
    AgentMemorySessionRow,
    AgentMemorySyncStateRow,
    Database,
    IntegrationOutboxRow,
)
from app.domain.agent_memory_policy import AGENT_MEMORY_DESTINATION
from app.infrastructure.openviking_memory import openviking_memory_from_environment
from app.ports.agent_memory import AgentMemoryCommit, AgentMemorySession, AgentMemoryStore


SUCCESS_TASK_STATUSES = {"completed", "success", "succeeded", "skipped"}
PENDING_TASK_STATUSES = {"accepted", "queued", "pending", "running", "processing"}


class AgentMemoryTaskPending(RuntimeError):
    pass


@dataclass(frozen=True)
class ClaimedAgentMemoryEvent:
    id: int
    claim_token: str
    owner_user_id: str
    aggregate_id: str
    aggregate_version: int
    event_type: str
    dedupe_key: str
    payload: dict[str, Any]
    attempts: int


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _eligible_outbox(now: datetime):
    ready = and_(
        IntegrationOutboxRow.status.in_(("pending", "retry")),
        or_(
            IntegrationOutboxRow.next_attempt_at.is_(None),
            IntegrationOutboxRow.next_attempt_at <= now,
        ),
    )
    abandoned = and_(
        IntegrationOutboxRow.status == "processing",
        IntegrationOutboxRow.lease_expires_at.is_not(None),
        IntegrationOutboxRow.lease_expires_at <= now,
    )
    return and_(
        IntegrationOutboxRow.destination == AGENT_MEMORY_DESTINATION,
        or_(ready, abandoned),
    )


def claim_events(
    database: Database,
    *,
    batch_size: int = 10,
    lease_seconds: int = 120,
    now: datetime | None = None,
) -> list[ClaimedAgentMemoryEvent]:
    if batch_size < 1:
        raise ValueError("batch_size must be at least 1")
    if lease_seconds < 1:
        raise ValueError("lease_seconds must be at least 1")
    claimed_at = now or _utcnow()
    lease_expires_at = claimed_at + timedelta(seconds=lease_seconds)
    claim_token = uuid.uuid4().hex
    claimed_ids: list[int] = []
    with database.session() as db:
        candidate_ids = list(
            db.scalars(
                select(IntegrationOutboxRow.id)
                .where(_eligible_outbox(claimed_at))
                .order_by(IntegrationOutboxRow.created_at, IntegrationOutboxRow.id)
                .limit(batch_size * 4)
            )
        )
        for event_id in candidate_ids:
            result = db.execute(
                update(IntegrationOutboxRow)
                .where(IntegrationOutboxRow.id == event_id, _eligible_outbox(claimed_at))
                .values(
                    status="processing",
                    claim_token=claim_token,
                    claimed_at=claimed_at,
                    lease_expires_at=lease_expires_at,
                    updated_at=claimed_at,
                )
            )
            if result.rowcount:
                claimed_ids.append(event_id)
            if len(claimed_ids) >= batch_size:
                break
        rows = list(
            db.scalars(
                select(IntegrationOutboxRow)
                .where(
                    IntegrationOutboxRow.id.in_(claimed_ids),
                    IntegrationOutboxRow.claim_token == claim_token,
                )
                .order_by(IntegrationOutboxRow.created_at, IntegrationOutboxRow.id)
            )
        ) if claimed_ids else []
        return [
            ClaimedAgentMemoryEvent(
                id=row.id,
                claim_token=claim_token,
                owner_user_id=row.owner_user_id,
                aggregate_id=row.aggregate_id,
                aggregate_version=row.aggregate_version,
                event_type=row.event_type,
                dedupe_key=row.dedupe_key,
                payload=json.loads(row.payload_json),
                attempts=row.attempts,
            )
            for row in rows
        ]


def _provider_name(store: AgentMemoryStore) -> str:
    return str(getattr(store, "provider_name", "agent_memory"))


def _has_unfinished_predecessor(database: Database, event: ClaimedAgentMemoryEvent) -> bool:
    with database.session() as db:
        return db.scalar(
            select(IntegrationOutboxRow.id)
            .where(
                IntegrationOutboxRow.owner_user_id == event.owner_user_id,
                IntegrationOutboxRow.destination == AGENT_MEMORY_DESTINATION,
                IntegrationOutboxRow.aggregate_type == "memory",
                IntegrationOutboxRow.aggregate_id == event.aggregate_id,
                IntegrationOutboxRow.aggregate_version < event.aggregate_version,
                IntegrationOutboxRow.status.not_in(("completed", "cancelled")),
            )
            .limit(1)
        ) is not None


def _sync_checkpoint(
    database: Database,
    event: ClaimedAgentMemoryEvent,
    provider: str,
) -> tuple[str, str] | None:
    with database.session() as db:
        state = db.scalar(
            select(AgentMemorySyncStateRow).where(
                AgentMemorySyncStateRow.owner_user_id == event.owner_user_id,
                AgentMemorySyncStateRow.provider == provider,
                AgentMemorySyncStateRow.object_key == event.aggregate_id,
            )
        )
        if not state:
            return None
        if state.version > event.aggregate_version:
            return ("superseded", "")
        if state.version == event.aggregate_version and state.status in {"completed", "deleted"}:
            return (state.status, state.external_task_id or "")
        if state.version == event.aggregate_version and state.external_task_id:
            return (state.status, state.external_task_id)
        return None


def _record_session(
    database: Database,
    event: ClaimedAgentMemoryEvent,
    provider: str,
    session_key: str,
    session: AgentMemorySession,
) -> str:
    now = _utcnow()
    with database.session() as db:
        row = db.scalar(
            select(AgentMemorySessionRow).where(
                AgentMemorySessionRow.owner_user_id == event.owner_user_id,
                AgentMemorySessionRow.provider == provider,
                AgentMemorySessionRow.session_key == session_key,
            )
        )
        if not row:
            row = AgentMemorySessionRow(
                id=f"agent-session-{uuid.uuid4().hex}",
                owner_user_id=event.owner_user_id,
                provider=provider,
                session_key=session_key,
                external_session_id=session.external_session_id,
                object_key=event.aggregate_id,
            )
            db.add(row)
        else:
            row.external_session_id = session.external_session_id
            row.status = "active"
            row.updated_at = now
        db.flush()
        return row.id


def _session_key_for_event(
    database: Database,
    event: ClaimedAgentMemoryEvent,
    provider: str,
) -> str:
    replay_prefix = f"{event.dedupe_key}:replay:"
    with database.session() as db:
        sessions = list(
            db.scalars(
                select(AgentMemorySessionRow)
                .where(
                    AgentMemorySessionRow.owner_user_id == event.owner_user_id,
                    AgentMemorySessionRow.provider == provider,
                    AgentMemorySessionRow.object_key == event.aggregate_id,
                    or_(
                        AgentMemorySessionRow.session_key == event.dedupe_key,
                        AgentMemorySessionRow.session_key.like(f"{replay_prefix}%"),
                    ),
                )
                .order_by(AgentMemorySessionRow.created_at.desc(), AgentMemorySessionRow.id.desc())
            )
        )
    active = next((row for row in sessions if row.status == "active"), None)
    if active:
        return active.session_key
    return event.dedupe_key if not sessions else f"{replay_prefix}{len(sessions)}"


def _record_syncing(
    database: Database,
    event: ClaimedAgentMemoryEvent,
    provider: str,
    local_session_id: str,
    task: AgentMemoryCommit,
) -> None:
    now = _utcnow()
    with database.session() as db:
        state = db.scalar(
            select(AgentMemorySyncStateRow).where(
                AgentMemorySyncStateRow.owner_user_id == event.owner_user_id,
                AgentMemorySyncStateRow.provider == provider,
                AgentMemorySyncStateRow.object_key == event.aggregate_id,
            )
        )
        if not state:
            state = AgentMemorySyncStateRow(
                id=f"agent-sync-{uuid.uuid4().hex}",
                owner_user_id=event.owner_user_id,
                provider=provider,
                object_key=event.aggregate_id,
            )
            db.add(state)
        state.version = event.aggregate_version
        state.status = "syncing"
        state.session_id = local_session_id
        state.outbox_id = event.id
        state.external_task_id = task.task_id or None
        state.attempts = event.attempts
        state.last_error = ""
        state.updated_at = now
        session_row = db.get(AgentMemorySessionRow, local_session_id)
        if session_row:
            session_row.last_commit_task_id = task.task_id or None
            session_row.last_commit_status = task.status
            session_row.updated_at = now


def _complete_upsert(
    database: Database,
    event: ClaimedAgentMemoryEvent,
    provider: str,
    local_session_id: str | None,
    task: AgentMemoryCommit | None,
) -> bool:
    now = _utcnow()
    with database.session() as db:
        outbox = db.scalar(
            select(IntegrationOutboxRow).where(
                IntegrationOutboxRow.id == event.id,
                IntegrationOutboxRow.claim_token == event.claim_token,
                IntegrationOutboxRow.status == "processing",
            )
        )
        if not outbox:
            return False
        state = db.scalar(
            select(AgentMemorySyncStateRow).where(
                AgentMemorySyncStateRow.owner_user_id == event.owner_user_id,
                AgentMemorySyncStateRow.provider == provider,
                AgentMemorySyncStateRow.object_key == event.aggregate_id,
            )
        )
        if not state:
            state = AgentMemorySyncStateRow(
                id=f"agent-sync-{uuid.uuid4().hex}",
                owner_user_id=event.owner_user_id,
                provider=provider,
                object_key=event.aggregate_id,
            )
            db.add(state)
        if state.version <= event.aggregate_version:
            state.version = event.aggregate_version
            state.status = "completed"
            if local_session_id is not None:
                state.session_id = local_session_id
            state.outbox_id = event.id
            state.external_task_id = task.task_id if task and task.task_id else state.external_task_id
            state.attempts = outbox.attempts
            state.last_error = ""
            state.synced_at = now
            state.updated_at = now
        if local_session_id:
            session_row = db.get(AgentMemorySessionRow, local_session_id)
            if session_row:
                session_row.last_commit_status = task.status if task else "completed"
                session_row.updated_at = now
        outbox.status = "completed"
        outbox.last_error = ""
        outbox.claim_token = None
        outbox.claimed_at = None
        outbox.lease_expires_at = None
        outbox.next_attempt_at = None
        outbox.processed_at = now
        outbox.updated_at = now
        return True


def _complete_delete(
    database: Database,
    event: ClaimedAgentMemoryEvent,
    provider: str,
) -> bool:
    now = _utcnow()
    with database.session() as db:
        outbox = db.scalar(
            select(IntegrationOutboxRow).where(
                IntegrationOutboxRow.id == event.id,
                IntegrationOutboxRow.claim_token == event.claim_token,
                IntegrationOutboxRow.status == "processing",
            )
        )
        if not outbox:
            return False
        sessions = list(
            db.scalars(
                select(AgentMemorySessionRow).where(
                    AgentMemorySessionRow.owner_user_id == event.owner_user_id,
                    AgentMemorySessionRow.provider == provider,
                    AgentMemorySessionRow.object_key == event.aggregate_id,
                )
            )
        )
        for session_row in sessions:
            session_row.status = "deleted"
            session_row.updated_at = now
        state = db.scalar(
            select(AgentMemorySyncStateRow).where(
                AgentMemorySyncStateRow.owner_user_id == event.owner_user_id,
                AgentMemorySyncStateRow.provider == provider,
                AgentMemorySyncStateRow.object_key == event.aggregate_id,
            )
        )
        if not state:
            state = AgentMemorySyncStateRow(
                id=f"agent-sync-{uuid.uuid4().hex}",
                owner_user_id=event.owner_user_id,
                provider=provider,
                object_key=event.aggregate_id,
            )
            db.add(state)
        state.version = event.aggregate_version
        state.status = "deleted"
        state.session_id = None
        state.outbox_id = event.id
        state.external_task_id = None
        state.attempts = outbox.attempts
        state.last_error = ""
        state.synced_at = now
        state.updated_at = now
        outbox.status = "completed"
        outbox.last_error = ""
        outbox.claim_token = None
        outbox.claimed_at = None
        outbox.lease_expires_at = None
        outbox.next_attempt_at = None
        outbox.processed_at = now
        outbox.updated_at = now
        return True


def _defer_claim(
    database: Database,
    event: ClaimedAgentMemoryEvent,
    reason: str,
    *,
    retry_seconds: float,
) -> None:
    now = _utcnow()
    with database.session() as db:
        db.execute(
            update(IntegrationOutboxRow)
            .where(
                IntegrationOutboxRow.id == event.id,
                IntegrationOutboxRow.claim_token == event.claim_token,
                IntegrationOutboxRow.status == "processing",
            )
            .values(
                status="retry",
                last_error=reason[:2000],
                next_attempt_at=now + timedelta(seconds=max(0.0, retry_seconds)),
                claim_token=None,
                claimed_at=None,
                lease_expires_at=None,
                updated_at=now,
            )
        )


def _fail_claim(
    database: Database,
    event: ClaimedAgentMemoryEvent,
    provider: str,
    error: Exception,
    *,
    max_attempts: int,
    backoff_base_seconds: float,
    backoff_max_seconds: float,
) -> bool:
    now = _utcnow()
    dead_lettered = False
    with database.session() as db:
        outbox = db.scalar(
            select(IntegrationOutboxRow).where(
                IntegrationOutboxRow.id == event.id,
                IntegrationOutboxRow.claim_token == event.claim_token,
                IntegrationOutboxRow.status == "processing",
            )
        )
        if not outbox:
            return False
        outbox.attempts += 1
        outbox.last_error = str(error)[:2000]
        outbox.claim_token = None
        outbox.claimed_at = None
        outbox.lease_expires_at = None
        outbox.updated_at = now
        if outbox.attempts >= max_attempts:
            outbox.status = "dead_letter"
            outbox.dead_lettered_at = now
            outbox.next_attempt_at = None
            dead_lettered = True
        else:
            delay = min(backoff_max_seconds, backoff_base_seconds * (2 ** (outbox.attempts - 1)))
            outbox.status = "retry"
            outbox.next_attempt_at = now + timedelta(seconds=max(0.0, delay))
        state = db.scalar(
            select(AgentMemorySyncStateRow).where(
                AgentMemorySyncStateRow.owner_user_id == event.owner_user_id,
                AgentMemorySyncStateRow.provider == provider,
                AgentMemorySyncStateRow.object_key == event.aggregate_id,
            )
        )
        if not state:
            session_row = db.scalar(
                select(AgentMemorySessionRow).where(
                    AgentMemorySessionRow.owner_user_id == event.owner_user_id,
                    AgentMemorySessionRow.provider == provider,
                    AgentMemorySessionRow.session_key == event.dedupe_key,
                )
            )
            state = AgentMemorySyncStateRow(
                id=f"agent-sync-{uuid.uuid4().hex}",
                owner_user_id=event.owner_user_id,
                provider=provider,
                object_key=event.aggregate_id,
                version=0,
                session_id=session_row.id if session_row else None,
            )
            db.add(state)
        if state.version <= event.aggregate_version:
            state.version = event.aggregate_version
            state.status = "dead_letter" if dead_lettered else "failed"
            state.outbox_id = event.id
            state.attempts = outbox.attempts
            state.last_error = outbox.last_error
            state.updated_at = now
    return dead_lettered


async def _await_task(
    store: AgentMemoryStore,
    task: AgentMemoryCommit,
    *,
    user_id: str,
    poll_attempts: int,
    poll_seconds: float,
) -> AgentMemoryCommit:
    current = task
    if current.status.lower() in SUCCESS_TASK_STATUSES:
        return current
    if not current.task_id:
        raise RuntimeError(f"Agent Memory commit returned {current.status!r} without a task id")
    for attempt in range(max(1, poll_attempts)):
        if attempt and poll_seconds > 0:
            await asyncio.sleep(poll_seconds)
        current = await store.get_task(task_id=current.task_id, user_id=user_id)
        status = current.status.lower()
        if status in SUCCESS_TASK_STATUSES:
            return current
        if status not in PENDING_TASK_STATUSES:
            raise RuntimeError(f"Agent Memory task {current.task_id} failed with status {current.status}")
    raise AgentMemoryTaskPending(f"Agent Memory task {current.task_id} is still {current.status}")


async def _process_upsert(
    database: Database,
    store: AgentMemoryStore,
    event: ClaimedAgentMemoryEvent,
    *,
    provider: str,
    task_poll_attempts: int,
    task_poll_seconds: float,
) -> None:
    memory = event.payload.get("memory")
    if not isinstance(memory, dict) or event.payload.get("redacted"):
        raise ValueError("Agent Memory upsert payload is missing its confirmed memory document")
    checkpoint = _sync_checkpoint(database, event, provider)
    if checkpoint and checkpoint[0] in {"completed", "superseded"}:
        _complete_upsert(database, event, provider, None, None)
        return

    session_key = _session_key_for_event(database, event, provider)
    session = await store.get_or_create_session(user_id=event.owner_user_id, session_key=session_key)
    local_session_id = _record_session(database, event, provider, session_key, session)
    task: AgentMemoryCommit | None = None
    if checkpoint and checkpoint[1]:
        task = AgentMemoryCommit(checkpoint[1], "pending")
    elif session.commit_count > 0:
        task = await store.latest_task(session=session)
    if task is None:
        await store.append(
            session=session,
            role="user",
            content=event.payload,
            dedupe_key=session_key,
        )
        task = await store.commit(session=session)
    _record_syncing(database, event, provider, local_session_id, task)
    completed = await _await_task(
        store,
        task,
        user_id=event.owner_user_id,
        poll_attempts=task_poll_attempts,
        poll_seconds=task_poll_seconds,
    )
    if not _complete_upsert(database, event, provider, local_session_id, completed):
        raise RuntimeError("Agent Memory outbox lease was lost before completion")


async def _process_delete(
    database: Database,
    store: AgentMemoryStore,
    event: ClaimedAgentMemoryEvent,
    *,
    provider: str,
) -> None:
    with database.session() as db:
        external_session_ids = list(
            db.scalars(
                select(AgentMemorySessionRow.external_session_id)
                .where(
                    AgentMemorySessionRow.owner_user_id == event.owner_user_id,
                    AgentMemorySessionRow.provider == provider,
                    AgentMemorySessionRow.object_key == event.aggregate_id,
                    AgentMemorySessionRow.status != "deleted",
                )
                .order_by(AgentMemorySessionRow.created_at.desc())
            )
        )
    for external_session_id in external_session_ids:
        await store.delete(user_id=event.owner_user_id, object_key=external_session_id)
    if not _complete_delete(database, event, provider):
        raise RuntimeError("Agent Memory outbox lease was lost before deletion completed")


async def drain_once(
    database: Database,
    store: AgentMemoryStore,
    *,
    batch_size: int = 10,
    lease_seconds: int = 120,
    max_attempts: int = 8,
    backoff_base_seconds: float = 5.0,
    backoff_max_seconds: float = 900.0,
    task_poll_attempts: int = 3,
    task_poll_seconds: float = 1.0,
) -> dict[str, int]:
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")
    provider = _provider_name(store)
    events = claim_events(database, batch_size=batch_size, lease_seconds=lease_seconds)
    result = {"claimed": len(events), "completed": 0, "deferred": 0, "failed": 0, "dead_lettered": 0}
    for event in events:
        try:
            if _has_unfinished_predecessor(database, event):
                raise AgentMemoryTaskPending("Waiting for an earlier memory version to finish")
            if event.event_type == "memory.upserted":
                await _process_upsert(
                    database,
                    store,
                    event,
                    provider=provider,
                    task_poll_attempts=task_poll_attempts,
                    task_poll_seconds=task_poll_seconds,
                )
            elif event.event_type == "memory.deleted":
                await _process_delete(database, store, event, provider=provider)
            else:
                raise ValueError(f"Unsupported Agent Memory event type: {event.event_type}")
            result["completed"] += 1
        except AgentMemoryTaskPending as pending:
            _defer_claim(database, event, str(pending), retry_seconds=max(1.0, task_poll_seconds))
            result["deferred"] += 1
        except Exception as error:
            dead_lettered = _fail_claim(
                database,
                event,
                provider,
                error,
                max_attempts=max_attempts,
                backoff_base_seconds=backoff_base_seconds,
                backoff_max_seconds=backoff_max_seconds,
            )
            result["failed"] += 1
            result["dead_lettered"] += int(dead_lettered)
    return result


def replay_dead_letter(database: Database, event_id: int) -> dict[str, Any]:
    now = _utcnow()
    with database.session() as db:
        event = db.scalar(
            select(IntegrationOutboxRow).where(
                IntegrationOutboxRow.id == event_id,
                IntegrationOutboxRow.destination == AGENT_MEMORY_DESTINATION,
            )
        )
        if not event:
            raise ValueError("Agent Memory outbox event was not found")
        if event.status != "dead_letter":
            raise ValueError("Only dead-letter Agent Memory events can be replayed")
        payload = json.loads(event.payload_json)
        if event.event_type == "memory.upserted" and (
            payload.get("redacted") or not isinstance(payload.get("memory"), dict)
        ):
            raise ValueError("Redacted or incomplete upsert events cannot be replayed")
        if event.event_type not in {"memory.upserted", "memory.deleted"}:
            raise ValueError("Unsupported Agent Memory event type")
        if event.event_type == "memory.upserted":
            state = db.scalar(
                select(AgentMemorySyncStateRow).where(AgentMemorySyncStateRow.outbox_id == event.id)
            )
            if state:
                if state.session_id:
                    failed_session = db.get(AgentMemorySessionRow, state.session_id)
                    if failed_session:
                        failed_session.status = "failed"
                        failed_session.updated_at = now
                state.status = "pending"
                state.session_id = None
                state.external_task_id = None
                state.attempts = 0
                state.last_error = ""
                state.updated_at = now
        event.status = "pending"
        event.attempts = 0
        event.last_error = ""
        event.next_attempt_at = now
        event.claim_token = None
        event.claimed_at = None
        event.lease_expires_at = None
        event.dead_lettered_at = None
        event.processed_at = None
        event.updated_at = now
        return {"eventId": event.id, "status": event.status, "eventType": event.event_type}


async def run_worker(
    database: Database,
    store: AgentMemoryStore,
    *,
    batch_size: int = 10,
    lease_seconds: int = 120,
    max_attempts: int = 8,
    poll_seconds: float = 5.0,
    once: bool = False,
    stop_event: asyncio.Event | None = None,
) -> int:
    if poll_seconds <= 0:
        raise ValueError("poll_seconds must be greater than 0")
    stop = stop_event or asyncio.Event()
    total_failed = 0
    while not stop.is_set():
        result = await drain_once(
            database,
            store,
            batch_size=batch_size,
            lease_seconds=lease_seconds,
            max_attempts=max_attempts,
        )
        if once or result["claimed"]:
            print(json.dumps(result, ensure_ascii=False, sort_keys=True), flush=True)
        total_failed += result["failed"]
        if once:
            break
        if result["claimed"] >= batch_size and not result["failed"]:
            continue
        try:
            await asyncio.wait_for(stop.wait(), timeout=poll_seconds)
        except asyncio.TimeoutError:
            pass
    return 1 if once and total_failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Drain the Social Cosmos Agent Memory integration outbox.")
    parser.add_argument("--database-url", help="Override SOCIAL_COSMOS_DATABASE_URL.")
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--lease-seconds", type=int, default=120)
    parser.add_argument("--max-attempts", type=int, default=8)
    parser.add_argument("--poll-seconds", type=float, default=5.0)
    parser.add_argument("--once", action="store_true", help="Process one batch and exit.")
    parser.add_argument("--replay-event", type=int, help="Safely reset one dead-letter event, then exit.")
    return parser


async def _main_async(args: argparse.Namespace) -> int:
    database = Database(args.database_url)
    if args.replay_event is not None:
        print(json.dumps(replay_dead_letter(database, args.replay_event), sort_keys=True), flush=True)
        database.engine.dispose()
        return 0
    store = openviking_memory_from_environment()
    stop = asyncio.Event()

    def request_stop(_signum: int, _frame: object) -> None:
        stop.set()

    signal.signal(signal.SIGINT, request_stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, request_stop)
    try:
        return await run_worker(
            database,
            store,
            batch_size=args.batch_size,
            lease_seconds=args.lease_seconds,
            max_attempts=args.max_attempts,
            poll_seconds=args.poll_seconds,
            once=args.once,
            stop_event=stop,
        )
    finally:
        close = getattr(store, "close", None)
        if close:
            result = close()
            if inspect.isawaitable(result):
                await result
        database.engine.dispose()


def main(argv: Sequence[str] | None = None) -> int:
    return asyncio.run(_main_async(build_parser().parse_args(argv)))


if __name__ == "__main__":
    raise SystemExit(main())
