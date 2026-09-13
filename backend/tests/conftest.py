from __future__ import annotations

import atexit
import hashlib
import json
import math
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


_database_directory = tempfile.TemporaryDirectory(
    prefix="social-cosmos-tests-",
    ignore_cleanup_errors=True,
)
atexit.register(_database_directory.cleanup)
_database_path = os.path.join(_database_directory.name, "social-cosmos-tests.db")
os.environ["SOCIAL_COSMOS_DATABASE_URL"] = f"sqlite:///{_database_path.replace(os.sep, '/')}"


def _contract_vector(text: str, dimensions: int = 48) -> list[float]:
    """Deterministic fixture behind the real OpenAI-compatible HTTP contract."""

    normalized = " ".join(str(text).casefold().split())
    chunks = normalized.split() or [normalized]
    vector = [0.0] * dimensions
    for chunk in chunks:
        digest = hashlib.sha256(chunk.encode("utf-8")).digest()
        for offset in range(0, 12, 2):
            index = int.from_bytes(digest[offset:offset + 2], "big") % dimensions
            vector[index] += 1.0 if digest[offset + 12] % 2 == 0 else -1.0
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


class _TeammateContractHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - stdlib HTTP hook
        length = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        path = self.path.rstrip("/")
        if path == "/v1/embeddings":
            self._send_json(self._embedding_response(body))
            return
        if path == "/v1/chat/completions":
            self._send_json(self._memory_analysis_response(body))
            return
        if path == "/api/v1/search/find":
            self._send_json({
                "status": "ok",
                "result": {"memories": [], "resources": [], "skills": [], "total": 0},
            })
            return
        self.send_error(404)

    @staticmethod
    def _embedding_response(body: dict) -> dict:
        inputs = body.get("input", "")
        values = inputs if isinstance(inputs, list) else [inputs]
        return {
            "object": "list",
            "model": body.get("model", "test-contract-embedding"),
            "data": [
                {"object": "embedding", "index": index, "embedding": _contract_vector(str(value))}
                for index, value in enumerate(values)
            ],
        }

    @staticmethod
    def _memory_analysis_response(body: dict) -> dict:
        messages = body.get("messages", [])
        user_content = next(
            (item.get("content", "") for item in reversed(messages) if item.get("role") == "user"),
            "{}",
        )
        request = json.loads(user_content)
        evidence = request.get("evidence", {})
        raw_text = str(evidence.get("rawText") or "")
        source_text = raw_text or str(evidence.get("imageName") or "")
        mentioned = [
            person
            for person in request.get("knownPeople", [])
            if str(person.get("name") or "").casefold() in raw_text.casefold()
        ]
        digest = hashlib.sha256(
            f"{request.get('ownerScope', '')}\0{source_text}".encode("utf-8")
        ).hexdigest()[:16]
        memory = {
            "id": f"memory-contract-{digest}",
            "sourceType": evidence.get("sourceType", "text"),
            "rawText": raw_text,
            "mediaUrl": evidence.get("imageUrl") or "",
            "people": [
                {
                    "id": person["id"],
                    "name": person["name"],
                    "isExisting": True,
                    "relationType": "friend",
                    "identityLabel": "Known person",
                    "relationshipDescription": raw_text[:240],
                }
                for person in mentioned
            ],
            "eventTime": "2026-07-24",
            "location": "",
            "eventType": "shared_event",
            "summary": source_text[:2000] or "Submitted memory evidence",
            "facts": [source_text[:2000]] if source_text else [],
            "emotions": [],
            "relationshipSignals": {
                "interactionFrequency": 50,
                "emotionalIntimacy": 50,
                "initiativeBalance": 50,
                "relationshipChange": "stable",
            },
            "keywords": ["contract-test"],
            "narrative": "",
            "confidence": 0.9,
        }
        if raw_text:
            memory["semanticEvidence"] = {
                "schemaVersion": "semantic-evidence.v1",
                "interactionType": "conversation",
                "participation": "direct",
                "direction": "mutual",
                "evidenceSpans": [raw_text[:500]],
                "confidence": 0.9,
            }
        return {
            "id": f"chatcmpl-{digest}",
            "choices": [{"message": {"role": "assistant", "content": json.dumps(memory)}}],
        }

    def _send_json(self, payload: dict) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, _format: str, *_args: object) -> None:
        return


_embedding_server = ThreadingHTTPServer(("127.0.0.1", 0), _TeammateContractHandler)
_embedding_thread = threading.Thread(target=_embedding_server.serve_forever, daemon=True)
_embedding_thread.start()
atexit.register(_embedding_server.shutdown)

os.environ["SOCIAL_COSMOS_SEMANTIC_PROVIDER"] = "openviking"
os.environ["OPENVIKING_AI_EMB_PROVIDER"] = "openai"
os.environ["OPENVIKING_AI_EMB_API_KEY"] = "test-contract-key"
os.environ["OPENVIKING_AI_EMB_BASE_URL"] = f"http://127.0.0.1:{_embedding_server.server_port}/v1"
os.environ["OPENVIKING_AI_EMB_MODEL"] = "test-contract-embedding"
os.environ.pop("SOCIAL_COSMOS_ENABLE_LEGACY_SEMANTIC", None)
os.environ["SOCIAL_COSMOS_MEMORY_ANALYSIS_PROVIDER"] = "openviking"
os.environ["OPENVIKING_AI_API_KEY"] = "test-contract-key"
os.environ["OPENVIKING_AI_BASE_URL"] = f"http://127.0.0.1:{_embedding_server.server_port}/v1"
os.environ["OPENVIKING_AI_MODEL"] = "test-contract-memory-agent"
os.environ.pop("SOCIAL_COSMOS_ENABLE_LEGACY_MEMORY_ANALYSIS", None)
os.environ["OPENVIKING_URL"] = f"http://127.0.0.1:{_embedding_server.server_port}"
os.environ["OPENVIKING_API_KEY"] = "test-openviking-key"
