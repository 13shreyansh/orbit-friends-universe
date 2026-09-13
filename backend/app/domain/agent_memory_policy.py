from __future__ import annotations


AGENT_MEMORY_DESTINATION = "agent_memory"


def agent_memory_event(*, deleted: bool) -> str:
    return "memory.deleted" if deleted else "memory.upserted"


def agent_memory_dedupe_key(*, memory_id: str, version: int, deleted: bool) -> str:
    action = "delete" if deleted else "upsert"
    return f"memory:{memory_id}:v{version}:{action}"
