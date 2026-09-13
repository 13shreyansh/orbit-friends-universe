from __future__ import annotations

from typing import Protocol


class JobQueue(Protocol):
    """Queue boundary for analysis work that may move out of process."""

    def enqueue(self, *, job_id: str, dedupe_key: str) -> None: ...
