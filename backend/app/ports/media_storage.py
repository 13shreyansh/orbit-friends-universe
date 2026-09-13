from __future__ import annotations

from typing import Protocol


class MediaStorage(Protocol):
    def save(self, *, object_name: str, content: bytes) -> str:
        """Persist bytes and return a client-facing URL."""
        ...

