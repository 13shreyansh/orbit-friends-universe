from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Iterable, Sequence

from app.schemas.memory import MemoryObject
from app.schemas.profile import DateRange, EducationLevel, ProfileIntake, Verification
from app.schemas.universe import PlanetScore, RelationshipScore, RelationshipSignals, ScoreFeature
from app.domain.semantic_evidence import aggregate_semantic_evidence


MASS_WEIGHTS = {
    "profile_completeness": 0.08,
    "education_depth": 0.15,
    "experience_depth": 0.18,
    "experience_breadth": 0.13,
    "skills_achievements": 0.11,
    "community_contribution": 0.08,
    "evidence_quality": 0.08,
    "memory_richness": 0.10,
    "self_behavior_momentum": 0.05,
    "social_response_momentum": 0.04,
}

EDUCATION_VALUES = {
    EducationLevel.PRIMARY: 0.10,
    EducationLevel.SECONDARY: 0.25,
    EducationLevel.VOCATIONAL: 0.42,
    EducationLevel.ASSOCIATE: 0.52,
    EducationLevel.BACHELOR: 0.68,
    EducationLevel.MASTER: 0.84,
    EducationLevel.DOCTORATE: 1.00,
    EducationLevel.OTHER: 0.45,
}

VERIFICATION_VALUES = {
    Verification.UNVERIFIED: 0.35,
    Verification.SELF_ATTESTED: 0.70,
    Verification.VERIFIED: 1.00,
}

SENIORITY_VALUES = {
    "intern": 0.25,
    "individual": 0.50,
    "lead": 0.68,
    "manager": 0.75,
    "executive": 0.88,
    "founder": 0.82,
    "other": 0.50,
}

RELATIONSHIP_DYNAMIC_WEIGHTS = {
    "interaction_frequency": 0.25,
    "recency": 0.15,
    "shared_experience": 0.23,
    "duration": 0.08,
    "reciprocity": 0.15,
    "semantic_interaction": 0.14,
}

@dataclass(frozen=True)
class BehaviorEvidence:
    event_type: str
    weight: float
    occurred_at: datetime


def _clamp(value: float, minimum: float = 0, maximum: float = 1) -> float:
    return max(minimum, min(maximum, value))


def _months(period: DateRange) -> float:
    if not period.start_date:
        return 0
    end = period.end_date or date.today()
    return max(0, (end - period.start_date).days / 30.4375)


def _saturating(values: Iterable[float], factor: float = 0.35) -> float:
    remainder = 1.0
    for value in values:
        remainder *= 1 - factor * _clamp(value)
    return _clamp(1 - remainder)


def _normalized_entropy(values: Iterable[str]) -> float:
    normalized = [value.strip().lower() for value in values if value and value.strip()]
    if not normalized:
        return 0
    counts = {value: normalized.count(value) for value in set(normalized)}
    if len(counts) == 1:
        return min(0.3, len(normalized) / 10)
    total = len(normalized)
    entropy = -sum((count / total) * math.log(count / total) for count in counts.values())
    return _clamp(entropy / math.log(len(counts)))


def _normalized_text(value: str) -> str:
    return " ".join(value.casefold().split())


def memory_evidence_key(memory: MemoryObject) -> tuple[object, ...]:
    """Return the substantive identity of a memory, excluding client IDs.

    IDs are transport identifiers and can be regenerated. Scoring and
    persistence idempotency instead use the event source, date, participants
    and context so reposting the same evidence cannot manufacture mass or
    relationship strength.
    """
    source = _normalized_text(memory.raw_text)
    if not source:
        source = memory.media_url.strip() or _normalized_text(memory.summary)
    people = tuple(sorted(
        (person.id.strip(), _normalized_text(person.name))
        for person in memory.people
        if person.id.strip() or person.name.strip()
    ))
    return (
        memory.source_type,
        source,
        memory.event_time.isoformat(),
        _normalized_text(memory.location),
        _normalized_text(memory.event_type),
        people,
    )


def deduplicate_memories(memories: Sequence[MemoryObject]) -> list[MemoryObject]:
    unique: dict[tuple[object, ...], MemoryObject] = {}
    for memory in memories:
        key = memory_evidence_key(memory)
        current = unique.get(key)
        if current is None or memory.confidence > current.confidence:
            unique[key] = memory
    return list(unique.values())


def effective_behavior_evidence_count(events: Sequence[BehaviorEvidence]) -> int:
    """Count one relationship evidence type per UTC day.

    Raw rows remain available for auditing. This count is the bounded value
    used by dynamic-evidence confidence, matching the momentum calculation.
    """
    buckets = set()
    for event in events:
        occurred_at = event.occurred_at
        if occurred_at.tzinfo is None:
            occurred_at = occurred_at.replace(tzinfo=timezone.utc)
        buckets.add((event.event_type, occurred_at.astimezone(timezone.utc).date().isoformat()))
    return len(buckets)


def _memory_richness(memories: Sequence[MemoryObject]) -> float:
    items = deduplicate_memories(memories)
    if not items:
        return 0.0
    volume = 1 - math.exp(-len(items) / 8)
    confidence = sum(item.confidence for item in items) / len(items)
    event_diversity = _normalized_entropy(item.event_type for item in items)
    temporal_diversity = _clamp(len({item.event_time.strftime("%Y-%m") for item in items}) / 8)
    related_people = {
        person.id
        for item in items
        for person in item.people
        if person.id
    }
    relationship_breadth = 1 - math.exp(-len(related_people) / 5)
    detail = sum(
        (
            bool(item.summary.strip())
            + bool(item.facts)
            + bool(item.emotions)
            + bool(item.location.strip())
            + bool(item.keywords)
            + bool(item.narrative.strip())
        ) / 6
        for item in items
    ) / len(items)
    return _clamp(
        0.26 * volume
        + 0.18 * confidence
        + 0.16 * event_diversity
        + 0.14 * temporal_diversity
        + 0.14 * relationship_breadth
        + 0.12 * detail
    )


def _behavior_momentum(
    events: Sequence[BehaviorEvidence],
    *,
    computed_at: datetime,
) -> float:
    if not events:
        return 0.0
    reference = computed_at if computed_at.tzinfo else computed_at.replace(tzinfo=timezone.utc)
    # One event type gets one bounded contribution per UTC day. Durable raw
    # audit rows remain available, while repetitive clicks/edits cannot grow
    # mass linearly.
    daily_maxima: dict[tuple[str, str], tuple[float, datetime]] = {}
    for event in events:
        occurred_at = event.occurred_at if event.occurred_at.tzinfo else event.occurred_at.replace(tzinfo=timezone.utc)
        key = (event.event_type, occurred_at.date().isoformat())
        current = daily_maxima.get(key)
        if current is None or event.weight > current[0]:
            daily_maxima[key] = (_clamp(event.weight, 0, 1), occurred_at)
    decayed_total = 0.0
    event_types: list[str] = []
    for (event_type, _day), (weight, occurred_at) in daily_maxima.items():
        age_days = max(0.0, (reference - occurred_at).total_seconds() / 86400)
        decay = math.exp(-math.log(2) * age_days / 90)
        decayed_total += weight * decay
        event_types.append(event_type)
    sustained_activity = 1 - math.exp(-decayed_total / 3.5)
    behavior_diversity = _normalized_entropy(event_types)
    return _clamp(0.82 * sustained_activity + 0.18 * behavior_diversity)


def _experience_value(months: float, detail: float, verification: Verification, responsibility: float = 0.5) -> float:
    duration = 1 - math.exp(-months / 36) if months else 0
    evidence = VERIFICATION_VALUES[verification]
    return _clamp(0.40 * duration + 0.22 * detail + 0.20 * evidence + 0.18 * responsibility)


def calculate_planet_score(
    profile: ProfileIntake,
    memories: Sequence[MemoryObject] = (),
    behavior_events: Sequence[BehaviorEvidence] = (),
    social_behavior_events: Sequence[BehaviorEvidence] = (),
    *,
    computed_at: datetime | None = None,
) -> PlanetScore:
    score_time = computed_at or datetime.now(timezone.utc)
    coverage = [
        bool(profile.birth_date or profile.birth_place),
        bool(profile.education),
        bool(profile.work),
        bool(profile.projects),
        bool(profile.skills),
        bool(profile.interests),
        bool(profile.achievements),
        bool(profile.bio.strip()),
    ]
    profile_completeness = sum(coverage) / len(coverage)

    education_values = [
        _clamp(0.72 * EDUCATION_VALUES[item.level] + 0.13 * float(item.completed) + 0.15 * VERIFICATION_VALUES[item.verification])
        for item in profile.education
    ]
    education_depth = max(education_values, default=0) * 0.80 + _saturating(education_values[1:], 0.15) * 0.20

    work_values = [
        _experience_value(
            _months(item.period),
            _clamp((bool(item.industry) + bool(item.place) + min(len(item.highlights), 3)) / 5),
            item.verification,
            SENIORITY_VALUES[item.seniority.value],
        )
        for item in profile.work
    ]
    project_values = [
        _experience_value(
            _months(item.period),
            _clamp((bool(item.domain) + bool(item.description) + min(item.collaborator_count, 3)) / 5),
            item.verification,
            0.58,
        )
        for item in profile.projects
    ]
    experience_depth = _saturating(sorted([*work_values, *project_values], reverse=True)[:12])

    breadth_values = [
        *(item.field_of_study for item in profile.education),
        *(item.industry for item in profile.work),
        *(item.domain for item in profile.projects),
        *(item.category for item in profile.skills),
        *(item.kind for item in profile.projects),
    ]
    experience_breadth = _normalized_entropy(breadth_values)

    unique_skills = {}
    for skill in profile.skills:
        key = skill.name.strip().lower()
        unique_skills[key] = max(unique_skills.get(key, 0), skill.proficiency / 5 * VERIFICATION_VALUES[skill.verification])
    achievement_values = [0.55 + 0.45 * VERIFICATION_VALUES[item.verification] for item in profile.achievements]
    skills_achievements = _clamp(0.58 * _saturating(unique_skills.values(), 0.20) + 0.42 * _saturating(achievement_values, 0.22))

    contribution_kinds = {"community", "volunteer", "open-source", "public-service", "公益", "志愿", "社区"}
    contribution_values = [
        _clamp(0.45 + min(item.collaborator_count, 10) / 20 + 0.2 * VERIFICATION_VALUES[item.verification])
        for item in profile.projects
        if item.kind.strip().lower() in contribution_kinds
    ]
    community_contribution = _saturating(contribution_values, 0.40)

    verifications = [
        *(item.verification for item in profile.residences),
        *(item.verification for item in profile.education),
        *(item.verification for item in profile.work),
        *(item.verification for item in profile.projects),
        *(item.verification for item in profile.skills),
        *(item.verification for item in profile.achievements),
    ]
    evidence_quality = sum(VERIFICATION_VALUES[item] for item in verifications) / len(verifications) if verifications else 0.35
    unique_memories = deduplicate_memories(memories)
    memory_richness = _memory_richness(unique_memories)
    self_behavior_momentum = _behavior_momentum(behavior_events, computed_at=score_time)
    social_response_momentum = _behavior_momentum(social_behavior_events, computed_at=score_time)

    values = {
        "profile_completeness": profile_completeness,
        "education_depth": education_depth,
        "experience_depth": experience_depth,
        "experience_breadth": experience_breadth,
        "skills_achievements": skills_achievements,
        "community_contribution": community_contribution,
        "evidence_quality": evidence_quality,
        "memory_richness": memory_richness,
        "self_behavior_momentum": self_behavior_momentum,
        "social_response_momentum": social_response_momentum,
    }
    raw = sum(MASS_WEIGHTS[name] * value for name, value in values.items())
    mass_score = round(100 * _clamp(raw), 4)
    physical_mass = round(10 + 90 * (mass_score / 100) ** 1.35, 4)
    visual_radius = round(0.75 + 1.35 * math.sqrt(mass_score / 100), 4)
    memory_coverage = 1 - math.exp(-len(unique_memories) / 5) if unique_memories else 0
    confidence = round(_clamp(0.20 + 0.42 * profile_completeness + 0.20 * evidence_quality + 0.18 * memory_coverage), 4)
    features = [
        ScoreFeature(
            name=name,
            value=round(value, 6),
            weight=weight,
            contribution=round(value * weight, 6),
            confidence=confidence,
        )
        for name, weight in MASS_WEIGHTS.items()
        for value in [values[name]]
    ]
    return PlanetScore(
        mass_score=mass_score,
        physical_mass=physical_mass,
        visual_radius=visual_radius,
        confidence=confidence,
        memory_count=len(unique_memories),
        behavior_event_count=len(behavior_events),
        social_behavior_event_count=len(social_behavior_events),
        features=features,
        computed_at=score_time,
    )


def aggregate_relationship_memory_signals(
    profile_affinity: float | None,
    memories: Sequence[MemoryObject],
    *,
    outgoing_behavior: Sequence[BehaviorEvidence] = (),
    incoming_behavior: Sequence[BehaviorEvidence] = (),
    profile_affinity_confidence: float = 0,
    relationship_started_at: date | None = None,
    computed_at: datetime | None = None,
) -> RelationshipSignals:
    """Convert objective profile, memory and behavior evidence into signals."""
    items = deduplicate_memories(memories)
    reference_time = computed_at or datetime.now(timezone.utc)
    reference_date = reference_time.date()
    semantic_evidence = aggregate_semantic_evidence(items, reference_date=reference_date)

    def recency(item: MemoryObject) -> float:
        age_days = max(0, (reference_date - item.event_time).days)
        return math.exp(-age_days / 365)

    weighted_items = [
        (item, max(0.05, item.confidence) * (0.35 + 0.65 * recency(item)))
        for item in items
    ]
    # Agent-produced relationship labels and 0-100 intimacy guesses remain
    # available for narrative UI, but are deliberately not scoring inputs.
    # Frequency is derived from the count, recency and confidence of concrete
    # stored events, so a user cannot pull a planet closer by declaring a value.
    evidence_volume = sum(weight for _, weight in weighted_items)
    memory_interaction = 1 - math.exp(-evidence_volume / 2.5) if items else None

    def behavior_momentum(events: Sequence[BehaviorEvidence]) -> float:
        daily_maxima: dict[tuple[str, str], tuple[float, datetime]] = {}
        for event in events:
            occurred_at = event.occurred_at
            if occurred_at.tzinfo is None:
                occurred_at = occurred_at.replace(tzinfo=timezone.utc)
            key = (event.event_type, occurred_at.date().isoformat())
            current = daily_maxima.get(key)
            if current is None or event.weight > current[0]:
                daily_maxima[key] = (_clamp(event.weight), occurred_at)
        total = 0.0
        for weight, occurred_at in daily_maxima.values():
            age_days = max(0.0, (reference_time - occurred_at).total_seconds() / 86400)
            total += weight * math.exp(-age_days / 180)
        return 1 - math.exp(-total / 2.5)

    outgoing_momentum = behavior_momentum(outgoing_behavior)
    incoming_momentum = behavior_momentum(incoming_behavior)
    behavior_events = [*outgoing_behavior, *incoming_behavior]
    behavior_interaction = 1 - math.exp(-(outgoing_momentum + incoming_momentum)) if behavior_events else None
    behavior_reciprocity = (
        min(outgoing_momentum, incoming_momentum) / max(outgoing_momentum, incoming_momentum)
        if outgoing_momentum and incoming_momentum
        else (0.0 if behavior_events else None)
    )
    interaction_values = [value for value in (memory_interaction, behavior_interaction) if value is not None]
    interaction_frequency = sum(interaction_values) / len(interaction_values) if interaction_values else None
    reciprocity = behavior_reciprocity
    shared_experience = 1 - math.exp(-sum(item.confidence for item in items) / 3.5) if items else None
    recencies = [recency(item) for item in items]
    recencies.extend(
        math.exp(-max(0.0, (reference_time - (
            event.occurred_at if event.occurred_at.tzinfo else event.occurred_at.replace(tzinfo=timezone.utc)
        )).total_seconds() / 86400) / 180)
        for event in behavior_events
    )
    recency_value = max(recencies) if recencies else None
    earliest = min((item.event_time for item in items), default=None)
    relationship_start = relationship_started_at or earliest
    duration = None
    if relationship_start:
        duration_days = max(0, (reference_date - relationship_start).days)
        duration = 1 - math.exp(-duration_days / (365 * 5))
    average_confidence = sum(item.confidence for item in items) / len(items) if items else 0.0
    memory_coverage = 1 - math.exp(-len(items) / 3) if items else 0.0
    memory_confidence = _clamp(average_confidence * memory_coverage)
    behavior_confidence = 1 - math.exp(-len(behavior_events) / 4) if behavior_events else 0.0

    return RelationshipSignals(
        profile_affinity=_clamp(profile_affinity) if profile_affinity is not None else None,
        interaction_frequency=_clamp(interaction_frequency) if interaction_frequency is not None else None,
        recency=_clamp(recency_value) if recency_value is not None else None,
        shared_experience=_clamp(shared_experience) if shared_experience is not None else None,
        duration=_clamp(duration) if duration is not None else None,
        reciprocity=_clamp(reciprocity) if reciprocity is not None else None,
        semantic_interaction=semantic_evidence.value,
        trust_emotion=None,
        confidences={
            "profile_affinity": _clamp(profile_affinity_confidence),
            "interaction_frequency": max(memory_confidence, behavior_confidence),
            "recency": max(memory_confidence, behavior_confidence),
            "shared_experience": memory_confidence,
            "duration": 0.75 if duration is not None else 0.0,
            "reciprocity": max(memory_confidence, behavior_confidence),
            "semantic_interaction": semantic_evidence.confidence,
            "trust_emotion": 0.0,
        },
    )


def calculate_relationship_score(
    relationship_type: str,
    signals: RelationshipSignals,
    *,
    memory_count: int = 0,
    behavior_event_count: int = 0,
    profile_features: Sequence[ScoreFeature] = (),
    computed_at: datetime | None = None,
) -> RelationshipScore:
    dynamic_weighted_value = 0.0
    dynamic_observed_weight = 0.0
    features: list[ScoreFeature] = []
    dynamic_values: list[tuple[str, float, float, float]] = []
    for name, weight in RELATIONSHIP_DYNAMIC_WEIGHTS.items():
        value = getattr(signals, name)
        if value is None:
            continue
        confidence = _clamp(signals.confidences.get(name, 0.70))
        effective_weight = weight * confidence
        dynamic_weighted_value += effective_weight * value
        dynamic_observed_weight += effective_weight
        dynamic_values.append((name, value, weight, confidence))

    dynamic_score = dynamic_weighted_value / dynamic_observed_weight if dynamic_observed_weight else None
    # The first few verified memories must create a visible spatial response;
    # the exponential still prevents content volume from growing without bound.
    # Counts supplied here are effective evidence buckets, not raw audit-row
    # volume. Application services cap behavior by direction/type/day and
    # deduplicate memories by substantive content before calling this function.
    dynamic_evidence = 1 - math.exp(-(memory_count / 2 + min(behavior_event_count, 40) / 5))
    profile_value = signals.profile_affinity
    if profile_value is None and dynamic_score is None:
        strength = 0.0
        profile_mix = 0.0
        dynamic_mix = 0.0
    else:
        profile_prior = float(profile_value or 0.0)
        # A profile match is only a discovery signal. Without shared evidence,
        # it cannot place a person in the inner social orbit.
        prior_strength = _clamp(0.04 + 0.35 * profile_prior)
        if dynamic_score is None:
            strength = prior_strength
            dynamic_mix = 0.0
        else:
            dynamic_mix = 0.86 * dynamic_evidence
            strength = (1 - dynamic_mix) * prior_strength + dynamic_mix * dynamic_score
        profile_mix = (1 - dynamic_mix) * 0.35 if profile_value is not None else 0.0

    if profile_value is not None:
        profile_confidence = _clamp(signals.confidences.get("profile_affinity", 0.0))
        features.append(ScoreFeature(
            name="profile_affinity",
            value=profile_value,
            weight=round(profile_mix, 6),
            confidence=profile_confidence,
            contribution=round(profile_mix * profile_value, 6),
        ))
    if dynamic_observed_weight:
        for name, value, weight, confidence in dynamic_values:
            normalized_weight = weight * confidence / dynamic_observed_weight
            final_weight = dynamic_mix * normalized_weight
            features.append(ScoreFeature(
                name=name,
                value=value,
                weight=round(final_weight, 6),
                confidence=confidence,
                contribution=round(final_weight * value, 6),
            ))

    profile_confidence = _clamp(signals.confidences.get("profile_affinity", 0.0)) if profile_value is not None else 0.0
    overall_confidence = _clamp(1 - (1 - profile_confidence) * (1 - dynamic_evidence))
    return RelationshipScore(
        relationship_type=relationship_type,
        strength=round(_clamp(strength), 6),
        confidence=round(overall_confidence, 6),
        profile_affinity=profile_value,
        dynamic_evidence=round(dynamic_evidence, 6),
        memory_count=memory_count,
        behavior_event_count=behavior_event_count,
        features=features,
        profile_features=list(profile_features),
        computed_at=computed_at or datetime.now(timezone.utc),
    )


def relationship_rest_length(strength: float, radius_a: float, radius_b: float) -> float:
    collision_floor = radius_a + radius_b + 0.35
    # The non-linear shell spacing gives weak/unproven relationships visibly
    # larger orbits while preserving a collision-safe inner circle.
    semantic_distance = 2.8 + (30.0 - 2.8) * (1 - _clamp(strength)) ** 1.75
    return round(max(collision_floor, semantic_distance), 6)
