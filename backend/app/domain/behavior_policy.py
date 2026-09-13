from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BehaviorRule:
    weight: float
    may_target_user: bool = False
    relationship_evidence: bool = False


BEHAVIOR_RULES: dict[str, BehaviorRule] = {
    "profile_enriched": BehaviorRule(0.65),
    # Creating or editing a label is useful account activity, but is not
    # objective evidence that two people are close.
    "relationship_created": BehaviorRule(0.40, may_target_user=True),
    "relationship_updated": BehaviorRule(0.18, may_target_user=True),
    "memory_recorded": BehaviorRule(0.50, may_target_user=True, relationship_evidence=True),
    "memory_revised": BehaviorRule(0.20, may_target_user=True, relationship_evidence=True),
    "planet_customized": BehaviorRule(0.15),
    "activity_published": BehaviorRule(0.42),
    "activity_mentioned": BehaviorRule(0.16, may_target_user=True, relationship_evidence=True),
    "activity_viewed": BehaviorRule(0.08, may_target_user=True, relationship_evidence=True),
    "planet_viewed": BehaviorRule(0.04, may_target_user=True, relationship_evidence=True),
    "planet_visited": BehaviorRule(0.14, may_target_user=True, relationship_evidence=True),
    "message_sent": BehaviorRule(0.06, may_target_user=True, relationship_evidence=True),
    "memory_signal_viewed": BehaviorRule(0.11, may_target_user=True, relationship_evidence=True),
}


def behavior_rule(event_type: str) -> BehaviorRule:
    try:
        return BEHAVIOR_RULES[event_type]
    except KeyError as error:
        raise ValueError(f"Unknown behavior event type: {event_type}") from error


def relationship_evidence_event_types() -> frozenset[str]:
    return frozenset(
        event_type
        for event_type, rule in BEHAVIOR_RULES.items()
        if rule.relationship_evidence
    )

