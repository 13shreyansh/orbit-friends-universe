from __future__ import annotations

from pathlib import Path


class LocalMediaStorage:
    def __init__(self, directory: str | Path, *, public_prefix: str = "/uploads") -> None:
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.public_prefix = public_prefix.rstrip("/")

    def save(self, *, object_name: str, content: bytes) -> str:
        destination = self.directory / Path(object_name).name
        destination.write_bytes(content)
        return f"{self.public_prefix}/{destination.name}"

