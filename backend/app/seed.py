from __future__ import annotations

import json
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import ActivityPostRow, NebulaMemberRow, NebulaRow, PlanetRow, RelationshipRow, UserRow
from app.domain.planet_generator import PlanetGenerationRequest, planet_generator
from app.schemas.profile import DateRange, EducationInput, EducationLevel, ProfileIntake, ProjectInput, SkillInput, WorkInput
from app.security import hash_password
from app.services import dumps, loads, new_id, upsert_intake


DEMO_USERS = [
    ("demo-zaosusu", "demo@socialcosmos.local", "Zaosusu", "Builder, stargazer and keeper of durable friendships."),
    ("maya", "maya@socialcosmos.local", "Maya Chen", "Photographer and collector of midnight conversations."),
    ("lin", "lin@socialcosmos.local", "Lin Wei", "Warm, practical and always connected to home."),
    ("jonas", "jonas@socialcosmos.local", "Jonas Berg", "Direct builder with restless momentum."),
    ("priya", "priya@socialcosmos.local", "Priya Nair", "Quiet weekends, green places and good coffee."),
    ("alex", "alex@socialcosmos.local", "Alex Rivera", "Music, distance and carefully kept memories."),
]

DEMO_VISUAL_VARIANTS = [
    ("verdant", 4281, False, 1),
    ("oceanic", 7193, False, 2),
    ("terran", 10517, True, 1),
    ("volcanic", 13829, True, 0),
    ("verdant", 17141, False, 3),
    ("crystalline", 20453, True, 2),
]

DEMO_NEBULAE = [
    ("nebula-adventurex", "adventurex", "202600", "AdventureX", "A shared universe for builders, explorers and new connections.", (0, 1, 2, 3, 4, 5), {"seed": 2026, "shape": "spiral", "accent": "#65d9d0", "secondary": "#ff9f79", "core": "#fff0c7", "density": 0.92}),
    ("nebula-afterglow", "afterglow-lab", "204101", "Afterglow Lab", "Experimental art, light and speculative interfaces.", (0, 1, 5), {"seed": 2041, "shape": "veil", "accent": "#ef7f99", "secondary": "#6fd6d1", "core": "#ffd49a", "density": 0.76}),
    ("nebula-nightwalk", "night-walkers", "731802", "Night Walkers", "Quiet city walks and conversations after midnight.", (1, 2, 4), {"seed": 7318, "shape": "ring", "accent": "#6c8fe8", "secondary": "#eab0cf", "core": "#aee7ef", "density": 0.64}),
    ("nebula-makers", "indie-makers", "482003", "Indie Makers", "Small teams turning difficult ideas into working things.", (0, 3, 4), {"seed": 4820, "shape": "burst", "accent": "#ef9b64", "secondary": "#69c9b7", "core": "#fff0b3", "density": 0.86}),
    ("nebula-film", "film-orbit", "608204", "Film Orbit", "Images, documentaries and stories made together.", (1, 5), {"seed": 6082, "shape": "veil", "accent": "#d26f8d", "secondary": "#72a8df", "core": "#ffd6ab", "density": 0.7}),
    ("nebula-fieldnotes", "city-field-notes", "315705", "City Field Notes", "People observing how cities change and remember.", (1, 2, 3), {"seed": 3157, "shape": "spiral", "accent": "#62c3c8", "secondary": "#f0a66f", "core": "#e8ffd7", "density": 0.81}),
    ("nebula-open-source", "open-source-harbor", "972406", "Open Source Harbor", "Builders maintaining useful public infrastructure.", (0, 3, 5), {"seed": 9724, "shape": "ring", "accent": "#7ad0aa", "secondary": "#8a9fe3", "core": "#dcffd5", "density": 0.74}),
    ("nebula-education", "future-education", "410907", "Future Education", "Learning communities, tools and new classrooms.", (0, 2, 4), {"seed": 4109, "shape": "burst", "accent": "#e68d6f", "secondary": "#78c6d7", "core": "#fff1c2", "density": 0.68}),
    ("nebula-sound", "sound-travelers", "556008", "Sound Travelers", "Field recordings, music and places heard from afar.", (1, 4, 5), {"seed": 5560, "shape": "veil", "accent": "#b683d5", "secondary": "#ef9b73", "core": "#d8efff", "density": 0.72}),
    ("nebula-green", "green-commons", "864309", "Green Commons", "Ecology, local action and shared green spaces.", (2, 3, 4), {"seed": 8643, "shape": "spiral", "accent": "#5fc6a1", "secondary": "#e7bd67", "core": "#e9ffd0", "density": 0.84}),
]


def _ensure_demo_planet_visuals(db: Session) -> None:
    """Upgrade the original demo planets that all shared one default skin."""

    for index, (user_id, *_rest) in enumerate(DEMO_USERS):
        planet = db.scalar(select(PlanetRow).where(PlanetRow.owner_user_id == user_id))
        if not planet:
            continue
        current = loads(planet.visual_json, {})
        is_legacy_clone = (
            current.get("archetype") == "terran"
            and current.get("seed") == 4281
            and current.get("palette", {}).get("surface") == "#6f5a9f"
        )
        if not is_legacy_clone:
            continue
        archetype, seed, ring, satellites = DEMO_VISUAL_VARIANTS[index]
        visual = planet_generator.generate(PlanetGenerationRequest(
            mode="legacy",
            seed=seed,
            archetype=archetype,
            radius=current.get("radius", 1),
            ring=ring,
            satellites=satellites,
        ))
        visual.update({
            "terrain": min(0.9, visual["terrain"] + index * 0.055),
            "cloudDensity": max(0.12, min(0.82, visual["cloudDensity"] + (index - 2) * 0.07)),
        })
        planet.visual_json = dumps(visual)


def _profile(index: int, display_name: str, bio: str) -> ProfileIntake:
    levels = [EducationLevel.MASTER, EducationLevel.BACHELOR, EducationLevel.SECONDARY, EducationLevel.DOCTORATE, EducationLevel.VOCATIONAL, EducationLevel.ASSOCIATE]
    return ProfileIntake(
        display_name=display_name,
        bio=bio,
        birth_date=date(1988 + index, (index % 12) + 1, 12),
        education=[EducationInput(
            institution=["Soochow University", "NYU", "Suzhou School", "TU Berlin", "Delhi Arts College", "River Music Institute"][index],
            level=levels[index],
            field_of_study=["Design", "Photography", "Education", "Engineering", "Ecology", "Music"][index],
            period=DateRange(start_date=date(2006 + index, 9, 1), end_date=date(2010 + index, 6, 30)),
        )],
        work=[WorkInput(
            organization=["Cosmos Studio", "Cyan Studio", "Home Works", "Forge Systems", "Moss Cafe", "Violet Records"][index],
            role=["Product Builder", "Photographer", "Coordinator", "Technical Lead", "Community Host", "Musician"][index],
            industry=["Software", "Arts", "Community", "Engineering", "Hospitality", "Music"][index],
            seniority=["founder", "individual", "manager", "lead", "individual", "individual"][index],
            period=DateRange(start_date=date(2012 + index, 1, 1), is_current=True),
            highlights=[bio],
        )],
        projects=[ProjectInput(
            title=f"{display_name} shared project",
            kind="community" if index in {0, 4} else "project",
            domain=["social", "arts", "family", "technology", "community", "music"][index],
            description=bio,
            collaborator_count=3 + index,
            period=DateRange(start_date=date(2020, 1, 1), is_current=True),
        )],
        skills=[SkillInput(name=["Product", "Photography", "Care", "Engineering", "Hosting", "Music"][index], proficiency=max(1, 5 - index // 2))],
        interests=[{"name": ["Astronomy", "Night talks", "Home", "Building", "Coffee", "Memory"][index]}],
    )


def _ensure_demo_activity_experience(db: Session) -> None:
    zaosusu = db.get(UserRow, "demo-zaosusu")
    maya = db.get(UserRow, "maya")
    if not zaosusu or not maya:
        return

    reciprocal = db.scalar(select(RelationshipRow).where(
        RelationshipRow.owner_user_id == maya.id,
        RelationshipRow.target_user_id == zaosusu.id,
    ))
    if not reciprocal:
        db.add(RelationshipRow(
            id="relationship-maya-zaosusu",
            owner_user_id=maya.id,
            target_user_id=zaosusu.id,
            relation_type="friend",
            identity_label="Creative friend",
            description="We exchange prototypes, field notes and ambitious ideas.",
            signals_json=dumps({}),
            started_at="2018-09-03",
        ))

    maya_planet = db.scalar(select(PlanetRow).where(PlanetRow.owner_user_id == maya.id))
    activity = db.get(ActivityPostRow, "activity-demo-adventurex")
    if maya_planet:
        content_json = dumps({
            "kind": "life-update",
            "title": "Rain, an old bookshop, and a long conversation",
            "text": "Ming and I hid from the rain in a second-hand bookshop. We left with two old books and stayed for noodles until closing time.",
            "eventName": "",
            "location": "Suzhou",
            "tags": ["friendship", "rainy evening", "reading"],
        })
        ecosystem_json = dumps({
            "version": 1,
            "kind": "connection-memory-terrain",
            "seed": 20260723,
            "intensity": 0.72,
            "signalStrength": 0.82,
            "landmarkCount": 12,
            "primaryColor": "#66d9c4",
            "secondaryColor": "#b89cff",
            "traits": {
                "vitality": 0.54,
                "serenity": 0.76,
                "intensity": 0.32,
                "connection": 0.91,
                "motion": 0.38,
                "memory": 0.82,
                "novelty": 0.44,
            },
        })
        if not activity:
            activity = ActivityPostRow(
                id="activity-demo-adventurex",
                owner_user_id=maya.id,
                planet_id=maya_planet.id,
                content_json=content_json,
                media_json="[]",
                ecosystem_json=ecosystem_json,
                visibility="friends",
                published_at=datetime(2026, 7, 23, 10, 30, tzinfo=timezone.utc),
            )
            db.add(activity)
        else:
            activity.content_json = content_json
            activity.ecosystem_json = ecosystem_json
            activity.updated_at = datetime.now(timezone.utc)


def _ensure_demo_nebulae(db: Session) -> None:
    owner = db.get(UserRow, "demo-zaosusu")
    if not owner:
        return
    for nebula_id, slug, join_code, name, description, member_indexes, theme in DEMO_NEBULAE:
        nebula = db.scalar(select(NebulaRow).where(NebulaRow.slug == slug))
        if not nebula:
            nebula = NebulaRow(
                id=nebula_id,
                slug=slug,
                join_code=join_code,
                name=name,
                description=description,
                owner_user_id=owner.id,
                theme_json=dumps(theme),
            )
            db.add(nebula)
            db.flush()
        else:
            nebula.name = name
            nebula.description = description
            nebula.join_code = join_code
            nebula.theme_json = dumps(theme)
        existing_member_ids = set(db.scalars(
            select(NebulaMemberRow.user_id).where(NebulaMemberRow.nebula_id == nebula.id)
        ))
        for member_index in member_indexes:
            user_id = DEMO_USERS[member_index][0]
            if user_id in existing_member_ids or not db.get(UserRow, user_id):
                continue
            db.add(NebulaMemberRow(
                id=f"nebula-member-{slug}-{user_id}",
                nebula_id=nebula.id,
                user_id=user_id,
                role="owner" if user_id == owner.id else "member",
            ))


def seed_database(db: Session, enabled: bool = True) -> None:
    if not enabled:
        return
    if db.scalar(select(func.count()).select_from(UserRow)):
        _ensure_demo_planet_visuals(db)
        _ensure_demo_activity_experience(db)
        _ensure_demo_nebulae(db)
        db.flush()
        return
    for index, (user_id, email, display_name, bio) in enumerate(DEMO_USERS):
        user = UserRow(
            id=user_id,
            email=email,
            password_hash=hash_password("Cosmos2026!" if index == 0 else "Friend2026!"),
            display_name=display_name,
            bio=bio,
            tags_json="[]",
        )
        db.add(user)
        db.flush()
        upsert_intake(db, user, _profile(index, display_name, bio))
    relationships = [
        ("maya", "friend", "Best friend", "College friend and keeper of midnight conversations.", "2018-09-03"),
        ("lin", "family", "Mother", "The first person I call when something matters.", "1998-03-12"),
        ("jonas", "colleague", "Creative partner", "We turn difficult ideas into working systems.", "2023-04-18"),
        ("priya", "friend", "Neighbor and friend", "Weekend coffee and long walks.", "2024-06-08"),
        ("alex", "past", "Past partner", "A closed chapter whose memories still have weight.", "2020-02-14"),
    ]
    for target, relation_type, label, description, started_at in relationships:
        db.add(RelationshipRow(
            id=new_id("relationship"),
            owner_user_id="demo-zaosusu",
            target_user_id=target,
            relation_type=relation_type,
            identity_label=label,
            description=description,
            signals_json=dumps({}),
            started_at=started_at,
        ))
    db.flush()
    _ensure_demo_planet_visuals(db)
    _ensure_demo_activity_experience(db)
    _ensure_demo_nebulae(db)
    db.flush()
