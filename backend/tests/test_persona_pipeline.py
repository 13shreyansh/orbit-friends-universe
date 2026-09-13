from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.application.errors import InvalidRequestError
from app.application.serialization import loads
from app.db import (
    Database,
    GraphDocumentRow,
    GraphProjectionOutboxRow,
    PlanetRow,
    RelationshipRow,
    UserRow,
)
from app.devtools.persona_seed import reject_production_environment, seed_persona_fixture
from app.main import create_app


FIXTURE_DIRECTORY = Path(__file__).resolve().parents[2] / "test/persona/generated/hk-5"
PERSONA_PASSWORD = "Persona2026!"


def _seed(database: Database, directory: Path = FIXTURE_DIRECTORY) -> dict[str, object]:
    with database.session() as db:
        return seed_persona_fixture(db, directory, password=PERSONA_PASSWORD, environment={"APP_ENV": "test"})


def test_persona_seed_is_idempotent_and_uses_application_services(tmp_path) -> None:
    database = Database(f"sqlite:///{(tmp_path / 'persona.db').as_posix()}")
    database.create_schema()

    first = _seed(database)
    with database.session() as db:
        first_relationship_ids = set(db.scalars(select(RelationshipRow.id)))
    second = _seed(database)

    assert first == second == {
        "schemaVersion": 1,
        "cohortId": "hk-5-seed-42",
        "users": 5,
        "planets": 5,
        "relationships": 16,
        "profileGraphs": 5,
    }
    with database.session() as db:
        assert db.scalar(select(func.count()).select_from(GraphProjectionOutboxRow)) == 5
        assert set(db.scalars(select(RelationshipRow.id))) == first_relationship_ids
        persona = db.get(UserRow, "persona-hk-001")
        planet = db.scalar(select(PlanetRow).where(PlanetRow.owner_user_id == persona.id))
        graph = db.get(GraphDocumentRow, persona.id)
        assert persona and persona.planet_id == planet.id
        assert graph and loads(graph.document_json, {})["schemaVersion"] == "profile_graph.v1"
        assert loads(planet.identity_json, {})["name"] == "青洲 terra"


def test_persona_seed_rolls_back_the_whole_cohort_on_invalid_relationship(tmp_path) -> None:
    fixture_directory = tmp_path / "fixture"
    fixture_directory.mkdir()
    profiles = json.loads((FIXTURE_DIRECTORY / "profiles.json").read_text(encoding="utf-8"))
    relationships = json.loads((FIXTURE_DIRECTORY / "relationships.json").read_text(encoding="utf-8"))
    relationships["relationships"][0]["perspectives"][0]["targetUserId"] = "missing-persona"
    (fixture_directory / "profiles.json").write_text(json.dumps(profiles), encoding="utf-8")
    (fixture_directory / "relationships.json").write_text(json.dumps(relationships), encoding="utf-8")

    database = Database(f"sqlite:///{(tmp_path / 'rollback.db').as_posix()}")
    database.create_schema()
    with pytest.raises(InvalidRequestError, match="valid target user"):
        with database.session() as db:
            seed_persona_fixture(
                db,
                fixture_directory,
                password=PERSONA_PASSWORD,
                environment={"APP_ENV": "test"},
            )
    with database.session() as db:
        assert db.scalar(select(func.count()).select_from(UserRow)) == 0


def test_persona_seed_is_disabled_in_production() -> None:
    with pytest.raises(RuntimeError, match="disabled"):
        reject_production_environment({"APP_ENV": "production"})


def test_persona_memory_replay_uses_fastapi_contract_and_is_isolated(tmp_path) -> None:
    database_url = f"sqlite:///{(tmp_path / 'api.db').as_posix()}"
    database = Database(database_url)
    database.create_schema()
    _seed(database)

    scenario = json.loads((FIXTURE_DIRECTORY / "scenarios.jsonl").read_text(encoding="utf-8").splitlines()[0])
    profiles_document = json.loads((FIXTURE_DIRECTORY / "profiles.json").read_text(encoding="utf-8"))
    profiles = {item["id"]: item for item in profiles_document["profiles"]}
    memory_input = scenario["inputs"][0]
    owner_id = memory_input["userId"]
    target_id = next(item for item in scenario["participantIds"] if item != owner_id)
    owner_email = profiles[owner_id]["account"]["email"]
    target_email = profiles[target_id]["account"]["email"]

    app = create_app(
        database_url,
        seed_demo=False,
        activity_upload_directory=tmp_path / "uploads",
    )
    with TestClient(app) as client:
        owner_login = client.post(
            "/api/auth/signin",
            json={"email": owner_email, "password": PERSONA_PASSWORD},
        )
        assert owner_login.status_code == 200, owner_login.text
        owner_cosmos = owner_login.json()
        headers = {"Authorization": f"Bearer {owner_cosmos['session']['token']}"}
        relationship = next(
            item for item in owner_cosmos["relationships"] if item["targetUserId"] == target_id
        )
        analysis = client.post(
            "/api/memories/analyze",
            headers=headers,
            json={"sourceType": "text", "rawText": memory_input["text"]},
        )
        assert analysis.status_code == 200, analysis.text
        memory = analysis.json()
        memory.update({
            "id": f"memory-{owner_id}-{scenario['id']}",
            "eventTime": scenario["eventDate"],
            "location": scenario["location"],
            "eventType": scenario["eventType"],
            "summary": scenario["expectedBusinessMemory"]["summary"],
            "facts": scenario["expectedBusinessMemory"]["facts"],
            "emotions": scenario["expectedBusinessMemory"]["emotions"],
            "people": [{
                "id": target_id,
                "name": profiles[target_id]["profile"]["displayName"],
                "isExisting": True,
                "relationType": relationship["relationType"],
                "identityLabel": relationship["identityLabel"],
                "relationshipDescription": relationship["description"],
            }],
        })
        memory["relationshipSignals"]["relationshipChange"] = scenario["expectedBusinessMemory"]["relationshipChange"]
        saved = client.post(
            "/api/memories",
            headers=headers,
            json={"memory": memory, "relationshipId": relationship["id"]},
        )
        assert saved.status_code == 201, saved.text
        assert len(saved.json()["cosmos"]["memories"]) == 1
        assert len(saved.json()["cosmos"]["timeline"]) == 1

        target_login = client.post(
            "/api/auth/signin",
            json={"email": target_email, "password": PERSONA_PASSWORD},
        )
        assert target_login.status_code == 200, target_login.text
        assert target_login.json()["memories"] == []
        assert target_login.json()["timeline"] == []
