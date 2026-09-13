from __future__ import annotations

import colorsys
import hashlib
import re

from app.ports.ecosystem_generation import EcosystemGenerationInput
from app.schemas.activity import EcosystemEffect, EcosystemTraits


TRAIT_CUES: dict[str, tuple[str, ...]] = {
    "vitality": (
        "grow", "garden", "forest", "plant", "pet", "food", "cook", "exercise", "health",
        "生长", "花", "树", "宠物", "猫", "狗", "吃饭", "做饭", "运动", "健康", "晨跑",
    ),
    "serenity": (
        "quiet", "calm", "rest", "sleep", "read", "tea", "rain", "alone", "slow",
        "安静", "平静", "休息", "睡觉", "失眠", "阅读", "喝茶", "下雨", "独处", "散步",
    ),
    "intensity": (
        "deadline", "stress", "angry", "argument", "fight", "pain", "sick", "breakup", "urgent",
        "截止", "压力", "生气", "争吵", "疼", "生病", "分手", "加班", "紧急", "崩溃",
    ),
    "connection": (
        "friend", "family", "love", "together", "team", "meet", "party", "dinner", "date",
        "朋友", "家人", "恋爱", "爱", "一起", "团队", "见面", "聚会", "约会", "晚餐",
    ),
    "motion": (
        "travel", "move", "run", "walk", "ride", "flight", "commute", "arrive", "leave",
        "旅行", "搬家", "跑步", "走路", "骑车", "航班", "通勤", "出发", "到达", "离开",
    ),
    "memory": (
        "remember", "memory", "miss", "anniversary", "childhood", "old", "again", "goodbye",
        "记得", "回忆", "想念", "纪念", "童年", "以前", "故乡", "告别", "又一次",
    ),
    "novelty": (
        "first", "new", "learn", "idea", "create", "discover", "begin", "launch", "project",
        "第一次", "新的", "学习", "想法", "创造", "发现", "开始", "发布", "项目", "尝试",
    ),
}


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _color(hue: float, saturation: float, lightness: float) -> str:
    red, green, blue = colorsys.hls_to_rgb(hue % 1, lightness, saturation)
    return f"#{round(red * 255):02x}{round(green * 255):02x}{round(blue * 255):02x}"


def _tokens(value: str) -> list[str]:
    return re.findall(r"[\w\u3400-\u9fff]+", value.casefold(), re.UNICODE)


class LocalSemanticEcosystemGenerator:
    """Deterministic local stand-in for the future semantic/AI generator.

    Content is projected onto continuous traits. Cue words only nudge those
    dimensions; they never gate or reject a post, so any human expression has
    a stable visual result.
    """

    def generate(self, source: EcosystemGenerationInput) -> EcosystemEffect:
        semantic_text = " ".join((source.title, source.text, *source.tags)).casefold()
        digest = hashlib.sha256(
            f"{source.owner_user_id}:{source.activity_id}:{semantic_text}:{source.media_types}".encode("utf-8")
        ).digest()
        token_count = max(1, len(_tokens(semantic_text)))
        values: dict[str, float] = {}
        for index, (trait, cues) in enumerate(TRAIT_CUES.items()):
            baseline = 0.34 + (digest[index] / 255) * 0.24
            matches = sum(semantic_text.count(cue) for cue in cues)
            values[trait] = _clamp(baseline + min(0.42, matches * (0.16 + 1 / (token_count + 8))))

        media_types = set(source.media_types)
        values["memory"] = _clamp(values["memory"] + (0.10 if media_types else 0))
        values["motion"] = _clamp(values["motion"] + (0.20 if "video" in media_types else 0))
        values["connection"] = _clamp(values["connection"] + (0.10 if "audio" in media_types else 0))
        values["novelty"] = _clamp(values["novelty"] + min(0.12, len(source.tags) * 0.025))
        values["intensity"] = _clamp(values["intensity"] + min(0.12, semantic_text.count("!") * 0.035))

        ranked = sorted(values, key=values.get, reverse=True)
        semantic_key = f"{ranked[0]}-{ranked[1]}-terrain"
        hue = (
            values["serenity"] * 0.55
            + values["vitality"] * 0.32
            + values["intensity"] * 0.03
            + values["novelty"] * 0.78
            + digest[12] / 255 * 0.12
        ) % 1
        intensity = _clamp(
            0.34
            + values["intensity"] * 0.28
            + values["vitality"] * 0.14
            + values["novelty"] * 0.10
            + len(source.media_types) * 0.035
        )
        landmarks = min(24, 6 + round(sum(values.values()) * 1.45) + len(source.media_types))

        return EcosystemEffect(
            kind=semantic_key,
            seed=int.from_bytes(digest[:4], "big"),
            intensity=intensity,
            signal_strength=_clamp(intensity + 0.04 + len(source.media_types) * 0.025),
            landmark_count=landmarks,
            primary_color=_color(hue, 0.58 + values["intensity"] * 0.22, 0.58 + values["serenity"] * 0.08),
            secondary_color=_color(hue + 0.16 + values["connection"] * 0.12, 0.62, 0.64),
            traits=EcosystemTraits(**values),
        )
