from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Mapping

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.application.planet import save_planet
from app.application.profile import default_visual, upsert_intake
from app.application.relationship import upsert_relationship
from app.application.serialization import dumps
from app.db import Database, GraphDocumentRow, PlanetRow, RelationshipRow, UserRow
from app.schemas.profile import ProfileIntake
from app.schemas.relationship import RelationshipRequest
from app.security import hash_password, verify_password


PERSONA_SCHEMA_VERSION = 1
PRODUCTION_VALUES = {"prod", "production"}


def reject_production_environment(environment: Mapping[str, str] | None = None) -> None:
    values = os.environ if environment is None else environment
    for name in ("APP_ENV", "NODE_ENV", "ENVIRONMENT", "SOCIAL_COSMOS_ENV"):
        if values.get(name, "").strip().lower() in PRODUCTION_VALUES:
            raise RuntimeError(f"Persona seed is disabled when {name} is production")


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"Persona fixture is missing {path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Persona fixture is invalid JSON: {path}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"Persona fixture must contain a JSON object: {path}")
    return value


def load_fixture(directory: Path) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    profiles_document = _read_json(directory / "profiles.json")
    relationships_document = _read_json(directory / "relationships.json")
    for name, document in (
        ("profiles.json", profiles_document),
        ("relationships.json", relationships_document),
    ):
        if document.get("schemaVersion") != PERSONA_SCHEMA_VERSION:
            raise ValueError(f"{name} must use schemaVersion {PERSONA_SCHEMA_VERSION}")
    cohort_id = profiles_document.get("cohortId")
    if not isinstance(cohort_id, str) or not cohort_id.strip():
        raise ValueError("profiles.json must contain a non-empty cohortId")
    if relationships_document.get("cohortId") != cohort_id:
        raise ValueError("Persona profile and relationship cohortId values do not match")
    profiles = profiles_document.get("profiles")
    relationships = relationships_document.get("relationships")
    if not isinstance(profiles, list) or not profiles:
        raise ValueError("profiles.json must contain a non-empty profiles array")
    if not isinstance(relationships, list):
        raise ValueError("relationships.json must contain a relationships array")
    if not all(isinstance(item, dict) for item in [*profiles, *relationships]):
        raise ValueError("Persona profiles and relationships must be JSON objects")
    return cohort_id, profiles, relationships


def _unique_strings(*groups: Any) -> list[str]:
    result: list[str] = []
    for group in groups:
        if not isinstance(group, list):
            continue
        for item in group:
            text = str(item).strip()
            if text and text not in result:
                result.append(text)
    return result


def _intake(profile: dict[str, Any]) -> ProfileIntake:
    interests = _unique_strings(profile.get("interests"), profile.get("tags"))
    return ProfileIntake(
        display_name=str(profile.get("displayName", "")).strip(),
        bio=str(profile.get("bio", "")).strip(),
        interests=[{"name": item} for item in interests],
    )


def _planet_body(item: dict[str, Any], index: int) -> dict[str, Any]:
    profile = item["profile"]
    planet = item["planet"]
    archetype = str(planet.get("archetype", "terran"))
    visual = default_visual(seed=4200 + index * 137, archetype=archetype)
    visual.update({
        "terrain": 0.78 if archetype == "volcanic" else 0.52,
        "roughness": 0.34 if archetype == "crystalline" else 0.68,
        "ring": archetype == "crystalline" or index == 3,
        "satellites": index % 3,
    })
    return {
        "identity": {
            "name": str(planet.get("name", "")).strip(),
            "motto": str(planet.get("motto", "")).strip(),
            "description": str(profile.get("bio", "")).strip(),
            "tags": _unique_strings(profile.get("tags")),
        },
        "visual": visual,
    }


def _upsert_user(db: Session, item: dict[str, Any], password: str) -> UserRow:
    user_id = str(item.get("id", "")).strip()
    account = item.get("account")
    profile = item.get("profile")
    planet = item.get("planet")
    if not user_id or not isinstance(account, dict) or not isinstance(profile, dict) or not isinstance(planet, dict):
        raise ValueError("Every Persona profile needs id, account, profile, and planet objects")
    email = str(account.get("email", "")).strip().lower()
    if not email:
        raise ValueError(f"Persona {user_id} is missing account.email")
    email_owner = db.scalar(select(UserRow).where(UserRow.email == email))
    if email_owner and email_owner.id != user_id:
        raise ValueError(f"Persona email {email} already belongs to {email_owner.id}")
    user = db.get(UserRow, user_id)
    if not user:
        user = UserRow(
            id=user_id,
            email=email,
            password_hash=hash_password(password),
            display_name=str(profile.get("displayName", "")).strip(),
            bio=str(profile.get("bio", "")).strip(),
        )
        db.add(user)
        db.flush()
    else:
        user.email = email
        if not verify_password(password, user.password_hash):
            user.password_hash = hash_password(password)
    user.tags_json = dumps(_unique_strings(profile.get("tags")))
    upsert_intake(db, user, _intake(profile))
    return user


def seed_persona_fixture(
    db: Session,
    directory: Path,
    *,
    password: str,
    environment: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    reject_production_environment(environment)
    cohort_id, profiles, relationships = load_fixture(directory)
    users: dict[str, UserRow] = {}
    for item in profiles:
        user = _upsert_user(db, item, password)
        users[user.id] = user
    for index, item in enumerate(profiles):
        save_planet(db, users[str(item["id"])], _planet_body(item, index))
    for relationship in relationships:
        perspectives = relationship.get("perspectives")
        if not isinstance(perspectives, list) or len(perspectives) != 2:
            raise ValueError(f"Relationship {relationship.get('id')} must contain two perspectives")
        for perspective in perspectives:
            if not isinstance(perspective, dict):
                raise ValueError(f"Relationship {relationship.get('id')} contains an invalid perspective")
            owner_id = str(perspective.get("ownerUserId", ""))
            if owner_id not in users:
                raise ValueError(f"Relationship {relationship.get('id')} has unknown owner {owner_id}")
            request = RelationshipRequest.model_validate({
                "targetUserId": perspective.get("targetUserId"),
                "relationType": perspective.get("relationType"),
                "identityLabel": perspective.get("identityLabel"),
                "description": perspective.get("description"),
                "status": perspective.get("status", "active"),
                "startedAt": relationship.get("startedAt"),
            })
            upsert_relationship(db, users[owner_id], request)
    db.flush()
    persona_ids = list(users)
    return {
        "schemaVersion": PERSONA_SCHEMA_VERSION,
        "cohortId": cohort_id,
        "users": db.scalar(select(func.count()).select_from(UserRow).where(UserRow.id.in_(persona_ids))),
        "planets": db.scalar(select(func.count()).select_from(PlanetRow).where(PlanetRow.owner_user_id.in_(persona_ids))),
        "relationships": db.scalar(
            select(func.count()).select_from(RelationshipRow).where(RelationshipRow.owner_user_id.in_(persona_ids))
        ),
        "profileGraphs": db.scalar(
            select(func.count()).select_from(GraphDocumentRow).where(GraphDocumentRow.owner_user_id.in_(persona_ids))
        ),
    }


def main() -> None:
    project_root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description="Seed a reviewed Persona fixture through FastAPI application services")
    parser.add_argument("--input", type=Path, default=project_root / "test/persona/generated/hk-5")
    parser.add_argument("--dry-run", action="store_true")
    arguments = parser.parse_args()
    password = os.getenv("PERSONA_DEV_PASSWORD", "Persona2026!")
    database = Database()
    database.create_schema()
    session = database.session_factory()
    try:
        result = seed_persona_fixture(session, arguments.input.resolve(), password=password)
        if arguments.dry_run:
            session.rollback()
            result["dryRun"] = True
        else:
            session.commit()
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
