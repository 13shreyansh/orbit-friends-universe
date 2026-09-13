from datetime import datetime, timezone

from app.db import Database, PlanetRow
from app.seed import seed_database
from app.services import loads
from app.simulation_worker import run_simulation_tick


def test_hourly_simulation_tick_recomputes_every_user_at_same_clock(tmp_path) -> None:
    database = Database(f"sqlite:///{(tmp_path / 'simulation.db').as_posix()}")
    database.create_schema()
    with database.session() as db:
        seed_database(db, True)

    result = run_simulation_tick(
        database,
        computed_at=datetime(2026, 7, 23, 8, 47, 12, tzinfo=timezone.utc),
    )

    assert result["tick"] == "2026-07-23T08:00:00+00:00"
    assert result["users"] == result["completed"] == 6
    assert result["failed"] == 0
    assert result["nodes"] >= 6
    with database.session() as db:
        scores = [loads(row.score_json, {}) for row in db.query(PlanetRow).all()]
    assert all(score["algorithmVersion"] == "mass.v2" for score in scores)
    assert all(score["computedAt"] == "2026-07-23T08:00:00Z" for score in scores)
