from __future__ import annotations

import argparse
import json
import os
from datetime import date, datetime, timezone
from typing import Any, Mapping

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.application.profile import upsert_intake
from app.application.serialization import dumps
from app.db import (
    Database,
    NebulaGraphEdgeRow,
    NebulaMemberRow,
    NebulaRow,
    NebulaSpatialSnapshotRow,
    PlanetRow,
    RelationshipRow,
    UserRow,
)
from app.schemas.profile import (
    DateRange,
    AchievementInput,
    EducationInput,
    EducationLevel,
    InterestInput,
    PersonalityType,
    PlaceInput,
    ProfileAttributeInput,
    ProfileIntake,
    ProjectInput,
    ResidenceInput,
    SkillInput,
    WorkInput,
)
from app.security import hash_password


POPULATION_PREFIX = "local-population-"
POPULATION_SIZE = 100
PRODUCTION_VALUES = {"prod", "production"}
PRODUCTION_CONFIRMATION = "SEED_SYNTHETIC_POPULATION"
DEFAULT_EMPTY_NEBULA_SLUGS = frozenset({"adventurex"})
PERSONALITIES = tuple(PersonalityType)

CHINESE_NAMES = (
    "顾清岚", "林知夏", "陈予安", "周砚秋", "苏念川", "沈星遥", "陆景行", "叶书宁", "江望舒", "许闻舟",
    "唐若曦", "温以宁", "秦川", "程月白", "宋知微", "夏木", "白榆", "黎川", "贺星野", "罗一澄",
    "张雨桐", "王泽宇", "李梦瑶", "赵子涵", "刘昊然", "杨思远", "黄嘉怡", "吴越", "徐嘉木", "孙悦",
    "胡思齐", "朱子墨", "高若琳", "郭浩宇", "何嘉宁", "马晨曦", "梁思成", "谢婉清", "宋亦凡", "郑语彤",
    "韩东阳", "冯诗涵", "于青禾", "董子轩", "萧雨晴", "程嘉言", "曹安然", "袁景川", "邓楚涵", "许星辰",
    "曾可欣", "彭致远", "潘晓彤", "蔡明哲", "余书瑶", "杜晨", "戴雨薇", "夏子昂", "钟灵", "汪奕辰",
    "田佳音", "任向晚", "姜予希", "范博文", "方清越", "石晓岚", "姚远", "谭思源", "廖安琪", "邹云舟",
    "熊可为", "金若水", "陶一诺", "韦思南", "孟知行", "龙雨菲", "雷明远", "侯静姝", "莫子衿", "邱亦航",
    "崔若溪", "康景明", "毛以沫", "郝文轩", "孔令仪", "邵嘉树", "史云舒", "顾南星", "章逸凡", "祁乐言",
    "鲁昭阳", "苗若初", "庞清和", "樊知秋", "蓝星河", "覃思雨", "乔木", "欧阳子衿", "司徒明月", "上官云川",
)
REGIONS = (
    ("北京", "北京", "清华大学"), ("上海", "上海", "同济大学"), ("广州", "广东", "中山大学"),
    ("深圳", "广东", "深圳大学"), ("杭州", "浙江", "浙江大学"), ("南京", "江苏", "南京大学"),
    ("苏州", "江苏", "苏州大学"), ("成都", "四川", "四川大学"), ("重庆", "重庆", "重庆大学"),
    ("武汉", "湖北", "武汉大学"), ("西安", "陕西", "西安交通大学"), ("长沙", "湖南", "中南大学"),
    ("郑州", "河南", "郑州大学"), ("济南", "山东", "山东大学"), ("青岛", "山东", "中国海洋大学"),
    ("厦门", "福建", "厦门大学"), ("福州", "福建", "福州大学"), ("合肥", "安徽", "中国科学技术大学"),
    ("天津", "天津", "天津大学"), ("石家庄", "河北", "河北师范大学"), ("太原", "山西", "太原理工大学"),
    ("沈阳", "辽宁", "东北大学"), ("大连", "辽宁", "大连理工大学"), ("长春", "吉林", "吉林大学"),
    ("哈尔滨", "黑龙江", "哈尔滨工业大学"), ("南昌", "江西", "南昌大学"), ("南宁", "广西", "广西大学"),
    ("昆明", "云南", "云南大学"), ("贵阳", "贵州", "贵州大学"), ("兰州", "甘肃", "兰州大学"),
    ("乌鲁木齐", "新疆", "新疆大学"), ("呼和浩特", "内蒙古", "内蒙古大学"), ("银川", "宁夏", "宁夏大学"),
    ("西宁", "青海", "青海大学"), ("海口", "海南", "海南大学"), ("拉萨", "西藏", "西藏大学"),
    ("香港", "香港", "香港理工大学"), ("澳门", "澳门", "澳门大学"), ("桂林", "广西", "广西师范大学"),
    ("泉州", "福建", "华侨大学"),
)
ORGANIZATIONS = (
    "星河产品实验室", "南风影像工作室", "城市共创中心", "远山科技", "青苔生态设计",
    "回声音乐厂牌", "北辰数据研究院", "在地观察社", "开源港湾", "余晖艺术空间",
    "云帆教育科技", "山海建筑事务所", "微光公益基金会", "新芽农业科技", "澄明心理中心",
    "拾光出版", "行星游戏工作室", "知行咨询", "潮汐博物馆", "竹影文化传媒",
)
SKILLS = (
    "产品设计", "纪实摄影", "社区营造", "软件工程", "生态研究", "音乐制作", "数据叙事", "城市研究",
    "开源协作", "教育设计", "建筑设计", "品牌策略", "人工智能", "心理咨询", "短片导演", "公共艺术",
    "交互设计", "自然教育", "供应链管理", "非遗研究", "游戏策划", "新媒体运营", "科研写作", "展览策划",
)
INTERESTS = (
    "天文观测", "夜间散步", "独立电影", "创意编程", "可持续城市", "现场音乐", "纪录片", "公共空间",
    "创客文化", "未来教育", "徒步", "咖啡", "地方美食", "古建筑", "科幻文学", "戏剧", "陶艺", "潜水",
    "骑行", "露营", "桌游", "园艺", "播客", "博物馆", "传统手工艺", "旅行写作", "观鸟", "攀岩",
)
FIELDS = ("计算机科学", "视觉传达", "社会学", "建筑学", "新闻传播", "环境科学", "应用数学", "心理学", "教育学", "工业设计", "生物学", "经济学")
ROLES = ("产品经理", "前端工程师", "摄影师", "城市研究员", "教师", "建筑师", "数据分析师", "策展人", "音乐制作人", "心理咨询师", "公益项目主管", "独立开发者")
INDUSTRIES = ("互联网", "文化艺术", "教育", "建筑与城市", "公益", "科研", "媒体", "环保", "消费品牌", "医疗健康")
ARCHETYPES = ("verdant", "oceanic", "terran", "volcanic", "crystalline")
PLANET_ADJECTIVES = (
    "流光", "静谧", "青岚", "潮汐", "琥珀", "银辉", "苔原", "星穹", "赤霞", "远游",
)
PLANET_NOUNS = (
    "港", "原野", "花园", "地平线", "档案馆", "环礁", "观测站", "栖息地", "熔炉", "云海",
)

NEBULAE: tuple[dict[str, Any], ...] = (
    {"slug": "adventurex", "code": "202600", "name": "AdventureX", "description": "Builders and explorers turning ambitious ideas into shared journeys.", "shape": "spiral", "accent": "#65d9d0"},
    {"slug": "afterglow-lab", "code": "204101", "name": "Afterglow Lab", "description": "Experimental art, light and speculative interfaces.", "shape": "veil", "accent": "#ef7f99"},
    {"slug": "night-walkers", "code": "731802", "name": "Night Walkers", "description": "Quiet city walks and conversations after midnight.", "shape": "ring", "accent": "#6c8fe8"},
    {"slug": "indie-makers", "code": "482003", "name": "Indie Makers", "description": "Small teams making difficult ideas real.", "shape": "burst", "accent": "#ef9b64"},
    {"slug": "film-orbit", "code": "608204", "name": "Film Orbit", "description": "Images, documentaries and stories made together.", "shape": "veil", "accent": "#d26f8d"},
    {"slug": "city-field-notes", "code": "315705", "name": "City Field Notes", "description": "People observing how cities change and remember.", "shape": "spiral", "accent": "#62c3c8"},
    {"slug": "open-source-harbor", "code": "972406", "name": "Open Source Harbor", "description": "Maintainers of useful public infrastructure.", "shape": "ring", "accent": "#7ad0aa"},
    {"slug": "future-education", "code": "410907", "name": "Future Education", "description": "Learning communities, tools and new classrooms.", "shape": "burst", "accent": "#e68d6f"},
    {"slug": "sound-travelers", "code": "556008", "name": "Sound Travelers", "description": "Field recordings, music and places heard from afar.", "shape": "veil", "accent": "#b683d5"},
    {"slug": "green-commons", "code": "864309", "name": "Green Commons", "description": "Ecology, local action and shared green spaces.", "shape": "spiral", "accent": "#5fc6a1"},
)


def reject_production_environment(
    environment: Mapping[str, str] | None = None,
    *,
    allow_production: bool = False,
    production_confirmation: str = "",
) -> None:
    values = os.environ if environment is None else environment
    for name in ("APP_ENV", "NODE_ENV", "ENVIRONMENT", "SOCIAL_COSMOS_ENV"):
        if values.get(name, "").strip().lower() in PRODUCTION_VALUES:
            if allow_production and production_confirmation == PRODUCTION_CONFIRMATION:
                return
            raise RuntimeError(f"Population seed is disabled when {name} is production")


def _user_id(index: int) -> str:
    return f"{POPULATION_PREFIX}{index + 1:03d}"


def _profile(index: int) -> ProfileIntake:
    display_name = CHINESE_NAMES[index]
    city, province, school = REGIONS[index % len(REGIONS)]
    birth_city, birth_province, _ = REGIONS[(index * 11 + 7) % len(REGIONS)]
    skill = SKILLS[(index * 5) % len(SKILLS)]
    interest = INTERESTS[(index * 7) % len(INTERESTS)]
    role = ROLES[index % len(ROLES)]
    field = FIELDS[(index * 5 + 2) % len(FIELDS)]
    industry = INDUSTRIES[(index * 3) % len(INDUSTRIES)]
    born = 1983 + index % 17
    education_start = born + 18
    education_end = education_start + 4
    work_start = education_end + 1
    return ProfileIntake(
        display_name=display_name,
        bio=f"现居{province}{city}，从事{role}工作，关注{field}与{interest}。喜欢把专业经验带进真实社区，也愿意认识来自不同地方的人。",
        birth_date=date(born, index % 12 + 1, index % 27 + 1),
        birth_place=PlaceInput(name=f"{birth_province}{birth_city}"),
        personality_type=PERSONALITIES[index % len(PERSONALITIES)],
        residences=[ResidenceInput(
            place=PlaceInput(name=f"{province}{city}"),
            period=DateRange(start_date=date(max(work_start, 2018), 1, 1), is_current=True),
        )],
        education=[EducationInput(
            institution=school,
            level=(EducationLevel.BACHELOR, EducationLevel.MASTER, EducationLevel.DOCTORATE)[index % 3],
            field_of_study=field,
            period=DateRange(start_date=date(education_start, 9, 1), end_date=date(education_end, 6, 30)),
            place=PlaceInput(name=f"{province}{city}"),
        )],
        work=[WorkInput(
            organization=ORGANIZATIONS[(index * 3) % len(ORGANIZATIONS)],
            role=role,
            industry=industry,
            seniority=("individual", "lead", "manager")[index % 3],
            period=DateRange(start_date=date(work_start, 7, 1), is_current=True),
            place=PlaceInput(name=f"{province}{city}"),
            highlights=[f"负责{skill}相关项目。", f"持续参与{interest}社群活动。"],
        )],
        projects=[ProjectInput(
            title=("城市微光计划", "山河观察笔记", "社区数字档案", "青年共创周", "地方声音地图")[index % 5],
            kind=("community", "research", "open-source")[index % 3],
            domain=field,
            description=f"与不同背景的伙伴合作，用{skill}回应{city}的真实生活议题。",
            collaborator_count=3 + index % 18,
            period=DateRange(start_date=date(max(work_start, 2020), 3, 1), is_current=index % 3 != 0),
        )],
        skills=[
            SkillInput(name=skill, proficiency=3 + index % 3),
            SkillInput(name=SKILLS[(index * 5 + 7) % len(SKILLS)], proficiency=2 + index % 4),
            SkillInput(name=SKILLS[(index * 5 + 13) % len(SKILLS)], proficiency=2 + (index + 1) % 4),
        ],
        interests=[
            InterestInput(name=interest),
            InterestInput(name=INTERESTS[(index * 7 + 9) % len(INTERESTS)]),
            InterestInput(name=INTERESTS[(index * 7 + 17) % len(INTERESTS)]),
        ],
        achievements=[AchievementInput(
            title=("完成一次跨城协作", "组织社区公开活动", "发布个人研究作品", "参与公益志愿项目")[index % 4],
            kind=("collaboration", "community", "publication", "volunteer")[index % 4],
            occurred_at=date(2021 + index % 5, index % 12 + 1, 10),
            description=f"在{city}与伙伴共同完成，并积累了持续合作的经验。",
        )],
        attributes=[
            ProfileAttributeInput(key="development.synthetic-cohort", label="本地模拟人群", category="development", value="population-100-v3"),
            ProfileAttributeInput(key="community.region", label="常驻地区", category="community", value=[province, city]),
            ProfileAttributeInput(
                key="collaboration.preference",
                label="协作偏好",
                category="collaboration",
                value=("小组深度协作", "跨领域共创", "线上异步合作", "线下社区行动")[index % 4],
            ),
        ],
    )


def _upsert_user(db: Session, index: int, password_hash: str) -> UserRow:
    user_id = _user_id(index)
    profile = _profile(index)
    user = db.get(UserRow, user_id)
    if user is None:
        user = UserRow(
            id=user_id,
            email=f"population-{index + 1:03d}@simulation.local",
            password_hash=password_hash,
            display_name=profile.display_name,
            bio=profile.bio,
            tags_json="[]",
        )
        db.add(user)
        db.flush()
    else:
        user.email = f"population-{index + 1:03d}@simulation.local"
        user.password_hash = password_hash
    user.tags_json = dumps([item.name for item in profile.interests])
    upsert_intake(db, user, profile)
    planet = db.scalar(select(PlanetRow).where(PlanetRow.owner_user_id == user.id))
    if planet is not None:
        visual = json.loads(planet.visual_json)
        visual.update({
            "archetype": ARCHETYPES[index % len(ARCHETYPES)],
            "ring": index % 7 == 0,
            "satellites": index % 4,
        })
        planet.visual_json = dumps(visual)
        identity = json.loads(planet.identity_json)
        identity.update({
            "name": f"{PLANET_ADJECTIVES[index % 10]} {PLANET_NOUNS[index // 10]}",
            "motto": (
                "Make room for unlikely connections.",
                "Small observations become lasting worlds.",
                "Build carefully, wander often.",
                "Every shared story changes the terrain.",
                "Stay curious about distant signals.",
            )[index % 5],
        })
        planet.identity_json = dumps(identity)
    return user


def _upsert_nebula(
    db: Session,
    index: int,
    users: list[UserRow],
    *,
    empty_nebula_slugs: frozenset[str],
) -> NebulaRow:
    definition = NEBULAE[index]
    nebula_id = f"nebula-{POPULATION_PREFIX}{index + 1:02d}"
    nebula = db.get(NebulaRow, nebula_id) or db.scalar(select(NebulaRow).where(NebulaRow.slug == definition["slug"]))
    owner = users[index * 10]
    theme = {
        "seed": 202600 + index * 137,
        "shape": definition["shape"],
        "accent": definition["accent"],
        "secondary": ("#ff9f79", "#69c9b7", "#8a9fe3")[index % 3],
        "core": "#fff0c7",
        "density": round(0.66 + (index % 5) * 0.06, 2),
    }
    if nebula is None:
        nebula = NebulaRow(
            id=nebula_id,
            slug=definition["slug"],
            join_code=definition["code"],
            name=definition["name"],
            description=definition["description"],
            owner_user_id=owner.id,
            theme_json=dumps(theme),
        )
        db.add(nebula)
        db.flush()
    else:
        nebula.name = definition["name"]
        nebula.description = definition["description"]
        if definition["slug"] not in empty_nebula_slugs:
            nebula.owner_user_id = owner.id
        nebula.theme_json = dumps(theme)

    # Reserved nebulae stay empty so a real user can establish them manually.
    # The populated nebulae intentionally overlap, with 50 people in each one.
    if definition["slug"] in empty_nebula_slugs:
        member_indexes: list[int] = []
    else:
        owner_index = index * 10
        member_indexes = [owner_index]
        for offset in range(POPULATION_SIZE):
            candidate = (index * 11 + offset * 3) % POPULATION_SIZE
            if candidate not in member_indexes:
                member_indexes.append(candidate)
            if len(member_indexes) == 50:
                break

    desired_user_ids = {users[member_index].id for member_index in member_indexes}
    if definition["slug"] in empty_nebula_slugs:
        db.execute(delete(NebulaMemberRow).where(NebulaMemberRow.nebula_id == nebula.id))
    else:
        db.execute(delete(NebulaMemberRow).where(
            NebulaMemberRow.nebula_id == nebula.id,
            NebulaMemberRow.user_id.startswith(POPULATION_PREFIX),
            ~NebulaMemberRow.user_id.in_(desired_user_ids),
        ))
    for member_index in member_indexes:
        user = users[member_index]
        membership = db.scalar(select(NebulaMemberRow).where(
            NebulaMemberRow.nebula_id == nebula.id,
            NebulaMemberRow.user_id == user.id,
        ))
        if membership is None:
            db.add(NebulaMemberRow(
                id=f"nebula-member-{nebula.id}-{user.id}",
                nebula_id=nebula.id,
                user_id=user.id,
                role="owner" if user.id == owner.id else "member",
            ))
        else:
            membership.role = "owner" if user.id == owner.id else "member"

    # Membership/profile changes invalidate the derived graph and layout.
    db.execute(delete(NebulaGraphEdgeRow).where(NebulaGraphEdgeRow.nebula_id == nebula.id))
    db.execute(delete(NebulaSpatialSnapshotRow).where(NebulaSpatialSnapshotRow.nebula_id == nebula.id))
    return nebula


def _upsert_relationships(db: Session, users: list[UserRow]) -> None:
    relation_types = ("friend", "colleague", "community")
    for community in range(10):
        base = community * 10
        for offset in range(10):
            owner = users[base + offset]
            for distance in (1, 2):
                target = users[base + (offset + distance) % 10]
                row = db.scalar(select(RelationshipRow).where(
                    RelationshipRow.owner_user_id == owner.id,
                    RelationshipRow.target_user_id == target.id,
                ))
                if row is None:
                    row = RelationshipRow(
                        id=f"relationship-{owner.id}-{target.id}",
                        owner_user_id=owner.id,
                        target_user_id=target.id,
                    )
                    db.add(row)
                strength = round(0.82 - distance * 0.11 + (offset % 3) * 0.025, 3)
                row.relation_type = relation_types[(community + offset + distance) % len(relation_types)]
                row.identity_label = "Core community connection" if distance == 1 else "Shared-interest connection"
                row.description = f"Synthetic relationship inside {NEBULAE[community]['name']} for local product testing."
                row.signals_json = dumps({"fixture": "population-100-v3", "community": NEBULAE[community]["slug"]})
                row.score_json = dumps({"strength": strength})
                row.status = "active"
                row.started_at = f"{2018 + community % 6}-0{distance + 1}-15"
                row.updated_at = datetime.now(timezone.utc)


def seed_population(
    db: Session,
    *,
    password: str = "Population2026!",
    environment: Mapping[str, str] | None = None,
    allow_production: bool = False,
    production_confirmation: str = "",
    empty_nebula_slugs: frozenset[str] = DEFAULT_EMPTY_NEBULA_SLUGS,
) -> dict[str, Any]:
    reject_production_environment(
        environment,
        allow_production=allow_production,
        production_confirmation=production_confirmation,
    )
    password_hash = hash_password(password)
    users = [_upsert_user(db, index, password_hash) for index in range(POPULATION_SIZE)]
    nebulae = [
        _upsert_nebula(db, index, users, empty_nebula_slugs=empty_nebula_slugs)
        for index in range(len(NEBULAE))
    ]
    _upsert_relationships(db, users)
    db.flush()

    user_ids = [user.id for user in users]
    nebula_ids = [nebula.id for nebula in nebulae]
    return {
        "cohort": "population-100-v3",
        "emptyNebulae": sorted(empty_nebula_slugs),
        "users": db.scalar(select(func.count()).select_from(UserRow).where(UserRow.id.in_(user_ids))),
        "planets": db.scalar(select(func.count()).select_from(PlanetRow).where(PlanetRow.owner_user_id.in_(user_ids))),
        "nebulae": db.scalar(select(func.count()).select_from(NebulaRow).where(NebulaRow.id.in_(nebula_ids))),
        "memberships": db.scalar(select(func.count()).select_from(NebulaMemberRow).where(NebulaMemberRow.nebula_id.in_(nebula_ids))),
        "relationships": db.scalar(select(func.count()).select_from(RelationshipRow).where(RelationshipRow.owner_user_id.in_(user_ids))),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed 100 synthetic users while preserving reserved empty nebulae.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-production", action="store_true")
    parser.add_argument("--confirm-production-seed", default="")
    parser.add_argument("--empty-nebula", action="append", default=["adventurex"])
    arguments = parser.parse_args()
    password = os.getenv("POPULATION_DEV_PASSWORD", "").strip()
    if arguments.allow_production and not password:
        raise RuntimeError("POPULATION_DEV_PASSWORD is required for an explicitly approved production seed")
    if not password:
        password = "Population2026!"
    database = Database()
    database.create_schema()
    session = database.session_factory()
    try:
        result = seed_population(
            session,
            password=password,
            allow_production=arguments.allow_production,
            production_confirmation=arguments.confirm_production_seed,
            empty_nebula_slugs=frozenset(arguments.empty_nebula),
        )
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
