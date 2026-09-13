from __future__ import annotations

from typing import Literal

from .base import ApiModel


class PlanetInteractionRequest(ApiModel):
    kind: Literal["view", "visit"]

