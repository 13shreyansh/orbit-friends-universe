from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Literal


PlanetArchetype = Literal["terran", "oceanic", "volcanic", "crystalline", "verdant"]
GenerationMode = Literal["system", "personality", "guide", "legacy"]


@dataclass(frozen=True)
class PlanetGenerationRequest:
    mode: GenerationMode = "system"
    seed: int = 4281
    archetype: PlanetArchetype = "terran"
    radius: float = 1
    ring: bool | None = None
    satellites: int | None = None


class PlanetGenerator:
    """Single backend entry point for system-generated planet visuals.

    Authored visual payloads never pass through this generator, so a user's
    explicit customization is preserved exactly.
    """

    version = "planet-generator.v1"
    archetypes: tuple[PlanetArchetype, ...] = (
        "terran", "oceanic", "volcanic", "crystalline", "verdant",
    )
    palettes: dict[PlanetArchetype, dict[str, str]] = {
        "terran": {"deep": "#171b4a", "surface": "#6f5a9f", "highlight": "#f1a46f", "atmosphere": "#e6a1c7"},
        "oceanic": {"deep": "#101947", "surface": "#3f5aa0", "highlight": "#efaa83", "atmosphere": "#8ec8f1"},
        "volcanic": {"deep": "#26163e", "surface": "#74415e", "highlight": "#ff9b5f", "atmosphere": "#ed7c87"},
        "crystalline": {"deep": "#17153d", "surface": "#66549a", "highlight": "#f3b7ce", "atmosphere": "#bd9bea"},
        "verdant": {"deep": "#152044", "surface": "#496f78", "highlight": "#f4b77d", "atmosphere": "#98c8ca"},
    }

    def generate(self, request: PlanetGenerationRequest) -> dict[str, Any]:
        palette = self.palettes[request.archetype]
        return {
            "version": 1,
            "generatorVersion": self.version,
            "generationMode": request.mode,
            "archetype": request.archetype,
            "seed": request.seed,
            "radius": request.radius,
            "terrain": 0.52,
            "roughness": 0.68,
            "oceanLevel": 0.72 if request.archetype == "oceanic" else 0.38,
            "cloudDensity": 0.62 if request.archetype == "oceanic" else 0.44,
            "atmosphereStrength": 0.72,
            "ring": request.ring if request.ring is not None else request.archetype == "crystalline",
            "ringColor": palette["highlight"],
            "satellites": request.satellites if request.satellites is not None else 1 + request.seed % 3,
            "palette": palette,
            "backgroundSkinId": "deep-space",
        }

    def generate_for_owner(self, owner_key: str, *, mode: GenerationMode = "system") -> dict[str, Any]:
        digest = hashlib.sha256(owner_key.encode("utf-8")).digest()
        seed = int.from_bytes(digest[:4], "big") % 900_000 + 10_000
        archetype = self.archetypes[digest[4] % len(self.archetypes)]
        return self.generate(PlanetGenerationRequest(mode=mode, seed=seed, archetype=archetype))


planet_generator = PlanetGenerator()
