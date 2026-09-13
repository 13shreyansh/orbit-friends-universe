from __future__ import annotations


JOB_TRANSITIONS: dict[str, frozenset[str]] = {
    "created": frozenset({"uploading", "queued", "cancelled"}),
    "uploading": frozenset({"queued", "failed", "cancelled"}),
    "queued": frozenset({"processing", "cancelled"}),
    "processing": frozenset({"awaiting_confirmation", "failed", "cancelled"}),
    "awaiting_confirmation": frozenset({"confirmed", "expired", "cancelled"}),
    "failed": frozenset({"queued", "cancelled"}),
    "confirmed": frozenset(),
    "cancelled": frozenset(),
    "expired": frozenset(),
}

DRAFT_TRANSITIONS: dict[str, frozenset[str]] = {
    "awaiting_confirmation": frozenset({"confirmed", "rejected", "expired"}),
    "confirmed": frozenset(),
    "rejected": frozenset(),
    "expired": frozenset(),
}


class InvalidStateTransition(ValueError):
    pass


def validate_job_transition(current: str, target: str) -> None:
    allowed = JOB_TRANSITIONS.get(current)
    if allowed is None or target not in allowed:
        raise InvalidStateTransition(f"analysis job cannot transition from {current} to {target}")


def validate_draft_transition(current: str, target: str) -> None:
    allowed = DRAFT_TRANSITIONS.get(current)
    if allowed is None or target not in allowed:
        raise InvalidStateTransition(f"memory draft cannot transition from {current} to {target}")
