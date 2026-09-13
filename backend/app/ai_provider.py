from __future__ import annotations

import hashlib
import json
import os
from copy import deepcopy
from typing import Any

import httpx

def _seed(text: str) -> int:
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:12], 16)


async def _remote_json(task: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    api_key = os.getenv("OPENVIKING_AI_API_KEY", "").strip() or os.getenv("AI_API_KEY", "").strip()
    if not api_key:
        return None
    base_url = (
        os.getenv("OPENVIKING_AI_BASE_URL", "").strip()
        or os.getenv("AI_BASE_URL", "https://api.openai.com/v1").strip()
    ).rstrip("/")
    model = os.getenv("OPENVIKING_AI_MODEL", "").strip() or os.getenv("AI_MODEL", "gpt-4.1-mini").strip()
    instruction = "Return only JSON with visual and rationale. Preserve every PlanetVisualConfig field and only change safe parameters."
    async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=5)) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            headers={"authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": f"You are the Social Cosmos structured analysis service. {instruction}"},
                    {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                ],
            },
        )
        response.raise_for_status()
        content = response.json().get("choices", [{}])[0].get("message", {}).get("content", "{}")
        result = json.loads(content)
        result["provider"] = model
        return result


async def customize_planet(request: dict[str, Any]) -> dict[str, Any]:
    prompt = str(request.get("prompt", "")).strip()
    current = request.get("current")
    if not prompt or not isinstance(current, dict):
        raise ValueError("prompt and current planet configuration are required")
    visual = deepcopy(current)
    lower = prompt.lower()
    if "ocean" in lower or "海洋" in prompt:
        visual.update({"archetype": "oceanic", "oceanLevel": 0.76, "cloudDensity": 0.62})
        visual["palette"] = {"deep": "#101947", "surface": "#3f5aa0", "highlight": "#efaa83", "atmosphere": "#8ec8f1"}
    if "ring" in lower or "星环" in prompt:
        visual["ring"] = True
    if "warm" in lower or "温暖" in prompt:
        visual.setdefault("palette", {})["highlight"] = "#ffb071"
        visual["palette"]["atmosphere"] = "#e69bc5"
    if "wild" in lower or "粗犷" in prompt:
        visual["terrain"] = 0.86
    if "calm" in lower or "平静" in prompt:
        visual["terrain"] = 0.28
    visual["seed"] = _seed(f"{prompt}|{json.dumps(current, sort_keys=True)}") % 100000
    fallback = {"visual": visual, "rationale": "The server translated the description into safe, serializable visual parameters.", "provider": "local"}
    try:
        remote = await _remote_json("planet", {"request": request, "fallback": fallback})
        if not remote:
            return fallback
        if not isinstance(remote.get("visual"), dict):
            return fallback
        # Remote output cannot introduce executable renderer extensions.
        safe = {key: value for key, value in remote["visual"].items() if key not in {"customShaderId", "externalAssetUrl"}}
        return {"visual": {**current, **safe}, "rationale": str(remote.get("rationale", "")), "provider": remote.get("provider", "remote")}
    except (httpx.HTTPError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        return fallback
