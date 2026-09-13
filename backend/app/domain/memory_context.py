from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from app.schemas.memory import MemoryObject


@dataclass(frozen=True)
class StoredMemory:
    owner_user_id: str
    relationship_id: str | None
    memory: MemoryObject


def relevant_relationship_memories(
    records: Sequence[StoredMemory],
    *,
    owner_user_id: str,
    target_user_id: str,
    relationship_ids: set[str],
) -> list[MemoryObject]:
    """Select bilateral memories relevant to one directed relationship.

    A memory is relevant when it is explicitly attached to either direction
    of the relationship, or when a memory owned by one participant explicitly
    names the other participant. Contents remain inside the backend; only the
    derived score and distance are returned to the frontend.
    """
    selected: dict[str, MemoryObject] = {}
    for record in records:
        explicitly_linked = bool(record.relationship_id and record.relationship_id in relationship_ids)
        mentioned_ids = {person.id for person in record.memory.people}
        participant_mention = (
            record.owner_user_id == owner_user_id and target_user_id in mentioned_ids
        ) or (
            record.owner_user_id == target_user_id and owner_user_id in mentioned_ids
        )
        if explicitly_linked or participant_mention:
            selected[record.memory.id] = record.memory
    return list(selected.values())

