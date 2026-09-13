from __future__ import annotations

import math
import os
import re
import threading
import time
from collections.abc import Sequence
from typing import Protocol

import httpx


class EmbeddingClient(Protocol):
    """Contract shared with the teammate Agent embedding module."""

    def embed_query(self, text: str) -> list[float]: ...


_DOMAIN_TERMS: dict[str, set[str]] = {
    "mathematical-sciences": {
        "math", "mathematics", "statistics", "physics", "applied mathematics",
        "数学", "应用数学", "统计", "统计学", "物理", "物理学", "天文", "天文学",
    },
    "computing": {
        "computer", "computer science", "software", "software engineering", "programming",
        "data science", "artificial intelligence", "machine learning", "计算机", "计算机科学",
        "软件", "软件工程", "编程", "数据科学", "人工智能", "机器学习",
    },
    "engineering": {
        "engineering", "electrical engineering", "mechanical engineering", "civil engineering",
        "electronics", "工程", "电子工程", "机械工程", "土木工程", "自动化",
    },
    "arts-media": {
        "art", "arts", "film", "cinema", "television", "literature", "writing", "media",
        "photography", "music", "design", "艺术", "影视", "电影", "电视", "文学", "写作",
        "媒体", "摄影", "音乐", "设计",
    },
    "life-sciences": {
        "biology", "medicine", "ecology", "environment", "biotechnology", "生物", "生物学",
        "医学", "生态", "生态学", "环境", "生物技术",
    },
    "business": {
        "business", "management", "finance", "economics", "marketing", "commerce", "商业",
        "管理", "金融", "经济", "经济学", "市场营销", "贸易",
    },
    "humanities-social": {
        "history", "philosophy", "sociology", "psychology", "education", "law", "language",
        "历史", "哲学", "社会学", "心理学", "教育", "法学", "语言",
    },
    "community-service": {
        "community", "volunteer", "public service", "social impact", "公益", "志愿", "社区",
        "公共服务", "社会创新",
    },
}

_RELATED_DOMAINS: dict[frozenset[str], float] = {
    frozenset({"mathematical-sciences", "computing"}): 0.68,
    frozenset({"mathematical-sciences", "engineering"}): 0.72,
    frozenset({"computing", "engineering"}): 0.76,
    frozenset({"arts-media", "humanities-social"}): 0.62,
    frozenset({"life-sciences", "mathematical-sciences"}): 0.46,
    frozenset({"business", "humanities-social"}): 0.42,
    frozenset({"community-service", "humanities-social"}): 0.58,
}


def _canonical(value: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", value.strip().lower()).strip()


def _tokens(value: str) -> set[str]:
    normalized = _canonical(value)
    latin = set(normalized.split())
    chinese = {char for char in normalized if "\u4e00" <= char <= "\u9fff"}
    return latin | chinese


def _domains(value: str) -> set[str]:
    normalized = _canonical(value)
    return {
        domain
        for domain, terms in _DOMAIN_TERMS.items()
        if any(_canonical(term) in normalized or normalized in _canonical(term) for term in terms if normalized)
    }


def _pair_similarity(left: str, right: str) -> float:
    a = _canonical(left)
    b = _canonical(right)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    left_domains = _domains(a)
    right_domains = _domains(b)
    if left_domains & right_domains:
        domain_score = 0.86
    else:
        domain_score = max(
            (_RELATED_DOMAINS.get(frozenset({x, y}), 0.0) for x in left_domains for y in right_domains),
            default=0.0,
        )
    left_tokens = _tokens(a)
    right_tokens = _tokens(b)
    union = left_tokens | right_tokens
    lexical = len(left_tokens & right_tokens) / len(union) if union else 0.0
    return min(1.0, max(domain_score, lexical))


class LocalSemanticSimilarity:
    """Deterministic fallback until an embedding/Agent adapter is configured.

    It is intentionally small and explainable. It already handles common
    Chinese/English study and interest domains; replacing it does not change
    the relationship scoring contract.
    """

    def compare(self, left: Sequence[str], right: Sequence[str], *, dimension: str) -> float | None:
        del dimension
        left_values = [item for item in left if item and item.strip()]
        right_values = [item for item in right if item and item.strip()]
        if not left_values or not right_values:
            return None

        def directional(source: Sequence[str], targets: Sequence[str]) -> float:
            return sum(max(_pair_similarity(item, target) for target in targets) for item in source) / len(source)

        return round((directional(left_values, right_values) + directional(right_values, left_values)) / 2, 6)


class OpenAICompatibleEmbeddingClient:
    """Strict implementation of the teammate ``EmbeddingClient`` contract."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        model: str = "text-embedding-3-small",
        attempts: int = 3,
        timeout_seconds: float = 3.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not api_key.strip():
            raise RuntimeError("Missing OPENVIKING_AI_EMB_API_KEY.")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.attempts = max(1, attempts)
        self.timeout_seconds = max(0.5, timeout_seconds)
        self.transport = transport

    def embed_query(self, text: str) -> list[float]:
        normalized = _canonical(text)
        if not normalized:
            raise ValueError("Embedding text cannot be empty.")
        last_error: Exception | None = None
        for attempt in range(self.attempts):
            try:
                with httpx.Client(
                    timeout=httpx.Timeout(self.timeout_seconds, connect=min(2, self.timeout_seconds)),
                    transport=self.transport,
                ) as client:
                    response = client.post(
                        f"{self.base_url}/embeddings",
                        headers={"authorization": f"Bearer {self.api_key}"},
                        json={"model": self.model, "input": normalized},
                    )
                    response.raise_for_status()
                rows = response.json().get("data", [])
                if len(rows) != 1:
                    raise ValueError("Embedding response must contain exactly one vector.")
                vector = [float(item) for item in rows[0].get("embedding", [])]
                if not vector:
                    raise ValueError("Embedding response contained an empty vector.")
                return vector
            except (httpx.HTTPError, ValueError, TypeError) as error:
                last_error = error
                if attempt + 1 < self.attempts:
                    time.sleep(0.15 * (2 ** attempt))
        raise RuntimeError("Teammate embedding service unavailable after retries.") from last_error


class RemoteEmbeddingSemanticSimilarity:
    """Strict semantic scorer backed by the teammate embedding contract.

    Production composition wraps this strict adapter with
    :class:`ResilientSemanticSimilarity`; keeping the adapter strict makes
    malformed provider responses testable before fallback is applied.
    """

    def __init__(
        self,
        *,
        embedding_client: EmbeddingClient | None = None,
        api_key: str = "",
        base_url: str = "https://api.openai.com/v1",
        model: str = "text-embedding-3-small",
        attempts: int = 3,
        timeout_seconds: float = 3.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.embedding_client = embedding_client or OpenAICompatibleEmbeddingClient(
            api_key=api_key,
            base_url=base_url,
            model=model,
            attempts=attempts,
            timeout_seconds=timeout_seconds,
            transport=transport,
        )
        self._cache: dict[str, tuple[float, ...]] = {}
        self._lock = threading.Lock()

    def _embeddings(self, values: Sequence[str]) -> list[tuple[float, ...]]:
        normalized = [_canonical(value) for value in values]
        for value in dict.fromkeys(normalized):
            if value in self._cache:
                continue
            vector = tuple(float(item) for item in self.embedding_client.embed_query(value))
            if not vector:
                raise RuntimeError("Teammate embedding service returned an empty vector.")
            with self._lock:
                self._cache[value] = vector
        return [self._cache[value] for value in normalized]

    @staticmethod
    def _cosine(left: Sequence[float], right: Sequence[float]) -> float:
        if len(left) != len(right):
            raise RuntimeError("Teammate embedding vectors have inconsistent dimensions.")
        dot = sum(a * b for a, b in zip(left, right, strict=True))
        left_norm = math.sqrt(sum(value * value for value in left))
        right_norm = math.sqrt(sum(value * value for value in right))
        if not left_norm or not right_norm:
            return 0.0
        # Negative similarity is not useful as social affinity evidence.
        return max(0.0, min(1.0, dot / (left_norm * right_norm)))

    def compare(self, left: Sequence[str], right: Sequence[str], *, dimension: str) -> float | None:
        del dimension
        left_values = [item for item in left if item and item.strip()]
        right_values = [item for item in right if item and item.strip()]
        if not left_values or not right_values:
            return None
        left_vectors = self._embeddings(left_values)
        right_vectors = self._embeddings(right_values)

        def directional(source: Sequence[Sequence[float]], targets: Sequence[Sequence[float]]) -> float:
            return sum(max(self._cosine(item, target) for target in targets) for item in source) / len(source)

        return round((directional(left_vectors, right_vectors) + directional(right_vectors, left_vectors)) / 2, 6)


class ResilientSemanticSimilarity:
    """Use embeddings when healthy and deterministic semantics otherwise.

    A short circuit-breaker prevents one unavailable provider from delaying
    every profile dimension in the same user request.
    """

    def __init__(
        self,
        primary: RemoteEmbeddingSemanticSimilarity,
        fallback: LocalSemanticSimilarity | None = None,
        *,
        cooldown_seconds: float = 30.0,
    ) -> None:
        self.primary = primary
        self.fallback = fallback or LocalSemanticSimilarity()
        self.cooldown_seconds = max(0.0, cooldown_seconds)
        self._unavailable_until = 0.0
        self._lock = threading.Lock()

    def compare(self, left: Sequence[str], right: Sequence[str], *, dimension: str) -> float | None:
        with self._lock:
            provider_available = time.monotonic() >= self._unavailable_until
        if provider_available:
            try:
                value = self.primary.compare(left, right, dimension=dimension)
                if value is None or (math.isfinite(value) and 0 <= value <= 1):
                    return value
                raise ValueError("Semantic provider returned an invalid similarity score.")
            except Exception:
                with self._lock:
                    self._unavailable_until = time.monotonic() + self.cooldown_seconds
        return self.fallback.compare(left, right, dimension=dimension)


def semantic_similarity_from_environment() -> LocalSemanticSimilarity | ResilientSemanticSimilarity:
    mode = os.getenv("SOCIAL_COSMOS_SEMANTIC_PROVIDER", "openviking").strip().lower()
    if mode in {"legacy", "legacy_local", "local", "hash"}:
        enabled = os.getenv("SOCIAL_COSMOS_ENABLE_LEGACY_SEMANTIC", "false").strip().lower()
        if enabled not in {"1", "true", "yes", "on"}:
            raise RuntimeError(
                "Legacy semantic similarity is hidden. Set "
                "SOCIAL_COSMOS_ENABLE_LEGACY_SEMANTIC=true explicitly for emergency use."
            )
        return LocalSemanticSimilarity()
    if mode not in {"openviking", "teammate"}:
        raise RuntimeError(f"Unsupported SOCIAL_COSMOS_SEMANTIC_PROVIDER: {mode}")
    provider = os.getenv("OPENVIKING_AI_EMB_PROVIDER", "openai").strip().lower()
    if provider not in {"openai", "openai_compatible"}:
        raise RuntimeError(f"Unsupported OPENVIKING_AI_EMB_PROVIDER: {provider}")
    api_key = os.getenv("OPENVIKING_AI_EMB_API_KEY", "").strip()
    if not api_key:
        return LocalSemanticSimilarity()
    return ResilientSemanticSimilarity(
        RemoteEmbeddingSemanticSimilarity(
            api_key=api_key,
            base_url=os.getenv("OPENVIKING_AI_EMB_BASE_URL", "").strip() or "https://api.openai.com/v1",
            model=os.getenv("OPENVIKING_AI_EMB_MODEL", "").strip() or "text-embedding-3-small",
            attempts=int(os.getenv("SEMANTIC_EMBEDDING_ATTEMPTS", "1")),
            timeout_seconds=float(os.getenv("SEMANTIC_EMBEDDING_TIMEOUT_SECONDS", "3")),
        ),
        cooldown_seconds=float(os.getenv("SEMANTIC_FALLBACK_COOLDOWN_SECONDS", "30")),
    )

