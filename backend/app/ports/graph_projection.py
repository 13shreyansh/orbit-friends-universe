from __future__ import annotations

from typing import Any, Protocol

from app.schemas.graph import ProfileGraphDocument


class GraphProjectionRepository(Protocol):
    """Projection boundary for replaceable graph backends."""

    backend_name: str

    def project(self, graph: ProfileGraphDocument) -> None: ...

    def delete_owner(self, owner_user_id: str) -> None: ...

    def close(self) -> None: ...

    def health(self) -> dict[str, Any]: ...
