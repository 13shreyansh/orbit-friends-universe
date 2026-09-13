from __future__ import annotations

import argparse
import json
import signal
import time
from collections.abc import Sequence
from datetime import datetime, timezone
from threading import Event

from sqlalchemy import select

from app.db import Database, UserRow
from app.services import recompute_universe, simulation_tick


def run_simulation_tick(
    database: Database,
    *,
    computed_at: datetime | None = None,
) -> dict[str, int | str]:
    """Recompute every user's mass, relationships, distances, and snapshot."""
    tick = simulation_tick(computed_at)
    with database.session() as db:
        user_ids = list(db.scalars(select(UserRow.id).order_by(UserRow.id)))

    nodes = 0
    edges = 0
    completed = 0
    failed = 0
    for user_id in user_ids:
        try:
            with database.session() as db:
                user = db.get(UserRow, user_id)
                if not user:
                    continue
                snapshot = recompute_universe(db, user, computed_at=tick)
                nodes += len(snapshot.nodes)
                edges += len(snapshot.edges)
                completed += 1
        except Exception:
            failed += 1
    return {
        "tick": tick.isoformat(),
        "users": len(user_ids),
        "completed": completed,
        "failed": failed,
        "nodes": nodes,
        "edges": edges,
    }


def run_worker(
    database: Database,
    *,
    interval_seconds: float = 3600,
    once: bool = False,
    stop_event: Event | None = None,
) -> int:
    if interval_seconds <= 0:
        raise ValueError("interval_seconds must be greater than 0")
    stop = stop_event or Event()
    last_failed = 0
    while not stop.is_set():
        result = run_simulation_tick(database)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True), flush=True)
        last_failed = int(result["failed"])
        if once:
            break
        # Align the default 3600-second cadence to wall-clock hour boundaries
        # instead of drifting one hour from the process start time.
        wait_seconds = interval_seconds - (time.time() % interval_seconds)
        stop.wait(max(1.0, wait_seconds))
    return 1 if once and last_failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run hourly Social Cosmos dynamic simulation ticks.")
    parser.add_argument("--database-url", help="Override SOCIAL_COSMOS_DATABASE_URL.")
    parser.add_argument("--interval-seconds", type=float, default=3600)
    parser.add_argument("--once", action="store_true", help="Run one hourly tick and exit.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    database = Database(args.database_url)
    stop = Event()

    def request_stop(_signum: int, _frame: object) -> None:
        stop.set()

    signal.signal(signal.SIGINT, request_stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, request_stop)
    try:
        return run_worker(
            database,
            interval_seconds=args.interval_seconds,
            once=args.once,
            stop_event=stop,
        )
    finally:
        database.engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
