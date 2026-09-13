from __future__ import annotations

import base64
import json
from typing import Any

from .errors import InvalidRequestError


def encode_cursor(*values: Any) -> str:
    payload = json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_cursor(cursor: str | None, *, size: int) -> list[Any] | None:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        values = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise InvalidRequestError("Invalid pagination cursor.") from error
    if not isinstance(values, list) or len(values) != size:
        raise InvalidRequestError("Invalid pagination cursor.")
    return values
