"""Compatibility imports for the backend-embedded memory Agent.

New code should import from :mod:`app.agents.memory`.
"""

from app.agents.memory import (
    EmbeddedMemoryAgent,
    LocalMemoryAgent,
    MemoryAgentContext,
)


MemoryAnalysisProvider = EmbeddedMemoryAgent
LocalMemoryAnalysisProvider = LocalMemoryAgent

__all__ = [
    "EmbeddedMemoryAgent",
    "LocalMemoryAgent",
    "MemoryAgentContext",
    "MemoryAnalysisProvider",
    "LocalMemoryAnalysisProvider",
]
