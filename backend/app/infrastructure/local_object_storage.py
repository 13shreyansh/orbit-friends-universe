from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.parse import quote

from app.ports.object_storage import StoredObject


class LocalObjectStorage:
    """Development object storage rooted under the configured upload volume."""

    def __init__(self, directory: str | Path, *, public_prefix: str = "/uploads/ingestion") -> None:
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.public_prefix = public_prefix.rstrip("/")

    def _resolve(self, key: str) -> Path:
        destination = (self.directory / key.lstrip("/")).resolve()
        if destination != self.directory and self.directory not in destination.parents:
            raise ValueError("object key escapes the storage root")
        return destination

    def put(self, *, key: str, content: bytes, content_type: str) -> StoredObject:
        destination = self._resolve(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        return StoredObject(
            key=key,
            size_bytes=len(content),
            content_type=content_type,
            content_hash=hashlib.sha256(content).hexdigest(),
        )

    def delete(self, *, key: str) -> None:
        destination = self._resolve(key)
        if destination.is_file():
            destination.unlink()

    def signed_url(self, *, key: str, expires_seconds: int = 900) -> str:
        if expires_seconds < 1:
            raise ValueError("expires_seconds must be positive")
        self._resolve(key)
        return f"{self.public_prefix}/{quote(key.lstrip('/'))}"
