from __future__ import annotations

import logging
import os
import re
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI
from starlette.responses import JSONResponse
from anyio import to_thread

from app.infrastructure.rate_limit import RateLimiter, protected_key


REQUEST_ID_HEADER = "X-Request-ID"
SERVER_TIME_HEADER = "X-Server-Time"
DISPLAY_TIME_ZONE_HEADER = "X-Display-Time-Zone"
DISPLAY_TIME_ZONE = "Asia/Shanghai"
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
request_id_context: ContextVar[str] = ContextVar("request_id", default="")
logger = logging.getLogger("social_cosmos.request")


class RequestContextMiddleware:
    """Pure ASGI middleware so streaming and yield dependencies stay safe."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        supplied = headers.get(REQUEST_ID_HEADER.lower().encode("ascii"), b"").decode(
            "ascii", errors="ignore"
        )
        request_id = supplied if _SAFE_REQUEST_ID.fullmatch(supplied) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        started_at = time.perf_counter()
        status_code = 500

        async def send_with_request_id(message: dict) -> None:
            nonlocal status_code
            if message.get("type") == "http.response.start":
                status_code = int(message.get("status", 500))
                response_headers = message.setdefault("headers", [])
                response_headers.append(
                    (REQUEST_ID_HEADER.lower().encode("ascii"), request_id.encode("ascii"))
                )
                response_headers.append((
                    SERVER_TIME_HEADER.lower().encode("ascii"),
                    datetime.now(timezone.utc).isoformat().replace("+00:00", "Z").encode("ascii"),
                ))
                response_headers.append((
                    DISPLAY_TIME_ZONE_HEADER.lower().encode("ascii"),
                    DISPLAY_TIME_ZONE.encode("ascii"),
                ))
            await send(message)

        token = request_id_context.set(request_id)
        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            state = scope.get("state", {})
            logger.info(
                "http_request_completed",
                extra={
                    "request_id": request_id,
                    "job_id": state.get("job_id", ""),
                    "method": scope.get("method", ""),
                    "path": scope.get("path", ""),
                    "status_code": status_code,
                    "duration_ms": round((time.perf_counter() - started_at) * 1000, 2),
                },
            )
            request_id_context.reset(token)


def install_request_context(application: FastAPI) -> None:
    application.add_middleware(RequestContextMiddleware)


def client_ip(scope: dict) -> str:
    headers = {key.lower(): value for key, value in scope.get("headers", [])}
    trust_proxy = os.getenv("SOCIAL_COSMOS_TRUST_PROXY_HEADERS", "false").strip().lower() == "true"
    forwarded = headers.get(b"x-forwarded-for", b"").decode("ascii", errors="ignore")
    if trust_proxy and forwarded:
        return forwarded.split(",", 1)[0].strip()
    client = scope.get("client") or ("unknown", 0)
    return str(client[0])


class AbuseProtectionMiddleware:
    """Distributed write throttling shared by every API worker."""

    WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
    HEAVY_PATH_MARKERS = (
        "/analyze",
        "/api/ai/",
        "/api/activities",
        "/messages",
    )

    def __init__(self, app: Any, limiter: RateLimiter) -> None:
        self.app = app
        self.limiter = limiter

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        path = str(scope.get("path", ""))
        method = str(scope.get("method", "GET")).upper()
        if scope.get("type") != "http" or method not in self.WRITE_METHODS or not path.startswith("/api/"):
            await self.app(scope, receive, send)
            return
        # Auth endpoints have tighter IP+email policies inside their route.
        if path.startswith("/api/auth/") or path.startswith("/api/v1/auth/"):
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        authorization = headers.get(b"authorization", b"").decode("ascii", errors="ignore")
        principal = authorization[7:] if authorization.startswith("Bearer ") else client_ip(scope)
        heavy = any(marker in path for marker in self.HEAVY_PATH_MARKERS)
        limit, window = (20, 60) if heavy else (120, 60)
        key = protected_key("heavy-write" if heavy else "write", principal)
        try:
            global_decision = await to_thread.run_sync(
                lambda: self.limiter.hit(
                    "social-cosmos:global:heavy-write" if heavy else "social-cosmos:global:write",
                    limit=200 if heavy else 2000,
                    window_seconds=window,
                )
            )
            decision = global_decision if not global_decision.allowed else await to_thread.run_sync(
                lambda: self.limiter.hit(key, limit=limit, window_seconds=window)
            )
        except Exception:
            response = JSONResponse(
                status_code=503,
                content={"detail": "Abuse protection is temporarily unavailable."},
                headers={"Retry-After": "5"},
            )
            await response(scope, receive, send)
            return
        if not decision.allowed:
            response = JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again later."},
                headers={"Retry-After": str(decision.retry_after)},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def install_abuse_protection(application: FastAPI, limiter: RateLimiter) -> None:
    application.add_middleware(AbuseProtectionMiddleware, limiter=limiter)
