from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


BACKEND_ROOT = Path(__file__).resolve().parents[1]
NEW_TABLES = {
    "analysis_job_deletion_audit",
    "synthetic_account_deletion_audit",
    "agent_conversations",
    "agent_message_citations",
    "agent_message_feedback",
    "agent_messages",
    "agent_memory_sessions",
    "agent_memory_sync_state",
    "agent_run_events",
    "agent_runs",
    "analysis_jobs",
    "integration_outbox",
    "media_assets",
    "memory_drafts",
    "memory_revisions",
    "memory_sources",
}


def _config(database_path: Path) -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database_path.as_posix()}")
    return config


def test_migrations_upgrade_empty_database_and_match_metadata(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("SOCIAL_COSMOS_DATABASE_URL", raising=False)
    database_path = tmp_path / "empty-upgrade.db"
    config = _config(database_path)

    command.upgrade(config, "head")
    command.check(config)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    assert NEW_TABLES <= set(inspect(engine).get_table_names())
    assert {
        "claim_token",
        "claimed_at",
        "lease_expires_at",
        "dead_lettered_at",
    } <= {column["name"] for column in inspect(engine).get_columns("integration_outbox")}
    assert {
        "agent_conversation_id",
        "agent_message_id",
    } <= {column["name"] for column in inspect(engine).get_columns("memory_sources")}
    engine.dispose()


def test_migrations_preserve_existing_schema_data(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("SOCIAL_COSMOS_DATABASE_URL", raising=False)
    database_path = tmp_path / "existing-upgrade.db"
    config = _config(database_path)
    command.upgrade(config, "20260723_0003")

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    now = "2026-07-23T00:00:00+00:00"
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "INSERT INTO users "
            "(id,email,password_hash,display_name,bio,tags_json,intake_json,planet_id,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("legacy-user", "legacy@example.test", "unused", "Legacy", "", "[]", "{}", None, now, now),
        )
        connection.exec_driver_sql(
            "INSERT INTO memories "
            "(id,owner_user_id,relationship_id,memory_json,event_time,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            ("legacy-memory", "legacy-user", None, "{}", "2026-07-22", now, now),
        )

    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert connection.exec_driver_sql(
            "SELECT memory_json FROM memories WHERE id='legacy-memory'"
        ).scalar_one() == "{}"
    assert NEW_TABLES <= set(inspect(engine).get_table_names())
    engine.dispose()


def test_migrations_tolerate_pre_dropped_declared_strength(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("SOCIAL_COSMOS_DATABASE_URL", raising=False)
    database_path = tmp_path / "pre-dropped-column.db"
    config = _config(database_path)
    command.upgrade(config, "20260724_0006")

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE relationships DROP COLUMN declared_strength")

    command.upgrade(config, "head")
    assert "declared_strength" not in {
        column["name"] for column in inspect(engine).get_columns("relationships")
    }
    engine.dispose()
