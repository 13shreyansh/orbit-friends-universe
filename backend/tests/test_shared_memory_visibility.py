from __future__ import annotations

from fastapi.testclient import TestClient

from app.db import MemoryShareRow, MemorySignalReceiptRow, MemorySignalRow
from app.main import create_app


def _login(client: TestClient, email: str, password: str) -> dict:
    response = client.post("/api/auth/signin", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()


def test_relationship_memory_is_shared_and_signal_is_recipient_scoped(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'shared-memory.db').as_posix()}", seed_demo=True)
    with TestClient(app) as client:
        alice = _login(client, "demo@socialcosmos.local", "Cosmos2026!")
        bob = _login(client, "maya@socialcosmos.local", "Friend2026!")
        alice_headers = {"Authorization": f"Bearer {alice['session']['token']}"}
        bob_headers = {"Authorization": f"Bearer {bob['session']['token']}"}
        relationship = next(
            item for item in alice["relationships"] if item["targetUserId"] == bob["profile"]["id"]
        )

        analyzed = client.post(
            "/api/memories/analyze",
            headers=alice_headers,
            json={
                "sourceType": "text",
                "rawText": "Maya Chen and I found a quiet bookshop after the rain.",
            },
        )
        assert analyzed.status_code == 200, analyzed.text
        saved = client.post(
            "/api/memories",
            headers=alice_headers,
            json={"memory": analyzed.json(), "relationshipId": relationship["id"]},
        )
        assert saved.status_code == 201, saved.text
        memory_id = saved.json()["memory"]["id"]

        alice_cosmos = client.get("/api/cosmos", headers=alice_headers).json()
        alice_memory = next(item for item in alice_cosmos["memories"] if item["id"] == memory_id)
        assert alice_memory["shared"] is False

        bob_cosmos = client.get("/api/cosmos", headers=bob_headers).json()
        bob_memory = next(item for item in bob_cosmos["memories"] if item["id"] == memory_id)
        assert bob_memory["shared"] is True
        assert bob_memory["sharedByUserId"] == alice["profile"]["id"]
        assert bob_memory["relationshipId"] is not None

        signal = next(item for item in bob_cosmos["memorySignals"] if item["memoryId"] == memory_id)
        assert signal["visible"] is True
        assert signal["sourcePlanetId"] == alice["selfPlanet"]["id"]

        read = client.post(f"/api/v1/memory-signals/{signal['id']}/read", headers=bob_headers)
        assert read.status_code == 200, read.text
        assert read.json()["signal"]["visible"] is False
        after_read = client.get("/api/v1/memory-signals", headers=bob_headers).json()
        assert next(item for item in after_read["signals"] if item["id"] == signal["id"])["visible"] is False

        with app.state.database.session() as db:
            share = db.query(MemoryShareRow).filter_by(memory_id=memory_id).one()
            stored_signal = db.query(MemorySignalRow).filter_by(id=signal["id"]).one()
            assert share.owner_user_id == alice["profile"]["id"]
            assert share.recipient_user_id == bob["profile"]["id"]
            assert db.query(MemorySignalReceiptRow).filter_by(signal_id=signal["id"], viewer_user_id=bob["profile"]["id"]).count() == 1
            assert stored_signal.active is True

        private_analysis = client.post(
            "/api/memories/analyze",
            headers=alice_headers,
            json={"sourceType": "text", "rawText": "A private note about a quiet morning."},
        )
        assert private_analysis.status_code == 200, private_analysis.text
        private = client.post(
            "/api/memories",
            headers=alice_headers,
            json={"memory": private_analysis.json()},
        )
        assert private.status_code == 201, private.text
        private_id = private.json()["memory"]["id"]
        assert all(item["id"] != private_id for item in client.get("/api/cosmos", headers=bob_headers).json()["memories"])

        detail = client.get(f"/api/v1/memories/{memory_id}", headers=bob_headers)
        assert detail.status_code == 200, detail.text
        assert detail.json()["readOnly"] is True
        assert client.delete(f"/api/v1/memories/{memory_id}", headers=bob_headers).status_code == 404

