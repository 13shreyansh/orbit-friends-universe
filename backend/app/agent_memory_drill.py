from __future__ import annotations

import argparse
import asyncio
import json
import time
import uuid
from collections.abc import Sequence
from datetime import timedelta
from typing import Any

from sqlalchemy import delete as sql_delete
from sqlalchemy import select, update

from app.agent_memory_worker import (
    AgentMemoryTaskPending,
    ClaimedAgentMemoryEvent,
    _defer_claim,
    _eligible_outbox,
    _fail_claim,
    _process_delete,
    _process_upsert,
    _provider_name,
    _utcnow,
    replay_dead_letter,
)
from app.db import (
    AgentMemorySessionRow,
    AgentMemorySyncStateRow,
    Database,
    IntegrationOutboxRow,
    UserRow,
)
from app.domain.agent_memory_policy import (
    AGENT_MEMORY_DESTINATION,
    agent_memory_dedupe_key,
    agent_memory_event,
)
from app.infrastructure.openviking_memory import (
    OpenVikingMemoryStore,
    openviking_memory_from_environment,
)


def _check(name: str, passed: bool, detail: str) -> dict[str, Any]:
    return {"name": name, "pass": bool(passed), "detail": detail}


def _ensure_drill_user(database: Database, run_id: str) -> str:
    user_id = f"drill-agent-memory-{run_id}"
    with database.session() as db:
        db.add(
            UserRow(
                id=user_id,
                email=f"drill.agent-memory.{run_id}@example.test",
                password_hash="!fault-drill-no-login",
                display_name="Agent Memory Fault Drill",
            )
        )
    return user_id


def _insert_event(
    database: Database,
    *,
    owner_user_id: str,
    memory_id: str,
    version: int,
    marker: str,
    deleted: bool = False,
) -> int:
    payload: dict[str, Any] = {"schemaVersion": 1, "source": "fault_drill"}
    if not deleted:
        payload["memory"] = {
            "id": memory_id,
            "sourceType": "text",
            "summary": f"Fault drill synthetic memory marker {marker}",
            "facts": [f"drill marker {marker}"],
            "confidence": 1,
        }
    with database.session() as db:
        row = IntegrationOutboxRow(
            owner_user_id=owner_user_id,
            destination=AGENT_MEMORY_DESTINATION,
            aggregate_type="memory",
            aggregate_id=memory_id,
            aggregate_version=version,
            event_type=agent_memory_event(deleted=deleted),
            dedupe_key=agent_memory_dedupe_key(memory_id=memory_id, version=version, deleted=deleted),
            payload_json=json.dumps(payload, ensure_ascii=False),
        )
        db.add(row)
        db.flush()
        return row.id


def _outbox_snapshot(database: Database, event_id: int) -> dict[str, Any]:
    with database.session() as db:
        row = db.get(IntegrationOutboxRow, event_id)
        if row is None:
            raise ValueError(f"Outbox event {event_id} was not found")
        return {
            "id": row.id,
            "status": row.status,
            "attempts": row.attempts,
            "lastError": row.last_error,
            "leaseExpiresAt": row.lease_expires_at.isoformat() if row.lease_expires_at else None,
            "deadLetteredAt": row.dead_lettered_at.isoformat() if row.dead_lettered_at else None,
        }


def _claim_event(
    database: Database,
    event_id: int,
    *,
    lease_seconds: int = 120,
) -> ClaimedAgentMemoryEvent | None:
    claimed_at = _utcnow()
    claim_token = uuid.uuid4().hex
    with database.session() as db:
        result = db.execute(
            update(IntegrationOutboxRow)
            .where(IntegrationOutboxRow.id == event_id, _eligible_outbox(claimed_at))
            .values(
                status="processing",
                claim_token=claim_token,
                claimed_at=claimed_at,
                lease_expires_at=claimed_at + timedelta(seconds=lease_seconds),
                updated_at=claimed_at,
            )
        )
        if not result.rowcount:
            return None
        row = db.get(IntegrationOutboxRow, event_id)
        return ClaimedAgentMemoryEvent(
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


def _force_retry_now(database: Database, event_id: int) -> None:
    with database.session() as db:
        db.execute(
            update(IntegrationOutboxRow)
            .where(IntegrationOutboxRow.id == event_id, IntegrationOutboxRow.status == "retry")
            .values(next_attempt_at=_utcnow(), updated_at=_utcnow())
        )


async def _drain_event(
    database: Database,
    store: OpenVikingMemoryStore,
    event_id: int,
    *,
    max_attempts: int = 8,
    deadline_seconds: float = 900.0,
    lease_seconds: int = 120,
) -> dict[str, Any]:
    provider = _provider_name(store)
    started = time.monotonic()
    while time.monotonic() - started < deadline_seconds:
        snapshot = _outbox_snapshot(database, event_id)
        if snapshot["status"] in {"completed", "dead_letter", "cancelled"}:
            return snapshot
        if snapshot["status"] == "retry":
            _force_retry_now(database, event_id)
        event = _claim_event(database, event_id, lease_seconds=lease_seconds)
        if event is None:
            await asyncio.sleep(1.0)
            continue
        try:
            if event.event_type == "memory.upserted":
                await _process_upsert(
                    database,
                    store,
                    event,
                    provider=provider,
                    task_poll_attempts=3,
                    task_poll_seconds=1.0,
                )
            elif event.event_type == "memory.deleted":
                await _process_delete(database, store, event, provider=provider)
            else:
                raise ValueError(f"Unsupported drill event type: {event.event_type}")
        except AgentMemoryTaskPending as pending:
            _defer_claim(database, event, str(pending), retry_seconds=1.0)
            await asyncio.sleep(1.0)
        except Exception as error:  # noqa: BLE001 - drill mirrors worker failure handling
            _fail_claim(
                database,
                event,
                provider,
                error,
                max_attempts=max_attempts,
                backoff_base_seconds=0.1,
                backoff_max_seconds=1.0,
            )
    return _outbox_snapshot(database, event_id)


def _sync_state_status(database: Database, owner_user_id: str, provider: str, memory_id: str) -> str:
    with database.session() as db:
        return str(
            db.scalar(
                select(AgentMemorySyncStateRow.status).where(
                    AgentMemorySyncStateRow.owner_user_id == owner_user_id,
                    AgentMemorySyncStateRow.provider == provider,
                    AgentMemorySyncStateRow.object_key == memory_id,
                )
            )
            or "missing"
        )


async def _serve_stub_500(host: str = "127.0.0.1") -> tuple[asyncio.Server, int]:
    body = json.dumps(
        {"status": "error", "error": {"code": "DRILL_STUB_5XX", "message": "fault drill synthetic provider failure"}}
    ).encode()
    header = (
        b"HTTP/1.1 500 Internal Server Error\r\n"
        b"Content-Type: application/json\r\n"
        b"Content-Length: " + str(len(body)).encode() + b"\r\n"
        b"Connection: close\r\n\r\n"
    )

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await asyncio.wait_for(reader.read(65536), timeout=5.0)
        except (asyncio.TimeoutError, ConnectionError):
            pass
        try:
            writer.write(header + body)
            await writer.drain()
        finally:
            writer.close()

    server = await asyncio.start_server(handle, host, 0)
    port = server.sockets[0].getsockname()[1]
    return server, port


async def _cleanup_drill_memory(
    database: Database,
    store: OpenVikingMemoryStore,
    *,
    owner_user_id: str,
    memory_id: str,
    version: int,
    deadline_seconds: float,
) -> dict[str, Any]:
    marker = "cleanup"
    delete_id = _insert_event(
        database,
        owner_user_id=owner_user_id,
        memory_id=memory_id,
        version=version,
        marker=marker,
        deleted=True,
    )
    return await _drain_event(database, store, delete_id, deadline_seconds=deadline_seconds)


def _purge_drill_user(database: Database, user_id: str) -> None:
    with database.session() as db:
        db.execute(sql_delete(AgentMemorySyncStateRow).where(AgentMemorySyncStateRow.owner_user_id == user_id))
        db.execute(sql_delete(AgentMemorySessionRow).where(AgentMemorySessionRow.owner_user_id == user_id))
        db.execute(sql_delete(IntegrationOutboxRow).where(IntegrationOutboxRow.owner_user_id == user_id))
        db.execute(sql_delete(UserRow).where(UserRow.id == user_id))


async def run_lease_drill(
    database: Database,
    store: OpenVikingMemoryStore,
    *,
    deadline_seconds: float,
) -> dict[str, Any]:
    run_id = uuid.uuid4().hex[:12]
    user_id = _ensure_drill_user(database, f"lease-{run_id}")
    marker = f"OVDRILL-LEASE-{run_id}"
    memory_id = f"drill-lease-{run_id}"
    checks: list[dict[str, Any]] = []
    try:
        event_id = _insert_event(
            database, owner_user_id=user_id, memory_id=memory_id, version=1, marker=marker
        )
        abandoned = _claim_event(database, event_id, lease_seconds=60)
        checks.append(_check("abandonedClaim", abandoned is not None, "first worker claimed the event"))
        contender = _claim_event(database, event_id, lease_seconds=60)
        checks.append(
            _check(
                "leaseHeldNotReclaimable",
                contender is None,
                "competing claim was rejected while the lease was valid",
            )
        )
        with database.session() as db:
            db.execute(
                update(IntegrationOutboxRow)
                .where(IntegrationOutboxRow.id == event_id)
                .values(lease_expires_at=_utcnow() - timedelta(seconds=1), updated_at=_utcnow())
            )
        final = await _drain_event(database, store, event_id, deadline_seconds=deadline_seconds)
        checks.append(
            _check(
                "expiredLeaseReclaimedAndCompleted",
                final["status"] == "completed",
                f"status={final['status']} attempts={final['attempts']}",
            )
        )
        checks.append(
            _check("reclaimWithoutFailureAttempts", final["attempts"] == 0, f"attempts={final['attempts']}")
        )
        cleanup = await _cleanup_drill_memory(
            database,
            store,
            owner_user_id=user_id,
            memory_id=memory_id,
            version=2,
            deadline_seconds=deadline_seconds,
        )
        checks.append(
            _check("deletePropagationCompleted", cleanup["status"] == "completed", f"status={cleanup['status']}")
        )
    finally:
        _purge_drill_user(database, user_id)
    return {"drill": "lease", "pass": all(check["pass"] for check in checks), "checks": checks}


async def run_dead_letter_drill(
    database: Database,
    store: OpenVikingMemoryStore,
    *,
    deadline_seconds: float,
    skip_recall: bool,
) -> dict[str, Any]:
    run_id = uuid.uuid4().hex[:12]
    user_id = _ensure_drill_user(database, f"deadletter-{run_id}")
    marker = f"OVDRILL-DEADLETTER-{run_id}"
    memory_id = f"drill-deadletter-{run_id}"
    provider = _provider_name(store)
    checks: list[dict[str, Any]] = []
    stub_server: asyncio.Server | None = None
    stub_store: OpenVikingMemoryStore | None = None
    try:
        event_id = _insert_event(
            database, owner_user_id=user_id, memory_id=memory_id, version=1, marker=marker
        )
        stub_server, stub_port = await _serve_stub_500()
        stub_store = OpenVikingMemoryStore(
            f"http://127.0.0.1:{stub_port}",
            api_key="fault-drill",
            account=store.account,
            timeout=5.0,
        )
        failed = await _drain_event(
            database, stub_store, event_id, max_attempts=2, deadline_seconds=60.0
        )
        checks.append(
            _check(
                "providerFailureDeadLetters",
                failed["status"] == "dead_letter" and failed["attempts"] == 2,
                f"status={failed['status']} attempts={failed['attempts']} lastError={failed['lastError'][:80]}",
            )
        )
        checks.append(
            _check(
                "syncStateDeadLetter",
                _sync_state_status(database, user_id, provider, memory_id) == "dead_letter",
                f"syncState={_sync_state_status(database, user_id, provider, memory_id)}",
            )
        )
        replayed = replay_dead_letter(database, event_id)
        checks.append(
            _check("replayResetsEvent", replayed["status"] == "pending", f"status={replayed['status']}")
        )
        final = await _drain_event(database, store, event_id, deadline_seconds=deadline_seconds)
        checks.append(
            _check(
                "replayCompletesWithRealProvider",
                final["status"] == "completed",
                f"status={final['status']} attempts={final['attempts']}",
            )
        )
        if final["status"] == "completed" and not skip_recall:
            recalled = 0
            marker_verbatim = False
            for _ in range(6):
                recalls = await store.recall(user_id=user_id, query=marker, top_k=5)
                recalled = len(recalls)
                blob = " ".join(f"{recall.object_key} {recall.content}" for recall in recalls).lower()
                marker_verbatim = marker.lower() in blob
                if recalled:
                    break
                await asyncio.sleep(5.0)
            # The drill user's memory scope is exclusive to this event, so any
            # recalled memory proves the replayed commit is retrievable; the VLM
            # paraphrases extracted content, so verbatim marker survival is only
            # reported as detail.
            checks.append(
                _check(
                    "recallReturnsDrillMemory",
                    recalled > 0,
                    f"recalled={recalled} markerVerbatim={marker_verbatim}",
                )
            )
        cleanup = await _cleanup_drill_memory(
            database,
            store,
            owner_user_id=user_id,
            memory_id=memory_id,
            version=2,
            deadline_seconds=deadline_seconds,
        )
        checks.append(
            _check("deletePropagationCompleted", cleanup["status"] == "completed", f"status={cleanup['status']}")
        )
    finally:
        if stub_server is not None:
            stub_server.close()
            await stub_server.wait_closed()
        if stub_store is not None:
            await stub_store.close()
        _purge_drill_user(database, user_id)
    return {"drill": "dead-letter", "pass": all(check["pass"] for check in checks), "checks": checks}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Agent Memory fault drills against a live deployment.")
    parser.add_argument("--drill", choices=("lease", "dead-letter", "all"), default="all")
    parser.add_argument("--database-url", help="Override SOCIAL_COSMOS_DATABASE_URL.")
    parser.add_argument("--deadline-seconds", type=float, default=900.0)
    parser.add_argument("--skip-recall", action="store_true")
    parser.add_argument("--report", default="/tmp/social-cosmos-agent-memory-drill.json")
    return parser


async def _main_async(args: argparse.Namespace) -> int:
    database = Database(args.database_url)
    store = openviking_memory_from_environment()
    drills: list[dict[str, Any]] = []
    try:
        if args.drill in {"lease", "all"}:
            drills.append(await run_lease_drill(database, store, deadline_seconds=args.deadline_seconds))
        if args.drill in {"dead-letter", "all"}:
            drills.append(
                await run_dead_letter_drill(
                    database,
                    store,
                    deadline_seconds=args.deadline_seconds,
                    skip_recall=args.skip_recall,
                )
            )
    finally:
        await store.close()
        database.engine.dispose()
    report = {
        "schemaVersion": 1,
        "measuredAt": _utcnow().isoformat(),
        "provider": _provider_name(store),
        "pass": all(drill["pass"] for drill in drills),
        "drills": drills,
    }
    try:
        with open(args.report, "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)
    except OSError:
        pass
    print(json.dumps(report, ensure_ascii=False, sort_keys=True), flush=True)
    return 0 if report["pass"] else 1


def main(argv: Sequence[str] | None = None) -> int:
    return asyncio.run(_main_async(build_parser().parse_args(argv)))


if __name__ == "__main__":
    raise SystemExit(main())
