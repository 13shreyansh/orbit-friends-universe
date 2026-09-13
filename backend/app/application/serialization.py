from __future__ import annotations

import hashlib
import json
import secrets
from typing import Any


def dumps(value: Any) -> str:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json", by_alias=True)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(12)}"


def content_dedupe_key(prefix: str, value: Any) -> str:
    encoded = dumps(value).encode("utf-8")
    return f"{prefix}:{hashlib.sha256(encoded).hexdigest()[:24]}"

