from __future__ import annotations

import argparse
import json
import signal
from collections.abc import Sequence
from threading import Event
from typing import Any

from app.db import Database
from app.graph_repository import GraphProjectionRepository, graph_repository_from_environment
from app.services import project_graph_outbox


def drain_once(
    database: Database,
    repository: GraphProjectionRepository,
    *,
    batch_size: int = 25,
) -> dict[str, Any]:
    """Project one transactional outbox batch and commit its result."""
    if batch_size < 1:
        raise ValueError("batch_size must be at least 1")
    with database.session() as db:
        return project_graph_outbox(db, repository, limit=batch_size)


def run_worker(
    database: Database,
    repository: GraphProjectionRepository,
    *,
    batch_size: int = 25,
    poll_seconds: float = 5.0,
    once: bool = False,
    stop_event: Event | None = None,
) -> int:
    """Drain graph projections once or continuously until asked to stop."""
    if poll_seconds <= 0:
        raise ValueError("poll_seconds must be greater than 0")
    stop = stop_event or Event()
    total_failed = 0
    while not stop.is_set():
        result = drain_once(database, repository, batch_size=batch_size)
        if once or int(result["processed"]) > 0:
            print(json.dumps(result, ensure_ascii=False, sort_keys=True), flush=True)
        total_failed += int(result["failed"])
        if once:
            break
        # Continue immediately after a successful full batch, but back off on
        # failures so an unavailable Neo4j instance is not hammered in a loop.
        if int(result["failed"]) > 0 or int(result["processed"]) < batch_size:
            stop.wait(poll_seconds)
    return 1 if once and total_failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Drain the Social Cosmos Neo4j projection outbox.")
    parser.add_argument("--database-url", help="Override SOCIAL_COSMOS_DATABASE_URL.")
    parser.add_argument("--batch-size", type=int, default=25)
    parser.add_argument("--poll-seconds", type=float, default=5.0)
    parser.add_argument("--once", action="store_true", help="Process one batch and exit.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    database = Database(args.database_url)
    repository = graph_repository_from_environment()
    stop = Event()

    def request_stop(_signum: int, _frame: object) -> None:
        stop.set()

    signal.signal(signal.SIGINT, request_stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, request_stop)
    try:
        return run_worker(
            database,
            repository,
            batch_size=args.batch_size,
            poll_seconds=args.poll_seconds,
            once=args.once,
            stop_event=stop,
        )
    finally:
        repository.close()
        database.engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
