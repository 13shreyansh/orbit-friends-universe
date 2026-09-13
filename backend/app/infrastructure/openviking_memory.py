from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import quote

import httpx

from app.ports.agent_memory import (
    AgentConversationSessionContext,
    AgentMemoryCommit,
    AgentMemoryRecall,
    AgentMemorySession,
    AgentMemoryStore,
)


LOCAL_ROOT_KEY_DOMAIN = b"social-cosmos-openviking-root\0"


class OpenVikingAdapterError(RuntimeError):
    def __init__(self, message: str, *, code: str = "UNKNOWN", status_code: int = 0) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def _is_not_found(*, status_code: int, code: str, message: str) -> bool:
    return (
        status_code == 404
        or code.upper() in {"NOT_FOUND", "FILE_NOT_FOUND"}
        or "not found" in message.lower()
    )


class OpenVikingMemoryStore:
    """HTTP adapter for the OpenViking v1 session and retrieval APIs."""

    provider_name = "openviking"

    def __init__(
        self,
        base_url: str,
        *,
        api_key: str = "",
        account: str = "social-cosmos",
        timeout: float = 30.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not base_url.strip():
            raise ValueError("OpenViking base URL is required")
        if timeout <= 0:
            raise ValueError("OpenViking timeout must be positive")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.account = account
        self.timeout = timeout
        self._client = client
        self._owns_client = client is None

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout)
        return self._client

    def _headers(self, user_id: str = "") -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        if self.account:
            headers["X-OpenViking-Account"] = self.account
        if user_id:
            headers["X-OpenViking-User"] = user_id
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        user_id: str = "",
        allow_not_found: bool = False,
        **kwargs: Any,
    ) -> Any:
        client = await self._http()
        response = await client.request(method, path, headers=self._headers(user_id), **kwargs)
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        error_payload = payload.get("error", {}) if isinstance(payload, dict) else {}
        if isinstance(error_payload, Mapping):
            error_message = str(error_payload.get("message") or response.text or f"OpenViking returned HTTP {response.status_code}")
            error_code = str(error_payload.get("code") or "HTTP_ERROR")
        else:
            error_message = str(error_payload or response.text or f"OpenViking returned HTTP {response.status_code}")
            error_code = "HTTP_ERROR"
        if allow_not_found and _is_not_found(
            status_code=response.status_code,
            code=error_code,
            message=error_message,
        ):
            return None
        if response.is_error or (isinstance(payload, dict) and payload.get("status") == "error"):
            raise OpenVikingAdapterError(
                error_message,
                code=error_code,
                status_code=response.status_code,
            )
        if isinstance(payload, dict) and "result" in payload:
            return payload["result"]
        return payload

    def _external_session_id(self, user_id: str, session_key: str) -> str:
        identity = f"{self.account}:{user_id}:{session_key}".encode("utf-8")
        return f"sc-{hashlib.sha256(identity).hexdigest()[:32]}"

    @staticmethod
    def _session(payload: Mapping[str, Any], *, user_id: str) -> AgentMemorySession:
        return AgentMemorySession(
            provider="openviking",
            external_session_id=str(payload["session_id"]),
            user_id=user_id,
            message_count=int(payload.get("message_count", 0)),
            commit_count=int(payload.get("commit_count", 0)),
        )

    @staticmethod
    def _commit(payload: Mapping[str, Any]) -> AgentMemoryCommit:
        return AgentMemoryCommit(
            task_id=str(payload.get("task_id") or ""),
            status=str(payload.get("status") or "unknown"),
        )

    async def get_or_create_session(self, *, user_id: str, session_key: str) -> AgentMemorySession:
        external_id = self._external_session_id(user_id, session_key)
        encoded = quote(external_id, safe="")
        existing = await self._request(
            "GET",
            f"/api/v1/sessions/{encoded}",
            user_id=user_id,
            allow_not_found=True,
        )
        if existing is None:
            try:
                await self._request(
                    "POST",
                    "/api/v1/sessions",
                    user_id=user_id,
                    json={"session_id": external_id},
                )
            except OpenVikingAdapterError as error:
                if error.status_code != 409 and error.code != "ALREADY_EXISTS":
                    raise
            existing = await self._request(
                "GET",
                f"/api/v1/sessions/{encoded}",
                user_id=user_id,
            )
        return self._session(existing, user_id=user_id)

    async def append(
        self,
        *,
        session: AgentMemorySession,
        role: str,
        content: Mapping[str, Any],
        dedupe_key: str,
    ) -> None:
        if role not in {"user", "assistant"}:
            raise ValueError("OpenViking message role must be user or assistant")
        if session.message_count > 0 or session.commit_count > 0:
            return
        body = json.dumps(
            {"dedupeKey": dedupe_key, "content": dict(content)},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        encoded = quote(session.external_session_id, safe="")
        await self._request(
            "POST",
            f"/api/v1/sessions/{encoded}/messages",
            user_id=session.user_id,
            json={"role": role, "content": body},
        )

    async def commit(self, *, session: AgentMemorySession) -> AgentMemoryCommit:
        encoded = quote(session.external_session_id, safe="")
        payload = await self._request(
            "POST",
            f"/api/v1/sessions/{encoded}/commit",
            user_id=session.user_id,
            json={"keep_recent_count": 0, "telemetry": False},
        )
        return self._commit(payload)

    async def append_conversation_message(
        self,
        *,
        session: AgentMemorySession,
        role: str,
        content: str,
    ) -> None:
        if role not in {"user", "assistant"}:
            raise ValueError("OpenViking conversation role must be user or assistant")
        if not content.strip():
            raise ValueError("OpenViking conversation content cannot be empty")
        encoded = quote(session.external_session_id, safe="")
        await self._request(
            "POST",
            f"/api/v1/sessions/{encoded}/messages",
            user_id=session.user_id,
            json={"role": role, "content": content},
        )

    async def commit_conversation_session(
        self,
        *,
        session: AgentMemorySession,
        keep_recent_count: int,
    ) -> AgentMemoryCommit:
        if keep_recent_count < 0:
            raise ValueError("OpenViking keep_recent_count cannot be negative")
        encoded = quote(session.external_session_id, safe="")
        payload = await self._request(
            "POST",
            f"/api/v1/sessions/{encoded}/commit",
            user_id=session.user_id,
            json={"keep_recent_count": keep_recent_count, "telemetry": False},
        )
        return self._commit(payload)

    async def get_conversation_session_context(
        self,
        *,
        session: AgentMemorySession,
        token_budget: int,
    ) -> AgentConversationSessionContext:
        if token_budget < 0:
            raise ValueError("OpenViking session token budget cannot be negative")
        encoded = quote(session.external_session_id, safe="")
        payload = await self._request(
            "GET",
            f"/api/v1/sessions/{encoded}/context",
            user_id=session.user_id,
            params={"token_budget": token_budget},
        )
        if not isinstance(payload, Mapping):
            raise OpenVikingAdapterError("OpenViking session context must be an object")
        messages = payload.get("messages", [])
        stats = payload.get("stats", {})
        if not isinstance(messages, list) or not all(isinstance(item, Mapping) for item in messages):
            raise OpenVikingAdapterError("OpenViking session context messages must be a list")
        if not isinstance(stats, Mapping):
            raise OpenVikingAdapterError("OpenViking session context stats must be an object")
        return AgentConversationSessionContext(
            latest_archive_overview=str(payload.get("latest_archive_overview") or ""),
            messages=tuple(dict(item) for item in messages),
            estimated_tokens=int(payload.get("estimatedTokens") or payload.get("estimated_tokens") or 0),
            stats=dict(stats),
        )

    async def get_task(self, *, task_id: str, user_id: str = "") -> AgentMemoryCommit:
        payload = await self._request(
            "GET",
            f"/api/v1/tasks/{quote(task_id, safe='')}",
            user_id=user_id,
        )
        return self._commit(payload)

    async def latest_task(self, *, session: AgentMemorySession) -> AgentMemoryCommit | None:
        payload = await self._request(
            "GET",
            "/api/v1/tasks",
            user_id=session.user_id,
            params={"task_type": "session_commit", "resource_id": session.external_session_id, "limit": 1},
        )
        if not isinstance(payload, list) or not payload:
            return None
        return self._commit(payload[0])

    async def recall(self, *, user_id: str, query: str, top_k: int = 5) -> Sequence[AgentMemoryRecall]:
        if top_k < 1:
            return []
        payload = await self._request(
            "POST",
            "/api/v1/search/find",
            user_id=user_id,
            json={
                "query": query,
                "target_uri": f"viking://user/{user_id}/memories",
                "limit": top_k,
                "context_type": ["memory"],
                # Memory analysis consumes OpenViking's compressed context,
                # never L2 source documents. Full evidence remains available
                # in Social Cosmos for audit and deterministic scoring.
                "level": "0,1",
            },
        )
        memories = payload.get("memories", []) if isinstance(payload, dict) else []
        return [
            AgentMemoryRecall(
                object_key=str(item.get("uri") or item.get("id") or ""),
                score=float(item.get("score", 0.0)),
                content=dict(item),
            )
            for item in memories[:top_k]
            if isinstance(item, dict)
        ]

    @staticmethod
    def _owned_memory_uri(user_id: str, uri: str) -> str:
        prefix = f"viking://user/{user_id}/memories/"
        if not uri.startswith(prefix):
            raise OpenVikingAdapterError(f"Refusing to mutate memory outside the user scope: {uri}")
        return uri

    async def _memory_content(self, *, user_id: str, uri: str) -> Any:
        return await self._request(
            "GET",
            "/api/v1/content/read",
            user_id=user_id,
            allow_not_found=True,
            params={"uri": uri, "offset": 0, "limit": 1},
        )

    async def _restore_memory_content(self, *, user_id: str, uri: str, content: str) -> None:
        current = await self._memory_content(user_id=user_id, uri=uri)
        await self._request(
            "POST",
            "/api/v1/content/write",
            user_id=user_id,
            json={
                "uri": uri,
                "content": content,
                "mode": "replace" if current is not None else "create",
                "wait": False,
            },
        )

    async def _reverse_memory_diff(self, *, user_id: str, session_id: str) -> None:
        tasks = await self._request(
            "GET",
            "/api/v1/tasks",
            user_id=user_id,
            params={"task_type": "session_commit", "resource_id": session_id, "limit": 1},
        )
        if not isinstance(tasks, list) or not tasks:
            return
        task_id = str(tasks[0].get("task_id") or "")
        if not task_id:
            return
        task = await self._request(
            "GET",
            f"/api/v1/tasks/{quote(task_id, safe='')}",
            user_id=user_id,
        )
        result = task.get("result", {}) if isinstance(task, dict) else {}
        diff_uri = str(result.get("memory_diff_uri") or "") if isinstance(result, dict) else ""
        if not diff_uri:
            return
        raw_diff = await self._request(
            "GET",
            "/api/v1/content/read",
            user_id=user_id,
            allow_not_found=True,
            params={"uri": diff_uri, "offset": 0, "limit": -1},
        )
        if raw_diff is None:
            return
        diff = json.loads(raw_diff) if isinstance(raw_diff, str) else raw_diff
        operations = diff.get("operations", {}) if isinstance(diff, dict) else {}
        changed = False

        for item in reversed(operations.get("deletes", [])):
            uri = self._owned_memory_uri(user_id, str(item.get("uri") or ""))
            await self._restore_memory_content(
                user_id=user_id,
                uri=uri,
                content=str(item.get("deleted_content") or ""),
            )
            changed = True

        for item in reversed(operations.get("updates", [])):
            uri = self._owned_memory_uri(user_id, str(item.get("uri") or ""))
            await self._restore_memory_content(
                user_id=user_id,
                uri=uri,
                content=str(item.get("before") or ""),
            )
            changed = True

        for item in reversed(operations.get("adds", [])):
            uri = self._owned_memory_uri(user_id, str(item.get("uri") or ""))
            if await self._memory_content(user_id=user_id, uri=uri) is not None:
                await self._request(
                    "DELETE",
                    "/api/v1/fs",
                    user_id=user_id,
                    allow_not_found=True,
                    params={"uri": uri, "recursive": False, "wait": False},
                )
                changed = True

        if changed:
            await self._request(
                "POST",
                "/api/v1/system/wait",
                user_id=user_id,
                json={"timeout": 180},
                timeout=190.0,
            )

    async def delete(self, *, user_id: str, object_key: str) -> None:
        await self._reverse_memory_diff(user_id=user_id, session_id=object_key)
        await self._request(
            "DELETE",
            f"/api/v1/sessions/{quote(object_key, safe='')}",
            user_id=user_id,
            allow_not_found=True,
        )

    async def health(self) -> Mapping[str, Any]:
        payload = await self._request("GET", "/health")
        healthy = bool(payload.get("healthy", payload.get("status") == "ok")) if isinstance(payload, dict) else False
        return {"backend": self.provider_name, "status": "ok" if healthy else "degraded", "details": payload}

    async def close(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
        self._client = None


def openviking_memory_from_environment() -> AgentMemoryStore:
    url = os.getenv("OPENVIKING_URL", "").strip()
    if not url:
        raise RuntimeError("OPENVIKING_URL is required for the Agent Memory worker")
    api_key = os.getenv("OPENVIKING_API_KEY", "").strip()
    if not api_key and url.rstrip("/") in {
        "http://openviking:1933",
        "http://127.0.0.1:1933",
        "http://localhost:1933",
    }:
        model_key = os.getenv("OPENVIKING_AI_API_KEY", "").strip()
        if model_key:
            digest = hashlib.sha256(LOCAL_ROOT_KEY_DOMAIN + model_key.encode("utf-8")).hexdigest()
            api_key = f"ov-local-{digest}"
    if not api_key:
        raise RuntimeError("OPENVIKING_API_KEY is required for non-local OpenViking services")
    return OpenVikingMemoryStore(
        url,
        api_key=api_key,
        account=os.getenv("OPENVIKING_ACCOUNT", "social-cosmos"),
        timeout=float(os.getenv("OPENVIKING_TIMEOUT_SECONDS", "30")),
    )
