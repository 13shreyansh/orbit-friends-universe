from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.application.nebula import get_nebula_space
from app.application.behavior import record_user_behavior
from app.application.profile import upsert_intake
from app.application.scoring import calculate_current_relationship_score
from app.application.serialization import dumps
from app.db import Database, MemoryRow, NebulaMemberRow, NebulaRow, RelationshipRow, UserRow
from app.schemas.memory import MemoryEmotion, MemoryObject, MemoryPersonRef, MemoryRelationshipSignals
from app.schemas.profile import (
    DateRange,
    EducationInput,
    EducationLevel,
    InterestInput,
    PersonalityType,
    PlaceInput,
    ProfileAttributeInput,
    ProfileIntake,
    ResidenceInput,
    SkillInput,
)
from app.security import hash_password


SIMULATION_PREFIX = "simulation-nebula-"
DEFAULT_NEBULA_SLUG = "adventurex"
DEFAULT_COUNT_PER_BAND = 6


@dataclass(frozen=True)
class SimulationBand:
    key: str
    name: str
    memory_count: int
    reciprocal_behavior_count: int
    personalities: tuple[PersonalityType, ...]
    city: str
    school: str
    skill: str
    interest: str


BANDS = (
    SimulationBand(
        key="near",
        name="近轨",
        memory_count=7,
        reciprocal_behavior_count=3,
        personalities=(PersonalityType.INTJ, PersonalityType.INFJ, PersonalityType.ENFP),
        city="Shanghai",
        school="Soochow University",
        skill="Product Design",
        interest="Cosmic Storytelling",
    ),
    SimulationBand(
        key="middle",
        name="中轨",
        memory_count=2,
        reciprocal_behavior_count=1,
        personalities=(PersonalityType.ENTP, PersonalityType.ISFP, PersonalityType.ENFJ),
        city="Hangzhou",
        school="Zhejiang University",
        skill="Creative Technology",
        interest="Digital Art",
    ),
    SimulationBand(
        key="far",
        name="远轨",
        memory_count=0,
        reciprocal_behavior_count=0,
        personalities=(PersonalityType.ISTP, PersonalityType.ESFJ, PersonalityType.INFP),
        city="Reykjavik",
        school="Northern Institute",
        skill="Field Research",
        interest="Remote Landscapes",
    ),
)


GIVEN_NAMES = (
    "林夏",
    "周野",
    "陈曦",
    "顾言",
    "苏禾",
    "沈星",
    "陆遥",
    "叶澄",
    "江屿",
    "许岚",
    "唐宁",
    "温然",
    "秦川",
    "程月",
    "宋知",
    "夏木",
    "白榆",
    "黎川",
)


def _profile(band: SimulationBand, index: int, display_name: str) -> ProfileIntake:
    born = 1994 + index % 7
    return ProfileIntake(
        display_name=display_name,
        bio=f"{band.name}模拟成员，用于验证真实图关系驱动的三维距离。",
        birth_date=date(born, index % 12 + 1, index % 25 + 1),
        personality_type=band.personalities[index % len(band.personalities)],
        residences=[ResidenceInput(
            place=PlaceInput(name=band.city),
            period=DateRange(start_date=date(2021, 1, 1), is_current=True),
        )],
        education=[EducationInput(
            institution=band.school,
            level=EducationLevel.BACHELOR,
            field_of_study=("Design" if index % 2 == 0 else "Computer Science"),
            period=DateRange(start_date=date(2012 + index % 4, 9, 1), end_date=date(2016 + index % 4, 6, 30)),
            place=PlaceInput(name=band.city),
        )],
        skills=[
            SkillInput(name=band.skill, proficiency=3 + index % 3),
            SkillInput(name=f"{band.name}协作", proficiency=2 + index % 4),
        ],
        interests=[
            InterestInput(name=band.interest),
            InterestInput(name=f"{band.name}生活"),
        ],
        attributes=[ProfileAttributeInput(
            key="simulation.distance_band",
            label=f"{band.name}距离样本",
            category="development",
            value=band.key,
        )],
    )


def _resolve_viewer(db: Session, nebula: NebulaRow, viewer_key: str | None) -> UserRow:
    if viewer_key:
        viewer = db.get(UserRow, viewer_key) or db.scalar(select(UserRow).where(UserRow.email == viewer_key.lower()))
        if viewer is None:
            raise ValueError(f"Viewer not found: {viewer_key}")
    else:
        viewer = db.scalar(
            select(UserRow)
            .join(NebulaMemberRow, NebulaMemberRow.user_id == UserRow.id)
            .where(
                NebulaMemberRow.nebula_id == nebula.id,
                ~UserRow.id.startswith(SIMULATION_PREFIX),
                ~UserRow.email.endswith("@socialcosmos.local"),
            )
            .order_by(NebulaMemberRow.joined_at.desc())
        )
        if viewer is None:
            viewer = db.get(UserRow, nebula.owner_user_id)
    if viewer is None or not viewer.planet_id:
        raise ValueError("The selected viewer must exist and own a planet.")
    membership = db.scalar(select(NebulaMemberRow).where(
        NebulaMemberRow.nebula_id == nebula.id,
        NebulaMemberRow.user_id == viewer.id,
    ))
    if membership is None:
        raise ValueError("The selected viewer is not a member of this nebula.")
    return viewer


def _memory(
    viewer: UserRow,
    target: UserRow,
    relationship: RelationshipRow,
    band: SimulationBand,
    member_index: int,
    memory_index: int,
) -> MemoryObject:
    event_time = date.today() - timedelta(days=24 * memory_index + member_index * 3)
    return MemoryObject(
        id=f"memory-simulation-{viewer.id}-{target.id}-{memory_index + 1:02d}",
        source_type="text",
        raw_text=f"{viewer.display_name} 与 {target.display_name} 的共同经历 #{memory_index + 1}",
        people=[MemoryPersonRef(
            id=target.id,
            name=target.display_name,
            is_existing=True,
            relation_type=relationship.relation_type,
            identity_label=relationship.identity_label,
        )],
        event_time=event_time,
        location="AdventureX",
        event_type=("collaboration", "conversation", "meetup")[memory_index % 3],
        summary=f"{band.name}关系样本的第 {memory_index + 1} 段可验证共同经历。",
        facts=["双方共同参与", "事件时间已记录"],
        emotions=[MemoryEmotion(name="warmth", intensity=78 if band.key == "near" else 58)],
        relationship_signals=MemoryRelationshipSignals(
            interaction_frequency=82 if band.key == "near" else 46,
            emotional_intimacy=80 if band.key == "near" else 44,
            initiative_balance=72 if band.key == "near" else 55,
            relationship_change="stable",
        ),
        keywords=["shared experience", band.key],
        narrative="Local development evidence used to verify relationship-driven spatial layout.",
        confidence=0.95 if band.key == "near" else 0.82,
        analysis_provider="local-simulation-seed",
    )


def _ensure_relationship_evidence(
    db: Session,
    viewer: UserRow,
    target: UserRow,
    relationship: RelationshipRow,
    band: SimulationBand,
    member_index: int,
) -> None:
    for memory_index in range(band.memory_count):
        memory = _memory(viewer, target, relationship, band, member_index, memory_index)
        row = db.get(MemoryRow, memory.id)
        if row is None:
            db.add(MemoryRow(
                id=memory.id,
                owner_user_id=viewer.id,
                relationship_id=relationship.id,
                memory_json=dumps(memory),
                event_time=memory.event_time.isoformat(),
            ))
        else:
            row.relationship_id = relationship.id
            row.memory_json = dumps(memory)
            row.event_time = memory.event_time.isoformat()
            row.updated_at = datetime.now(timezone.utc)

    event_types = ("planet_visited", "activity_viewed", "activity_mentioned")
    for evidence_index in range(band.reciprocal_behavior_count):
        event_type = event_types[evidence_index % len(event_types)]
        occurred_at = datetime.now(timezone.utc) - timedelta(days=evidence_index * 9 + member_index)
        record_user_behavior(
            db,
            viewer.id,
            event_type,
            dedupe_key=f"simulation:{band.key}:{target.id}:out:{evidence_index}",
            target_user_id=target.id,
            metadata={"simulationBand": band.key, "nebula": DEFAULT_NEBULA_SLUG},
            occurred_at=occurred_at,
        )
        record_user_behavior(
            db,
            target.id,
            event_type,
            dedupe_key=f"simulation:{band.key}:{viewer.id}:in:{evidence_index}",
            target_user_id=viewer.id,
            metadata={"simulationBand": band.key, "nebula": DEFAULT_NEBULA_SLUG},
            occurred_at=occurred_at,
        )


def seed_nebula_simulation(
    db: Session,
    *,
    nebula_slug: str = DEFAULT_NEBULA_SLUG,
    viewer_key: str | None = None,
    count_per_band: int = DEFAULT_COUNT_PER_BAND,
) -> dict:
    if not 1 <= count_per_band <= 40:
        raise ValueError("count_per_band must be between 1 and 40")
    nebula = db.scalar(select(NebulaRow).where(NebulaRow.slug == nebula_slug))
    if nebula is None:
        raise ValueError(f"Nebula not found: {nebula_slug}")
    viewer = _resolve_viewer(db, nebula, viewer_key)

    user_band: dict[str, str] = {}
    scored_relationships: list[RelationshipRow] = []
    for band_index, band in enumerate(BANDS):
        for index in range(count_per_band):
            user_id = f"{SIMULATION_PREFIX}{band.key}-{index + 1:02d}"
            display_name = f"{band.name} · {GIVEN_NAMES[(band_index * count_per_band + index) % len(GIVEN_NAMES)]}"
            user = db.get(UserRow, user_id)
            if user is None:
                user = UserRow(
                    id=user_id,
                    email=f"{user_id}@simulation.local",
                    password_hash=hash_password("Simulation2026!"),
                    display_name=display_name,
                    bio="",
                    tags_json="[]",
                )
                db.add(user)
                db.flush()
            profile = _profile(band, index, display_name)
            upsert_intake(db, user, profile)
            membership = db.scalar(select(NebulaMemberRow).where(
                NebulaMemberRow.nebula_id == nebula.id,
                NebulaMemberRow.user_id == user.id,
            ))
            if membership is None:
                db.add(NebulaMemberRow(
                    id=f"nebula-member-{nebula.id}-{user.id}",
                    nebula_id=nebula.id,
                    user_id=user.id,
                ))

            relationship_id = f"relationship-simulation-{viewer.id}-{user.id}"
            relationship = db.scalar(select(RelationshipRow).where(
                RelationshipRow.owner_user_id == viewer.id,
                RelationshipRow.target_user_id == user.id,
            ))
            if band.memory_count == 0:
                if relationship and relationship.id == relationship_id:
                    db.delete(relationship)
            else:
                if relationship is None:
                    relationship = RelationshipRow(
                        id=relationship_id,
                        owner_user_id=viewer.id,
                        target_user_id=user.id,
                        relation_type="friend" if band.key == "near" else "community",
                        identity_label=f"{band.name}距离样本",
                        description="Local simulation evidence for nebula distance acceptance.",
                        signals_json=dumps({"simulationBand": band.key}),
                        score_json="{}",
                        status="active",
                        started_at="2016-09-01" if band.key == "near" else "2024-03-01",
                    )
                    db.add(relationship)
                else:
                    relationship.relation_type = "friend" if band.key == "near" else "community"
                    relationship.identity_label = f"{band.name}距离样本"
                    relationship.description = "Local simulation evidence for nebula distance acceptance."
                    relationship.signals_json = dumps({"simulationBand": band.key})
                    relationship.started_at = "2016-09-01" if band.key == "near" else "2024-03-01"
                db.flush()
                _ensure_relationship_evidence(db, viewer, user, relationship, band, index)
                scored_relationships.append(relationship)
            user_band[user.id] = band.key

    db.flush()
    for relationship in scored_relationships:
        calculate_current_relationship_score(db, relationship)
    db.flush()
    space = get_nebula_space(db, viewer, nebula.id)
    distances: dict[str, list[float]] = {band.key: [] for band in BANDS}
    for member in space["members"]:
        band = user_band.get(member["userId"])
        if band:
            distances[band].append(float(member["distance"]))
    return {
        "nebulaId": nebula.id,
        "nebulaName": nebula.name,
        "viewerId": viewer.id,
        "viewerName": viewer.display_name,
        "createdOrUpdated": len(user_band),
        "memberCount": space["nebula"]["memberCount"],
        "bands": {
            band.name: {
                "count": len(distances[band.key]),
                "minimumRadius": round(min(distances[band.key]), 2),
                "maximumRadius": round(max(distances[band.key]), 2),
            }
            for band in BANDS
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Inject opt-in local users for nebula distance acceptance.")
    parser.add_argument("--nebula", default=DEFAULT_NEBULA_SLUG, help="Nebula slug (default: adventurex)")
    parser.add_argument("--viewer", help="Viewer user ID or email; defaults to the latest local nebula member")
    parser.add_argument("--count-per-band", type=int, default=DEFAULT_COUNT_PER_BAND)
    args = parser.parse_args()

    database = Database()
    with database.session() as db:
        result = seed_nebula_simulation(
            db,
            nebula_slug=args.nebula,
            viewer_key=args.viewer,
            count_per_band=args.count_per_band,
        )
    print(f"Nebula: {result['nebulaName']} ({result['nebulaId']})")
    print(f"Viewer: {result['viewerName']} ({result['viewerId']})")
    print(f"Simulation members: {result['createdOrUpdated']} / total members: {result['memberCount']}")
    for name, values in result["bands"].items():
        print(f"{name}: {values['count']} users, radius {values['minimumRadius']}..{values['maximumRadius']}")


if __name__ == "__main__":
    main()
