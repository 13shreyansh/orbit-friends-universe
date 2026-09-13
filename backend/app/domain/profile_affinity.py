from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import date
from typing import Iterable

from app.ports.semantic_similarity import SemanticSimilarity
from app.schemas.profile import DateRange, PlaceInput, ProfileIntake
from app.schemas.universe import ScoreFeature


PROFILE_AFFINITY_WEIGHTS = {
    "location_similarity": 0.15,
    "education_similarity": 0.16,
    "field_similarity": 0.18,
    "interest_similarity": 0.20,
    "career_similarity": 0.11,
    "trajectory_similarity": 0.10,
    "personality_similarity": 0.10,
}

PERSONALITY_AXIS_WEIGHTS = (0.20, 0.30, 0.30, 0.20)


@dataclass(frozen=True)
class ProfileAffinityResult:
    score: float | None
    confidence: float
    features: list[ScoreFeature]


def _canonical(value: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", value.strip().lower())


def _haversine_km(left: PlaceInput, right: PlaceInput) -> float | None:
    if None in {left.latitude, left.longitude, right.latitude, right.longitude}:
        return None
    lat1, lon1, lat2, lon2 = map(
        math.radians,
        [left.latitude, left.longitude, right.latitude, right.longitude],
    )
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    value = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    return 6371.0088 * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0.0, 1 - value)))


def _place_similarity(left: PlaceInput, right: PlaceInput) -> float:
    distance = _haversine_km(left, right)
    if distance is not None:
        return math.exp(-distance / 600)
    if _canonical(left.name) == _canonical(right.name):
        return 1.0
    if left.country_code and right.country_code and left.country_code.lower() == right.country_code.lower():
        return 0.18
    return 0.0


def _places(profile: ProfileIntake) -> list[PlaceInput]:
    return [
        *([profile.birth_place] if profile.birth_place else []),
        *(item.place for item in profile.residences),
        *(item.place for item in profile.education if item.place),
        *(item.place for item in profile.work if item.place),
    ]


def _location_similarity(left: ProfileIntake, right: ProfileIntake) -> float | None:
    a = _places(left)
    b = _places(right)
    if not a or not b:
        return None
    return max(_place_similarity(x, y) for x in a for y in b)


def _period_overlap(left: DateRange, right: DateRange) -> float | None:
    if not left.start_date or not right.start_date:
        return None
    today = date.today()
    left_end = left.end_date or today
    right_end = right.end_date or today
    overlap = max(0, (min(left_end, right_end) - max(left.start_date, right.start_date)).days)
    span = max(1, (max(left_end, right_end) - min(left.start_date, right.start_date)).days)
    return overlap / span


def _education_similarity(left: ProfileIntake, right: ProfileIntake) -> float | None:
    if not left.education or not right.education:
        return None
    best = 0.0
    for a in left.education:
        for b in right.education:
            same = float(_canonical(a.institution) == _canonical(b.institution))
            overlap = _period_overlap(a.period, b.period)
            place = _place_similarity(a.place, b.place) if a.place and b.place else 0.0
            candidate = same * (0.82 + 0.18 * (overlap if overlap is not None else 0.5))
            best = max(best, candidate, 0.32 * place)
    return best


def _personality_similarity(left: ProfileIntake, right: ProfileIntake) -> float | None:
    if not left.personality_type or not right.personality_type:
        return None
    a = left.personality_type.value
    b = right.personality_type.value
    return sum(weight for index, weight in enumerate(PERSONALITY_AXIS_WEIGHTS) if a[index] == b[index])


def _trajectory_similarity(left: ProfileIntake, right: ProfileIntake) -> float | None:
    values: list[float] = []
    if left.birth_date and right.birth_date:
        age_gap_years = abs((left.birth_date - right.birth_date).days) / 365.2425
        values.append(math.exp(-age_gap_years / 10))
    left_periods = [
        *(item.period for item in left.residences),
        *(item.period for item in left.education),
        *(item.period for item in left.work),
    ]
    right_periods = [
        *(item.period for item in right.residences),
        *(item.period for item in right.education),
        *(item.period for item in right.work),
    ]
    overlaps = [value for a in left_periods for b in right_periods if (value := _period_overlap(a, b)) is not None]
    if overlaps:
        values.append(max(overlaps))
    return sum(values) / len(values) if values else None


def _semantic_values(profile: ProfileIntake, dimension: str) -> list[str]:
    if dimension == "field_similarity":
        return [item.field_of_study for item in profile.education if item.field_of_study]
    if dimension == "interest_similarity":
        return [value for item in profile.interests for value in (item.name, item.category) if value]
    if dimension == "career_similarity":
        return [
            value
            for item in profile.work
            for value in (item.organization, item.role, item.industry)
            if value
        ]
    raise ValueError(f"Unknown semantic affinity dimension: {dimension}")


def calculate_profile_affinity(
    left: ProfileIntake,
    right: ProfileIntake,
    semantic_similarity: SemanticSimilarity,
) -> ProfileAffinityResult:
    """Compare objective profile evidence and renormalize around missing fields."""

    values: dict[str, float | None] = {
        "location_similarity": _location_similarity(left, right),
        "education_similarity": _education_similarity(left, right),
        "field_similarity": semantic_similarity.compare(
            _semantic_values(left, "field_similarity"),
            _semantic_values(right, "field_similarity"),
            dimension="field_of_study",
        ),
        "interest_similarity": semantic_similarity.compare(
            _semantic_values(left, "interest_similarity"),
            _semantic_values(right, "interest_similarity"),
            dimension="interest",
        ),
        "career_similarity": semantic_similarity.compare(
            _semantic_values(left, "career_similarity"),
            _semantic_values(right, "career_similarity"),
            dimension="career",
        ),
        "trajectory_similarity": _trajectory_similarity(left, right),
        "personality_similarity": _personality_similarity(left, right),
    }
    observed_weight = sum(PROFILE_AFFINITY_WEIGHTS[name] for name, value in values.items() if value is not None)
    if not observed_weight:
        return ProfileAffinityResult(score=None, confidence=0.0, features=[])
    score = sum(PROFILE_AFFINITY_WEIGHTS[name] * float(value) for name, value in values.items() if value is not None) / observed_weight
    features = [
        ScoreFeature(
            name=name,
            value=round(float(value), 6),
            weight=round(weight / observed_weight, 6),
            contribution=round(float(value) * weight / observed_weight, 6),
            confidence=1.0,
        )
        for name, weight in PROFILE_AFFINITY_WEIGHTS.items()
        if (value := values[name]) is not None
    ]
    return ProfileAffinityResult(
        score=round(max(0.0, min(1.0, score)), 6),
        confidence=round(observed_weight / sum(PROFILE_AFFINITY_WEIGHTS.values()), 6),
        features=features,
    )

