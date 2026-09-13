from __future__ import annotations

import hashlib
import os
import threading
import time
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    remaining: int
    retry_after: int


class RateLimiter(Protocol):
    def hit(self, key: str, *, limit: int, window_seconds: int) -> RateLimitDecision: ...


def protected_key(namespace: str, value: str) -> str:
    digest = hashlib.sha256(value.strip().casefold().encode("utf-8")).hexdigest()
    return f"social-cosmos:{namespace}:{digest}"


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._values: dict[str, tuple[int, float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, *, limit: int, window_seconds: int) -> RateLimitDecision:
        now = time.time()
        with self._lock:
            count, expires_at = self._values.get(key, (0, now + window_seconds))
            if expires_at <= now:
                count, expires_at = 0, now + window_seconds
            count += 1
            self._values[key] = (count, expires_at)
        retry_after = max(1, int(expires_at - now + 0.999))
        return RateLimitDecision(count <= limit, max(0, limit - count), retry_after)


class RedisRateLimiter:
    _SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
"""

    def __init__(self, url: str) -> None:
        from redis import Redis

        self.client = Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2, decode_responses=True)
        self.script = self.client.register_script(self._SCRIPT)

    def hit(self, key: str, *, limit: int, window_seconds: int) -> RateLimitDecision:
        count, ttl = self.script(keys=[key], args=[window_seconds])
        count, ttl = int(count), max(1, int(ttl))
        return RateLimitDecision(count <= limit, max(0, limit - count), ttl)


def rate_limiter_from_environment() -> RateLimiter:
    url = os.getenv("REDIS_URL", "").strip()
    if url:
        limiter = RedisRateLimiter(url)
        limiter.client.ping()
        return limiter
    if os.getenv("APP_ENV", "development").strip().lower() == "production":
        raise RuntimeError("Production requires REDIS_URL for distributed abuse protection.")
    return InMemoryRateLimiter()

