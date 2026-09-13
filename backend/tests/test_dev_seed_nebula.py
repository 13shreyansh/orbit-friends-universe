from sqlalchemy import select

from app.db import Database, NebulaMemberRow, NebulaRow
from app.dev_seed_nebula import seed_nebula_simulation
from app.seed import seed_database


def test_nebula_simulation_seed_creates_obvious_distance_bands_and_is_idempotent(tmp_path) -> None:
    database_url = f"sqlite:///{(tmp_path / 'simulation-seed.db').as_posix()}"
    database = Database(database_url)
    database.create_schema()
    with database.session() as db:
        seed_database(db, True)

    with database.session() as db:
        first = seed_nebula_simulation(
            db,
            viewer_key="demo-zaosusu",
            count_per_band=3,
        )
        nebula = db.scalar(select(NebulaRow).where(NebulaRow.slug == "adventurex"))
        assert nebula is not None
        first_member_count = len(list(db.scalars(
            select(NebulaMemberRow).where(NebulaMemberRow.nebula_id == nebula.id)
        )))

    with database.session() as db:
        second = seed_nebula_simulation(
            db,
            viewer_key="demo-zaosusu",
            count_per_band=3,
        )
        second_member_count = len(list(db.scalars(
            select(NebulaMemberRow).where(NebulaMemberRow.nebula_id == "nebula-adventurex")
        )))

    assert first["createdOrUpdated"] == 9
    assert second["createdOrUpdated"] == 9
    assert second_member_count == first_member_count
    assert first["bands"]["近轨"]["maximumRadius"] < first["bands"]["中轨"]["minimumRadius"]
    assert first["bands"]["中轨"]["maximumRadius"] < first["bands"]["远轨"]["minimumRadius"]
