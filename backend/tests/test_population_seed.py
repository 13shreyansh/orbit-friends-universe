from sqlalchemy import func, select

from app.db import Database, NebulaMemberRow, NebulaRow, PlanetRow, RelationshipRow, UserRow
from app.devtools.population_seed import POPULATION_PREFIX, PRODUCTION_CONFIRMATION, seed_population


def test_population_seed_is_idempotent_and_keeps_adventurex_empty(tmp_path) -> None:
    database = Database(f"sqlite:///{(tmp_path / 'population.db').as_posix()}")
    database.create_schema()
    with database.session() as db:
        existing = UserRow(
            id="real-local-user",
            email="real@example.test",
            password_hash="preserved",
            display_name="Real Local User",
            bio="",
            tags_json="[]",
        )
        db.add(existing)

    with database.session() as db:
        first = seed_population(db, environment={"APP_ENV": "development"})
        adventurex = db.scalar(select(NebulaRow).where(NebulaRow.slug == "adventurex"))
        assert adventurex is not None
        db.add(NebulaMemberRow(
            id="nebula-member-adventurex-real-local-user",
            nebula_id=adventurex.id,
            user_id="real-local-user",
        ))
    with database.session() as db:
        second = seed_population(db, environment={"APP_ENV": "development"})

        assert first == second == {
            "cohort": "population-100-v3",
            "emptyNebulae": ["adventurex"],
            "users": 100,
            "planets": 100,
            "nebulae": 10,
            "memberships": 450,
            "relationships": 200,
        }
        assert db.get(UserRow, "real-local-user") is not None
        assert db.scalar(select(func.count()).select_from(UserRow)) == 101
        assert db.scalar(select(func.count()).select_from(PlanetRow)) == 100
        names = list(db.scalars(select(UserRow.display_name).where(UserRow.id.startswith(POPULATION_PREFIX))))
        assert len(set(names)) == 100
        assert all(not any(character.isdigit() for character in name) for name in names)
        assert db.scalar(select(func.count()).select_from(NebulaRow)) == 10
        assert db.scalar(select(func.count()).select_from(RelationshipRow).where(
            RelationshipRow.owner_user_id.startswith(POPULATION_PREFIX)
        )) == 200
        member_counts = dict(db.execute(
            select(NebulaRow.slug, func.count())
            .join(NebulaMemberRow, NebulaMemberRow.nebula_id == NebulaRow.id)
            .group_by(NebulaMemberRow.nebula_id)
        ).all())
        assert len(member_counts) == 9
        assert member_counts.get("adventurex", 0) == 0
        assert {count for slug, count in member_counts.items() if slug != "adventurex"} == {50}


def test_population_seed_rejects_production(tmp_path) -> None:
    database = Database(f"sqlite:///{(tmp_path / 'production.db').as_posix()}")
    database.create_schema()
    with database.session_factory() as db:
        try:
            seed_population(db, environment={"APP_ENV": "production"})
        except RuntimeError as error:
            assert "disabled" in str(error)
        else:
            raise AssertionError("production seed should be rejected")


def test_population_seed_requires_exact_production_confirmation(tmp_path) -> None:
    database = Database(f"sqlite:///{(tmp_path / 'approved-production.db').as_posix()}")
    database.create_schema()
    with database.session() as db:
        result = seed_population(
            db,
            environment={"APP_ENV": "production"},
            allow_production=True,
            production_confirmation=PRODUCTION_CONFIRMATION,
        )
    assert result["emptyNebulae"] == ["adventurex"]
