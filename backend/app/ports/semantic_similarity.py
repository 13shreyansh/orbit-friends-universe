from __future__ import annotations

from typing import Protocol, Sequence


class SemanticSimilarity(Protocol):
    """Replaceable semantic encoder used by objective profile affinity.

    A future teammate Agent or embedding service can implement this port. The
    scoring domain only consumes stable 0..1 similarities and never depends on
    a particular model vendor.
    """

    def compare(self, left: Sequence[str], right: Sequence[str], *, dimension: str) -> float | None:
        """Return a symmetric 0..1 similarity, or None when either side has no evidence."""

