from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class StoredObject:
    key: str
    size_bytes: int
    content_type: str
    content_hash: str


class ObjectStorage(Protocol):
    """Private object storage used by ingestion media."""

    def put(self, *, key: str, content: bytes, content_type: str) -> StoredObject: ...

    def delete(self, *, key: str) -> None: ...

    def signed_url(self, *, key: str, expires_seconds: int = 900) -> str: ...
