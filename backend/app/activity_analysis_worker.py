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

from app.application.activity import (
    ACTIVITY_ANALYSIS_DESTINATION,
    analyze_activity_in_background,
)
from app.application.serialization import dumps, loads
from app.db import ActivityPostRow, Database, IntegrationOutboxRow, UserRow
from app.infrastructure.memory_analysis import memory_analysis_provider_from_environment
from app.ports.analysis_provider import MemoryAnalysisProvider


@dataclass(frozen=True)
class ClaimedActivityAnalysis:
    id: int
    claim_token: str
    activity_id: str


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _eligible(now: datetime):
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
        IntegrationOutboxRow.destination == ACTIVITY_ANALYSIS_DESTINATION,
        or_(ready, abandoned),
    )


def claim_events(
    database: Database,
    *,
    batch_size: int = 5,
    lease_seconds: int = 180,
    now: datetime | None = None,
) -> list[ClaimedActivityAnalysis]:
    if batch_size < 1:
        raise ValueError("batch_size must be at least 1")
    if lease_seconds < 1:
        raise ValueError("lease_seconds must be at least 1")
    claimed_at = now or _utcnow()
    claim_token = uuid.uuid4().hex
    lease_expires_at = claimed_at + timedelta(seconds=lease_seconds)
    claimed_ids: list[int] = []
    with database.session() as db:
        candidate_ids = list(db.scalars(
            select(IntegrationOutboxRow.id)
            .where(_eligible(claimed_at))
            .order_by(IntegrationOutboxRow.created_at, IntegrationOutboxRow.id)
            .limit(batch_size * 4)
        ))
        for event_id in candidate_ids:
            result = db.execute(
                update(IntegrationOutboxRow)
                .where(IntegrationOutboxRow.id == event_id, _eligible(claimed_at))
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
        rows = list(db.scalars(
            select(IntegrationOutboxRow)
            .where(
                IntegrationOutboxRow.id.in_(claimed_ids),
                IntegrationOutboxRow.claim_token == claim_token,
            )
            .order_by(IntegrationOutboxRow.created_at, IntegrationOutboxRow.id)
        )) if claimed_ids else []
        return [
            ClaimedActivityAnalysis(row.id, claim_token, row.aggregate_id)
            for row in rows
        ]


def _complete_event(event: IntegrationOutboxRow, now: datetime) -> None:
    event.status = "completed"
    event.last_error = ""
    event.claim_token = None
    event.claimed_at = None
    event.lease_expires_at = None
    event.next_attempt_at = None
    event.processed_at = now
    event.updated_at = now


async def _process_event(
    database: Database,
    provider: MemoryAnalysisProvider,
    claimed: ClaimedActivityAnalysis,
) -> None:
    with database.session() as db:
        event = db.scalar(
            select(IntegrationOutboxRow)
            .where(
                IntegrationOutboxRow.id == claimed.id,
                IntegrationOutboxRow.status == "processing",
                IntegrationOutboxRow.claim_token == claimed.claim_token,
                IntegrationOutboxRow.destination == ACTIVITY_ANALYSIS_DESTINATION,
            )
            .with_for_update()
        )
        if not event:
            raise RuntimeError("Activity analysis lease was lost before processing.")
        activity = db.get(ActivityPostRow, claimed.activity_id)
        owner = db.get(UserRow, event.owner_user_id)
        if not activity or not owner:
            raise RuntimeError("Activity analysis source no longer exists.")
        content = loads(activity.content_json, {})
        if content.get("analysisStatus") != "completed":
            await analyze_activity_in_background(db, activity, owner, provider)
        _complete_event(event, _utcnow())


def _fail_event(
    database: Database,
    claimed: ClaimedActivityAnalysis,
    error: Exception,
    *,
    max_attempts: int,
    backoff_base_seconds: float,
    backoff_max_seconds: float,
) -> bool:
    now = _utcnow()
    with database.session() as db:
        event = db.scalar(select(IntegrationOutboxRow).where(
            IntegrationOutboxRow.id == claimed.id,
            IntegrationOutboxRow.status == "processing",
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
            event.status = "dead_letter"
            event.dead_lettered_at = now
            event.next_attempt_at = None
        else:
            delay = min(backoff_max_seconds, backoff_base_seconds * (2 ** (event.attempts - 1)))
            event.status = "retry"
            event.next_attempt_at = now + timedelta(seconds=max(0.0, delay))
        activity = db.get(ActivityPostRow, claimed.activity_id)
        if activity:
            content = loads(activity.content_json, {})
            content["analysisStatus"] = "unavailable" if dead_lettered else "queued"
            activity.content_json = dumps(content)
            activity.updated_at = now
        return dead_lettered


async def drain_once(
    database: Database,
    provider: MemoryAnalysisProvider,
    *,
    batch_size: int = 5,
    lease_seconds: int = 180,
    max_attempts: int = 5,
    backoff_base_seconds: float = 5.0,
    backoff_max_seconds: float = 300.0,
) -> dict[str, int]:
    claimed = claim_events(database, batch_size=batch_size, lease_seconds=lease_seconds)
    result = {"claimed": len(claimed), "completed": 0, "failed": 0, "dead_lettered": 0}
    for event in claimed:
        try:
            await _process_event(database, provider, event)
            result["completed"] += 1
        except Exception as error:  # noqa: BLE001 - the durable queue owns retries
            dead_lettered = _fail_event(
                database,
                event,
                error,
                max_attempts=max_attempts,
                backoff_base_seconds=backoff_base_seconds,
                backoff_max_seconds=backoff_max_seconds,
            )
            result["failed"] += 1
            result["dead_lettered"] += int(dead_lettered)
    return result


async def run_worker(
    database: Database,
    provider: MemoryAnalysisProvider,
    *,
    batch_size: int = 5,
    lease_seconds: int = 180,
    max_attempts: int = 5,
    poll_seconds: float = 2.0,
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
            provider,
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
    parser = argparse.ArgumentParser(description="Analyze activity content outside the user request path.")
    parser.add_argument("--database-url", help="Override SOCIAL_COSMOS_DATABASE_URL.")
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--lease-seconds", type=int, default=180)
    parser.add_argument("--max-attempts", type=int, default=5)
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    parser.add_argument("--once", action="store_true")
    return parser


async def _main_async(args: argparse.Namespace) -> int:
    database = Database(args.database_url)
    provider = memory_analysis_provider_from_environment()
    stop = asyncio.Event()

    def request_stop(_signum: int, _frame: object) -> None:
        stop.set()

    signal.signal(signal.SIGINT, request_stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, request_stop)
    try:
        return await run_worker(
            database,
            provider,
            batch_size=args.batch_size,
            lease_seconds=args.lease_seconds,
            max_attempts=args.max_attempts,
            poll_seconds=args.poll_seconds,
            once=args.once,
            stop_event=stop,
        )
    finally:
        database.engine.dispose()


def main(argv: Sequence[str] | None = None) -> int:
    return asyncio.run(_main_async(build_parser().parse_args(argv)))


if __name__ == "__main__":
    raise SystemExit(main())
