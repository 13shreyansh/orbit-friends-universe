import asyncio
from datetime import datetime

from fastapi.testclient import TestClient

from app.activity_analysis_worker import drain_once as drain_activity_analysis
from app.main import create_app
from app.db import ActivityPostRow, AnalysisJobRow, Database, GraphProjectionOutboxRow, IntegrationOutboxRow, MemoryRevisionRow, MemoryRow, NebulaMemberRow, PlanetRow, TimelineRow, UserBehaviorEventRow
from app.memory_provider import LocalMemoryAnalysisProvider
from app.ports.agent_memory import AgentMemoryRecall
from app.schemas.memory import MemorySemanticEvidence


def test_database_url_can_be_configured_from_environment(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "environment.db"
    monkeypatch.setenv("SOCIAL_COSMOS_DATABASE_URL", f"sqlite:///{database_path.as_posix()}")

    database = Database()

    assert database.engine.url.database == database_path.as_posix()


def test_upload_directory_can_be_configured_from_environment(tmp_path, monkeypatch) -> None:
    upload_directory = tmp_path / "configured-uploads"
    monkeypatch.setenv("SOCIAL_COSMOS_UPLOAD_DIRECTORY", str(upload_directory))

    create_app(f"sqlite:///{(tmp_path / 'configured.db').as_posix()}", seed_demo=False)

    assert upload_directory.is_dir()


def test_api_responses_publish_server_clock_and_shanghai_display_zone(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'clock.db').as_posix()}", seed_demo=False)
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.headers["x-display-time-zone"] == "Asia/Shanghai"
    server_time = datetime.fromisoformat(response.headers["x-server-time"].replace("Z", "+00:00"))
    assert server_time.tzinfo is not None


def test_profile_graph_and_universe_end_to_end(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'api.db').as_posix()}", seed_demo=True)
    with TestClient(app) as client:
        sign_in = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        )
        assert sign_in.status_code == 200
        payload = sign_in.json()
        assert len(payload["friendPlanets"]) == 5
        visuals = [payload["selfPlanet"]["visual"], *(planet["visual"] for planet in payload["friendPlanets"])]
        assert len({(visual["archetype"], visual["seed"]) for visual in visuals}) == 6
        token = payload["session"]["token"]
        headers = {"Authorization": f"Bearer {token}"}

        intake = client.put(
            "/api/v1/users/me/intake",
            headers=headers,
            json={
                "displayName": "Zaosusu",
                "bio": "A builder of social universes.",
                "birthDate": "1994-03-12",
                "birthPlace": {"name": "Suzhou", "countryCode": "CN"},
                "education": [{
                    "institution": "Soochow University",
                    "level": "master",
                    "fieldOfStudy": "Design",
                    "period": {"startDate": "2012-09-01", "endDate": "2018-06-30"},
                    "verification": "verified",
                }],
                "work": [{
                    "organization": "Cosmos Studio",
                    "role": "Founder",
                    "industry": "Software",
                    "seniority": "founder",
                    "period": {"startDate": "2019-01-01", "isCurrent": True},
                    "highlights": ["Built Social Cosmos"],
                    "verification": "verified",
                }],
                "projects": [{
                    "title": "Open Cosmos Community",
                    "kind": "community",
                    "domain": "social",
                    "description": "A public community project.",
                    "collaboratorCount": 12,
                    "period": {"startDate": "2021-01-01", "isCurrent": True},
                }],
                "skills": [{"name": "Python", "category": "engineering", "proficiency": 5}],
                "interests": [{"name": "Astronomy", "category": "science"}],
            },
        )
        assert intake.status_code == 200, intake.text
        result = intake.json()
        assert result["graph"]["schemaVersion"] == "profile_graph.v1"
        assert result["planetScore"]["algorithmVersion"] == "mass.v2"
        assert result["snapshot"]["schemaVersion"] == 2
        assert len(result["snapshot"]["nodes"]) == 6

        graph = client.get("/api/v1/users/me/graph", headers=headers)
        assert graph.status_code == 200
        assert any(node["kind"] == "Organization" for node in graph.json()["nodes"])

        create_planet = client.post(
            "/api/planets",
            headers=headers,
            json={
                "identity": {
                    "name": "Graph Voyager Prime",
                    "motto": "Every graph has a gravity.",
                    "description": "A builder of social universes.",
                    "tags": ["graph"],
                    "mass": 50,
                    "influence": 50,
                },
                "visual": {
                    "version": 1,
                    "archetype": "terran",
                    "seed": 4281,
                    "radius": 1,
                    "terrain": 0.5,
                    "roughness": 0.6,
                    "oceanLevel": 0.4,
                    "cloudDensity": 0.4,
                    "atmosphereStrength": 0.7,
                    "ring": False,
                    "ringColor": "#fff",
                    "satellites": 0,
                    "palette": {"deep": "#111", "surface": "#555", "highlight": "#faa", "atmosphere": "#aaf"},
                    "backgroundSkinId": "rose-galaxy",
                },
            },
        )
        assert create_planet.status_code == 201, create_planet.text
        assert create_planet.json()["planet"]["visual"]["backgroundSkinId"] == "rose-galaxy"
        graph_after_genesis = client.get("/api/v1/users/me/graph", headers=headers).json()
        score_after_genesis = client.get("/api/v1/planets/me/score", headers=headers).json()
        assert len(graph_after_genesis["nodes"]) == len(graph.json()["nodes"])
        assert score_after_genesis["massScore"] > result["planetScore"]["massScore"]
        assert score_after_genesis["behaviorEventCount"] > result["planetScore"]["behaviorEventCount"]

        compatibility = client.post("/api/spatial/snapshot", headers=headers, json={})
        assert compatibility.status_code == 200
        assert compatibility.json()["schemaVersion"] == 1

        first_window = client.get("/api/v1/universe/window?offset=0&limit=2", headers=headers)
        second_window = client.get("/api/v1/universe/window?offset=2&limit=2", headers=headers)
        assert first_window.status_code == 200, first_window.text
        assert second_window.status_code == 200, second_window.text
        first_body = first_window.json()
        second_body = second_window.json()
        assert len(first_body["planets"]) == 2
        assert len(first_body["snapshot"]["nodes"]) == 3
        assert first_body["pagination"]["nextOffset"] == 2
        assert not {planet["id"] for planet in first_body["planets"]}.intersection(
            planet["id"] for planet in second_body["planets"]
        )


def test_private_graph_requires_authentication(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'auth.db').as_posix()}", seed_demo=False)
    with TestClient(app) as client:
        assert client.get("/api/v1/users/me/graph").status_code == 401


def test_mock_signup_accepts_six_character_password(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'six-character-password.db').as_posix()}", seed_demo=False)
    with TestClient(app) as client:
        response = client.post(
            "/api/auth/signup",
            json={"displayName": "早早", "email": "111@qq.com", "password": "123456"},
        )

    assert response.status_code == 201, response.text
    assert response.json()["profile"]["email"] == "111@qq.com"


def test_user_discovery_searches_registered_names_and_explains_unavailable_accounts(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'user-discovery.db').as_posix()}", seed_demo=False)
    with TestClient(app) as client:
        alpha = client.post(
            "/api/auth/signup",
            json={"displayName": "Alpha", "email": "alpha@example.test", "password": "Alpha2026!"},
        ).json()
        beta = client.post(
            "/api/auth/signup",
            json={"displayName": "Beta Voyager", "email": "beta@example.test", "password": "Beta2026!"},
        ).json()
        gamma = client.post(
            "/api/auth/signup",
            json={"displayName": "Gamma Pending", "email": "gamma@example.test", "password": "Gamma2026!"},
        ).json()
        alpha_headers = {"Authorization": f"Bearer {alpha['session']['token']}"}
        beta_headers = {"Authorization": f"Bearer {beta['session']['token']}"}

        for headers, name in ((alpha_headers, "Alpha Prime"), (beta_headers, "Beta Prime")):
            created = client.post(
                "/api/planets",
                headers=headers,
                json={"identity": {"name": name}, "visual": {"archetype": "terran"}},
            )
            assert created.status_code == 201, created.text

        for headers, name in ((alpha_headers, "Alpha"), (beta_headers, "Beta Voyager")):
            intake = client.put(
                "/api/v1/users/me/intake",
                headers=headers,
                json={"displayName": name, "personalityType": "ESFP"},
            )
            assert intake.status_code == 200, intake.text

        directory = client.get("/api/users/discover?includeAffinity=true", headers=alpha_headers)
        assert directory.status_code == 200, directory.text
        beta_match = next(item for item in directory.json()["users"] if item["id"] == beta["profile"]["id"])
        assert beta_match["profileAffinity"] == 1.0
        assert beta_match["affinityConfidence"] == 0.1
        assert beta_match["planetReady"] is True
        assert beta_match["canConnect"] is True
        assert all(item["id"] != gamma["profile"]["id"] for item in directory.json()["users"])

        pending_search = client.get("/api/users/discover?q=MmA+PeN", headers=alpha_headers)
        assert pending_search.status_code == 200, pending_search.text
        assert pending_search.json()["users"] == [{
            "id": gamma["profile"]["id"],
            "displayName": "Gamma Pending",
            "bio": "",
            "planetId": None,
            "planetName": "",
            "planetReady": False,
            "connected": False,
            "canConnect": False,
            "profileAffinity": None,
            "affinityConfidence": 0,
            "profileFeatures": [],
        }]

        relationship = client.post(
            "/api/relationships",
            headers=alpha_headers,
            json={
                "targetUserId": beta["profile"]["id"],
                "relationType": "friend",
                "identityLabel": "Friend",
                "description": "A real database connection.",
            },
        )
        assert relationship.status_code == 201, relationship.text

        connected_search = client.get("/api/users/discover?q=beta", headers=alpha_headers)
        assert connected_search.status_code == 200, connected_search.text
        connected_match = connected_search.json()["users"][0]
        assert connected_match["connected"] is True
        assert connected_match["canConnect"] is False
        assert client.get("/api/users/discover", headers=alpha_headers).json()["users"] == []


def test_new_user_intake_survives_initial_hydration_and_genesis(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'new-user.db').as_posix()}", seed_demo=False)
    with TestClient(app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={"displayName": "Graph Voyager", "email": "graph@example.test", "password": "CosmosGraph2026!"},
        )
        assert signup.status_code == 201, signup.text
        headers = {"Authorization": f"Bearer {signup.json()['session']['token']}"}

        # ProductApp hydrates immediately after authentication, before onboarding is complete.
        hydrated = client.get("/api/cosmos", headers=headers)
        assert hydrated.status_code == 200
        assert hydrated.json()["selfPlanet"] is None
        initial_intake = client.get("/api/v1/users/me/intake", headers=headers)
        assert initial_intake.status_code == 200
        assert initial_intake.json()["displayName"] == "Graph Voyager"
        assert initial_intake.json()["birthDate"] is None
        intake = client.put(
            "/api/v1/users/me/intake",
            headers=headers,
            json={
                "displayName": "Graph Voyager",
                "bio": "I build graph systems and organize open learning communities.",
                "personalityType": "INTP",
                "birthDate": "1994-03-12",
                "birthPlace": {"name": "Suzhou"},
                "education": [{"institution": "Soochow University", "level": "master", "fieldOfStudy": "Computer Science", "period": {"startDate": "2012-09-01", "endDate": "2018-06-30"}}],
                "work": [{"organization": "Cosmos Graph Lab", "role": "Graph Systems Engineer", "industry": "Software", "period": {"startDate": "2019-01-01", "isCurrent": True}}],
                "skills": [{"name": "Python", "proficiency": 3}],
                "interests": [{"name": "Astronomy"}],
                "attributes": [{
                    "key": "onboarding.profile_guide_completed",
                    "category": "onboarding",
                    "value": True,
                    "visibility": "private",
                }],
            },
        )
        assert intake.status_code == 200, intake.text
        assert intake.json()["snapshot"] is None
        expected_score = intake.json()["planetScore"]["massScore"]
        expected_node_count = len(intake.json()["graph"]["nodes"])
        assert expected_node_count > 1

        stored_intake = client.get("/api/v1/users/me/intake", headers=headers)
        assert stored_intake.status_code == 200
        assert stored_intake.json()["birthDate"] == "1994-03-12"
        assert stored_intake.json()["personalityType"] == "INTP"
        assert stored_intake.json()["attributes"][0]["key"] == "onboarding.profile_guide_completed"
        assert stored_intake.json()["education"][0]["period"]["startDate"] == "2012-09-01"

        revised_intake = stored_intake.json()
        revised_intake["birthDate"] = "1995-04-13"
        revised_intake["education"][0]["period"]["startDate"] = "2013-09-01"
        revised = client.put("/api/v1/users/me/intake", headers=headers, json=revised_intake)
        assert revised.status_code == 200, revised.text
        reloaded_intake = client.get("/api/v1/users/me/intake", headers=headers).json()
        assert reloaded_intake["birthDate"] == "1995-04-13"
        assert reloaded_intake["education"][0]["period"]["startDate"] == "2013-09-01"
        assert client.get("/api/cosmos", headers=headers).json()["selfPlanet"] is None

        with app.state.database.session() as db:
            assert db.query(PlanetRow).filter_by(owner_user_id=signup.json()["profile"]["id"]).first() is None

        planet = client.post(
            "/api/planets",
            headers=headers,
            json={"identity": {"name": "Graph Voyager Prime"}, "visual": {"archetype": "terran"}},
        )
        assert planet.status_code == 201, planet.text
        assert planet.json()["planet"]["identity"]["name"] == "Graph Voyager Prime"
        assert len(client.get("/api/v1/users/me/graph", headers=headers).json()["nodes"]) == expected_node_count
        dynamic_score = client.get("/api/v1/planets/me/score", headers=headers).json()
        assert dynamic_score["massScore"] > expected_score
        assert dynamic_score["behaviorEventCount"] > intake.json()["planetScore"]["behaviorEventCount"]

        signed_in_again = client.post(
            "/api/auth/signin",
            json={"email": "graph@example.test", "password": "CosmosGraph2026!"},
        )
        assert signed_in_again.status_code == 200
        assert signed_in_again.json()["selfPlanet"]["identity"]["name"] == "Graph Voyager Prime"


def test_new_account_receives_distant_database_sample_planets_from_backend_layout(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'sample-planets.db').as_posix()}", seed_demo=True)
    with TestClient(app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={"displayName": "New Voyager", "email": "new-voyager@example.test", "password": "Voyager2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {signup['session']['token']}"}
        planet = client.post(
            "/api/planets",
            headers=headers,
            json={"identity": {"name": "New Voyager Prime"}, "visual": {"archetype": "terran"}},
        )
        assert planet.status_code == 201, planet.text

        cosmos = client.get("/api/cosmos", headers=headers).json()
        snapshot = client.post("/api/spatial/snapshot", headers=headers, json={}).json()
        assert cosmos["friendPlanets"] == []
        assert 1 <= len(cosmos["samplePlanets"]) <= 12
        assert len(snapshot["nodes"]) == len(cosmos["samplePlanets"]) + 1
        assert snapshot["layoutAlgorithmVersion"] == "layout.v2"

        node_by_planet = {node["planetId"]: node for node in snapshot["nodes"]}
        for sample in cosmos["samplePlanets"]:
            node = node_by_planet[sample["id"]]
            assert sample["relationshipStrength"] <= 0.22
            assert node["orbitBand"] > 20
            assert abs(node["sphericalPosition"]["radius"] - node["orbitBand"]) < 1e-6


def test_memory_creates_timeline_and_updates_owned_relationship(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'memory.db').as_posix()}", seed_demo=True)
    with TestClient(app) as client:
        login = client.post("/api/auth/signin", json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"}).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        maya = next(item for item in login["relationships"] if item["targetName"] == "Maya Chen")

        analysis = client.post(
            "/api/memories/analyze",
            headers=headers,
            json={"sourceType": "text", "rawText": "Maya Chen and I talked all night about our next shared trip."},
        )
        assert analysis.status_code == 200, analysis.text
        memory = analysis.json()
        assert memory["people"][0]["id"] == maya["targetUserId"]
        assert memory["analysisProvider"] == "openviking-agent:test-contract-memory-agent"

        saved = client.post(
            "/api/memories",
            headers=headers,
            json={"memory": memory, "relationshipId": maya["id"]},
        )
        assert saved.status_code == 201, saved.text
        cosmos = saved.json()["cosmos"]
        assert any(item["id"] == memory["id"] for item in cosmos["memories"])
        assert any(item["sourceMemoryId"] == memory["id"] for item in cosmos["timeline"])

        outsider = client.post(
            "/api/auth/signup",
            json={"displayName": "Outsider", "email": "outsider@example.test", "password": "Outside2026!"},
        ).json()
        outsider_headers = {"Authorization": f"Bearer {outsider['session']['token']}"}
        forbidden = client.post(
            "/api/memories",
            headers=outsider_headers,
            json={"memory": {**memory, "id": "outsider-memory"}, "relationshipId": maya["id"]},
        )
        assert forbidden.status_code == 404


def test_relationship_memory_persists_photo_and_video_pages(tmp_path) -> None:
    app = create_app(
        f"sqlite:///{(tmp_path / 'memory-media.db').as_posix()}",
        seed_demo=True,
        activity_upload_directory=tmp_path / "uploads",
    )
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        maya = next(item for item in login["relationships"] if item["targetName"] == "Maya Chen")

        photo_response = client.post(
            "/api/memory-media",
            headers=headers,
            files={"file": ("night-walk.png", b"\x89PNG\r\n\x1a\nmemory-photo", "image/png")},
        )
        video_response = client.post(
            "/api/memory-media",
            headers=headers,
            files={"file": ("night-walk.mp4", b"memory-video", "video/mp4")},
        )
        assert photo_response.status_code == 201, photo_response.text
        assert video_response.status_code == 201, video_response.text
        photo = photo_response.json()
        video = video_response.json()

        analyzed = client.post(
            "/api/memories/analyze",
            headers=headers,
            json={"sourceType": "text", "rawText": "Maya Chen and I recorded our night walk together."},
        )
        assert analyzed.status_code == 200, analyzed.text
        memory = analyzed.json() | {"media": [photo, video]}
        saved = client.post(
            "/api/memories",
            headers=headers,
            json={"memory": memory, "relationshipId": maya["id"]},
        )
        assert saved.status_code == 201, saved.text
        persisted = next(item for item in saved.json()["cosmos"]["memories"] if item["id"] == memory["id"])
        assert persisted["relationshipId"] == maya["id"]
        assert [item["type"] for item in persisted["media"]] == ["image", "video"]
        assert client.get(persisted["media"][0]["url"]).status_code == 200


def test_local_memory_agent_keeps_all_known_people_in_a_shared_memory(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'multi-person-analysis.db').as_posix()}", seed_demo=True)
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        analyzed = client.post(
            "/api/memories/analyze",
            headers=headers,
            json={
                "sourceType": "text",
                "rawText": "Maya Chen and Lin Wei joined the same project review.",
            },
        )

    assert analyzed.status_code == 200, analyzed.text
    assert {person["name"] for person in analyzed.json()["people"]} == {"Maya Chen", "Lin Wei"}
    assert all(person["isExisting"] for person in analyzed.json()["people"])


def test_multi_person_memory_links_every_relationship_and_replays_idempotently(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'multi-memory.db').as_posix()}", seed_demo=True)
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        maya = next(item for item in login["relationships"] if item["targetName"] == "Maya Chen")
        lin = next(item for item in login["relationships"] if item["targetName"] == "Lin Wei")
        analyzed = client.post(
            "/api/memories/analyze",
            headers=headers,
            json={"sourceType": "text", "rawText": "Maya Chen and Lin Wei joined the same project review."},
        ).json()
        analyzed["people"] = [
            {"id": maya["targetUserId"], "name": "Maya Chen", "isExisting": True},
            {"id": lin["targetUserId"], "name": "Lin Wei", "isExisting": True},
        ]

        # The UI may still carry a selected relationship while showing a
        # multi-person memory. The backend must keep the shared memory row
        # unscoped regardless of that client hint.
        first = client.post(
            "/api/memories",
            headers=headers,
            json={"memory": analyzed, "relationshipId": maya["id"]},
        )
        assert first.status_code == 201, first.text
        replay = client.post(
            "/api/memories",
            headers=headers,
            json={"memory": {**analyzed, "id": "same-evidence-new-client-id"}},
        )
        assert replay.status_code == 201, replay.text
        assert replay.json()["memory"]["id"] == analyzed["id"]

        relationships = {item["targetUserId"]: item for item in first.json()["cosmos"]["relationships"]}
        assert relationships[maya["targetUserId"]]["score"]["memoryCount"] >= 1
        assert relationships[lin["targetUserId"]]["score"]["memoryCount"] >= 1

        with app.state.database.session() as db:
            memories = db.query(MemoryRow).filter_by(owner_user_id=login["profile"]["id"]).all()
            timelines = db.query(TimelineRow).filter_by(source_memory_id=analyzed["id"]).all()
            events = db.query(UserBehaviorEventRow).filter_by(
                owner_user_id=login["profile"]["id"],
                event_type="memory_recorded",
            ).all()
            assert len(memories) == 1
            assert memories[0].relationship_id is None
            assert {item.relationship_id for item in timelines} == {maya["id"], lin["id"]}
            assert {item.target_user_id for item in events} == {maya["targetUserId"], lin["targetUserId"]}


def test_memory_analysis_provider_can_be_injected_for_teammate_agent(tmp_path) -> None:
    class CompressedRecallStore:
        async def recall(self, *, user_id, query, top_k=5):
            assert user_id == "demo-zaosusu"
            assert query
            assert top_k == 5
            return [AgentMemoryRecall(
                object_key="viking://user/demo-zaosusu/memories/.abstract",
                score=0.92,
                content={"level": "L0", "abstract": "Maya relationship memory summary"},
            )]

    class TeammateAgentProvider:
        provider_name = "teammate-agent-test"

        def __init__(self) -> None:
            self.calls = []

        async def analyze(self, request, context):
            self.calls.append((request, context))
            fallback = await LocalMemoryAnalysisProvider().analyze(request, context)
            return fallback.model_copy(update={"analysis_provider": self.provider_name})

    provider = TeammateAgentProvider()
    app = create_app(
        f"sqlite:///{(tmp_path / 'memory-provider.db').as_posix()}",
        seed_demo=True,
        memory_analysis_provider=provider,
        agent_memory_store=CompressedRecallStore(),
    )
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        response = client.post(
            "/api/memories/analyze",
            headers=headers,
            json={"sourceType": "text", "rawText": "Maya Chen shared an old story."},
        )
        maya = next(item for item in login["relationships"] if item["targetName"] == "Maya Chen")
        saved = client.post(
            "/api/memories",
            headers=headers,
            json={"memory": response.json(), "relationshipId": maya["id"]},
        )
        assert saved.status_code == 201, saved.text
        second_response = client.post(
            "/api/memories/analyze",
            headers=headers,
            json={"sourceType": "text", "rawText": "Maya Chen shared another story."},
        )

    assert response.status_code == 200, response.text
    assert second_response.status_code == 200, second_response.text
    assert response.json()["analysisProvider"] == "teammate-agent-test"
    assert len(provider.calls) == 2
    assert any(person["name"] == "Maya Chen" for person in provider.calls[0][1].known_people)
    assert provider.calls[0][1].owner_user_id == "demo-zaosusu"
    assert provider.calls[0][1].related_memories == ()
    assert provider.calls[1][1].related_memories == ()
    assert provider.calls[0][1].agent_memory_recalls[0].content["level"] == "L0"
    assert provider.calls[1][1].agent_memory_recalls[0].object_key.endswith("/.abstract")


def test_memory_analysis_replaces_spoofed_existing_person_with_safe_fallback(tmp_path) -> None:
    class SpoofingAgentProvider:
        provider_name = "spoofing-agent-test"

        async def analyze(self, request, context):
            fallback = await LocalMemoryAnalysisProvider().analyze(request, context)
            person = fallback.people[0].model_copy(update={
                "id": "invented-existing-user",
                "name": "Invented User",
                "is_existing": True,
            })
            return fallback.model_copy(update={"people": [person]})

    app = create_app(
        f"sqlite:///{(tmp_path / 'spoofed-person.db').as_posix()}",
        seed_demo=True,
        memory_analysis_provider=SpoofingAgentProvider(),
    )
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        response = client.post(
            "/api/memories/analyze",
            headers=headers,
            json={"sourceType": "text", "rawText": "Maya Chen shared a story."},
        )
        assert response.status_code == 200
        assert response.json()["analysisProvider"] == "local-fallback"
        assert {person["id"] for person in response.json()["people"]} == {"maya"}
        with app.state.database.session() as db:
            job = db.query(AnalysisJobRow).filter_by(owner_user_id=login["profile"]["id"]).one()
            assert job is not None
            assert job.status == "awaiting_confirmation"
            assert job.last_error == ""


def test_memory_analysis_replaces_fabricated_semantic_span_with_safe_fallback(tmp_path) -> None:
    class FabricatingAgentProvider:
        provider_name = "fabricating-agent-test"

        async def analyze(self, request, context):
            fallback = await LocalMemoryAnalysisProvider().analyze(request, context)
            evidence = MemorySemanticEvidence(
                interaction_type="support",
                participation="direct",
                direction="mutual",
                evidence_spans=["a quote that was never submitted"],
                confidence=0.99,
            )
            return fallback.model_copy(update={"semantic_evidence": evidence})

    app = create_app(
        f"sqlite:///{(tmp_path / 'fabricated-semantic.db').as_posix()}",
        seed_demo=True,
        memory_analysis_provider=FabricatingAgentProvider(),
    )
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        response = client.post(
            "/api/memories/analyze",
            headers=headers,
            json={"sourceType": "text", "rawText": "Maya Chen shared a story."},
        )

    assert response.status_code == 200
    assert response.json()["analysisProvider"] == "local-fallback"
    assert response.json()["semanticEvidence"] is None


def test_own_memory_and_other_user_behavior_dynamically_change_mass_and_distance(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'dynamic-universe.db').as_posix()}", seed_demo=True)
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        maya = next(item for item in login["relationships"] if item["targetName"] == "Maya Chen")
        before_mass = login["selfPlanet"]["identity"]["massScore"]
        before_strength = maya["strength"]
        before_snapshot = client.post("/api/spatial/snapshot", headers=headers, json={}).json()
        before_node = next(item for item in before_snapshot["nodes"] if item["planetId"] == maya["targetPlanetId"])
        adventurex = next(
            item for item in client.get("/api/nebulae", headers=headers).json()["joined"]
            if item["slug"] == "adventurex"
        )
        before_nebula = client.get(f"/api/nebulae/{adventurex['id']}/space", headers=headers).json()
        before_nebula_node = next(
            item for item in before_nebula["snapshot"]["nodes"]
            if item["planetId"] == maya["targetPlanetId"]
        )

        memory = {
            "id": "dynamic-memory-1",
            "sourceType": "text",
            "rawText": "Maya and I spent a meaningful evening planning our next project.",
            "mediaUrl": "",
            "people": [{
                "id": maya["targetUserId"],
                "name": "Maya Chen",
                "isExisting": True,
                "relationType": "friend",
            }],
            "eventTime": "2026-07-23",
            "location": "Shanghai",
            "eventType": "conversation",
            "summary": "A long and meaningful project conversation.",
            "facts": ["Planned a shared project"],
            "emotions": [{"name": "trust", "intensity": 94}],
            "relationshipSignals": {
                "interactionFrequency": 92,
                "emotionalIntimacy": 95,
                "initiativeBalance": 50,
                "relationshipChange": "closer",
            },
            "keywords": ["project", "trust"],
            "narrative": "Two worlds built a stronger shared orbit.",
            "confidence": 0.96,
            "semanticEvidence": {
                "schemaVersion": "semantic-evidence.v1",
                "interactionType": "support",
                "participation": "direct",
                "direction": "mutual",
                "evidenceSpans": ["Maya and I spent a meaningful evening planning our next project."],
                "confidence": 0.97,
            },
            "analysisProvider": "teammate-agent-test",
        }
        saved = client.post(
            "/api/memories",
            headers=headers,
            json={"memory": memory, "relationshipId": maya["id"]},
        )
        assert saved.status_code == 201, saved.text
        cosmos = saved.json()["cosmos"]
        after_relationship = next(item for item in cosmos["relationships"] if item["targetUserId"] == maya["targetUserId"])
        score = client.get("/api/v1/planets/me/score", headers=headers).json()
        after_snapshot = client.post("/api/spatial/snapshot", headers=headers, json={}).json()
        after_node = next(item for item in after_snapshot["nodes"] if item["planetId"] == maya["targetPlanetId"])
        after_nebula = client.get(f"/api/nebulae/{adventurex['id']}/space", headers=headers).json()
        after_nebula_node = next(
            item for item in after_nebula["snapshot"]["nodes"]
            if item["planetId"] == maya["targetPlanetId"]
        )

        assert cosmos["selfPlanet"]["identity"]["massScore"] > before_mass
        assert score["memoryCount"] >= 1
        assert score["behaviorEventCount"] >= 2
        assert after_relationship["strength"] > before_strength
        assert any(
            feature["name"] == "semantic_interaction"
            for feature in after_relationship["score"]["features"]
        )
        assert after_node["orbitBand"] < before_node["orbitBand"]
        assert abs(after_node["sphericalPosition"]["radius"] - after_node["orbitBand"]) < 1e-6
        assert after_nebula["snapshot"]["graphVersion"] != before_nebula["snapshot"]["graphVersion"]
        assert after_nebula_node["orbitBand"] < before_nebula_node["orbitBand"]


def test_incoming_relationship_behavior_changes_target_planet_mass(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'incoming-behavior.db').as_posix()}", seed_demo=False)
    with TestClient(app) as client:
        alpha = client.post(
            "/api/auth/signup",
            json={"displayName": "Alpha", "email": "alpha@example.test", "password": "Alpha2026!"},
        ).json()
        beta = client.post(
            "/api/auth/signup",
            json={"displayName": "Beta", "email": "beta@example.test", "password": "Beta2026!"},
        ).json()
        alpha_headers = {"Authorization": f"Bearer {alpha['session']['token']}"}
        beta_headers = {"Authorization": f"Bearer {beta['session']['token']}"}
        client.get("/api/cosmos", headers=alpha_headers)
        client.get("/api/cosmos", headers=beta_headers)
        client.get("/api/v1/planets/me/score", headers=alpha_headers)
        before = client.get("/api/v1/planets/me/score", headers=beta_headers).json()

        created = client.post(
            "/api/relationships",
            headers=alpha_headers,
            json={
                "targetUserId": beta["profile"]["id"],
                "relationType": "friend",
                "identityLabel": "New friend",
                "description": "A new connection in the cosmos.",
            },
        )
        assert created.status_code == 201, created.text
        alpha_score_before_reciprocal = created.json()["relationships"][0]["score"]
        after = client.get("/api/v1/planets/me/score", headers=beta_headers).json()

        assert before["socialBehaviorEventCount"] == 0
        assert after["socialBehaviorEventCount"] == 1
        assert after["massScore"] > before["massScore"]

        reciprocal = client.post(
            "/api/relationships",
            headers=beta_headers,
            json={
                "targetUserId": alpha["profile"]["id"],
                "relationType": "friend",
                "identityLabel": "New connection",
                "description": "Still getting to know each other.",
            },
        )
        assert reciprocal.status_code == 201, reciprocal.text
        alpha_after_reciprocal = client.get("/api/cosmos", headers=alpha_headers).json()
        alpha_score_after_reciprocal = alpha_after_reciprocal["relationships"][0]["score"]
        assert alpha_score_after_reciprocal["behaviorEventCount"] == alpha_score_before_reciprocal["behaviorEventCount"] == 0
        assert alpha_score_after_reciprocal["algorithmVersion"] == "relationship.v4"


def test_nebula_directory_space_search_code_join_and_broadcast_receipt(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'nebula.db').as_posix()}", seed_demo=True)
    with TestClient(app) as client:
        demo_login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        demo_headers = {"Authorization": f"Bearer {demo_login['session']['token']}"}

        directory = client.get("/api/nebulae", headers=demo_headers)
        assert directory.status_code == 200, directory.text
        adventurex = next(item for item in directory.json()["joined"] if item["name"] == "AdventureX")
        assert adventurex["memberCount"] == 6
        assert adventurex["joinCode"] == "202600"
        assert len(directory.json()["recommended"]) == 5
        assert directory.json()["recommended"][0]["slug"] == "adventurex"
        assert len(directory.json()["catalog"]) == 6
        assert directory.json()["pagination"] == {"page": 1, "pageSize": 6, "total": 10, "totalPages": 2}

        second_catalog_page = client.get("/api/nebulae?page=2&pageSize=6", headers=demo_headers).json()
        assert len(second_catalog_page["catalog"]) == 4
        assert not {item["id"] for item in directory.json()["catalog"]}.intersection(
            item["id"] for item in second_catalog_page["catalog"]
        )

        first_space = client.get(f"/api/nebulae/{adventurex['id']}/space", headers=demo_headers)
        assert first_space.status_code == 200, first_space.text
        second_space = client.get(f"/api/nebulae/{adventurex['id']}/space", headers=demo_headers)
        assert second_space.status_code == 200, second_space.text
        space = second_space.json()
        assert len(space["members"]) == 6
        assert len(space["snapshot"]["nodes"]) == 6
        assert space["snapshot"]["coordinateSystem"] == "social-spherical-v1"
        assert space["graph"]["version"] == space["snapshot"]["graphVersion"]
        assert space["graph"]["edgeCount"] < 6 * 20

        first_nebula_window = client.get(
            f"/api/nebulae/{adventurex['id']}/space?offset=0&limit=2",
            headers=demo_headers,
        ).json()
        second_nebula_window = client.get(
            f"/api/nebulae/{adventurex['id']}/space?offset=2&limit=2",
            headers=demo_headers,
        ).json()
        assert len(first_nebula_window["members"]) == 3
        assert first_nebula_window["pagination"] == {
            "offset": 0, "limit": 2, "total": 5, "nextOffset": 2, "hasMore": True,
        }
        first_ids = {member["planet"]["id"] for member in first_nebula_window["members"] if not member["planet"]["isSelf"]}
        second_ids = {member["planet"]["id"] for member in second_nebula_window["members"] if not member["planet"]["isSelf"]}
        assert not first_ids.intersection(second_ids)

        created = []
        for index in range(7):
            response = client.post(
                "/api/nebulae",
                headers=demo_headers,
                json={"name": f"Discovery Nebula {index}", "description": "A searchable test community."},
            )
            assert response.status_code == 201, response.text
            created.append(response.json())
            assert len(response.json()["joinCode"]) == 6
            assert response.json()["joinCode"].isdigit()

        maya_login = client.post(
            "/api/auth/signin",
            json={"email": "maya@socialcosmos.local", "password": "Friend2026!"},
        ).json()
        maya_headers = {"Authorization": f"Bearer {maya_login['session']['token']}"}
        maya_directory = client.get("/api/nebulae", headers=maya_headers).json()
        assert len(maya_directory["recommended"]) == 5
        assert maya_directory["recommended"][0]["slug"] == "adventurex"
        assert len({item["id"] for item in maya_directory["recommended"]}) == 5

        search = client.get("/api/nebulae?q=Discovery%20Nebula%206", headers=maya_headers)
        assert search.status_code == 200
        assert [item["name"] for item in search.json()["searchResults"]] == ["Discovery Nebula 6"]

        joined = client.post(
            "/api/nebulae/join-by-code",
            headers=maya_headers,
            json={"joinCode": created[0]["joinCode"].lower()},
        )
        assert joined.status_code == 200, joined.text
        assert joined.json()["joined"] is True
        with app.state.database.session() as db:
            assert db.query(NebulaMemberRow).filter_by(
                nebula_id=created[0]["id"], user_id="maya"
            ).count() == 1

        priya_login = client.post(
            "/api/auth/signin",
            json={"email": "priya@socialcosmos.local", "password": "Friend2026!"},
        ).json()
        priya_headers = {"Authorization": f"Bearer {priya_login['session']['token']}"}
        broadcast = client.post(
            "/api/activities/activity-demo-adventurex/broadcast/read",
            headers=priya_headers,
        )
        assert broadcast.status_code == 200, broadcast.text
        assert broadcast.json()["activity"]["broadcast"]["visible"] is False


def test_activity_updates_mass_persists_ecosystem_and_respects_visibility(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'activities.db').as_posix()}", seed_demo=False)
    with TestClient(app) as client:
        alpha = client.post(
            "/api/auth/signup",
            json={"displayName": "Alpha", "email": "alpha-activity@example.test", "password": "Alpha2026!"},
        ).json()
        beta = client.post(
            "/api/auth/signup",
            json={"displayName": "Beta", "email": "beta-activity@example.test", "password": "Beta2026!"},
        ).json()
        gamma = client.post(
            "/api/auth/signup",
            json={"displayName": "Gamma", "email": "gamma-activity@example.test", "password": "Gamma2026!"},
        ).json()
        alpha_headers = {"Authorization": f"Bearer {alpha['session']['token']}"}
        beta_headers = {"Authorization": f"Bearer {beta['session']['token']}"}
        gamma_headers = {"Authorization": f"Bearer {gamma['session']['token']}"}
        before = client.get("/api/v1/planets/me/score", headers=alpha_headers).json()
        client.get("/api/v1/planets/me/score", headers=beta_headers)
        client.get("/api/v1/planets/me/score", headers=gamma_headers)
        effect = {
            "version": 1,
            "kind": "crystal-bloom",
            "seed": 20260723,
            "intensity": 0.82,
            "signalStrength": 0.91,
            "landmarkCount": 7,
            "primaryColor": "#66f5d2",
            "secondaryColor": "#ffb56b",
        }

        created = client.post(
            "/api/activities",
            headers=alpha_headers,
            json={
                "kind": "alpha-private-vocabulary",
                "title": "Built a new observatory",
                "text": "A meaningful creation event that changes the planet ecosystem.",
                "tags": ["late night", "friends", "late night"],
                "eventName": "Cosmos Build Day",
                "location": "Shanghai",
                "visibility": "friends",
                "ecosystemEffect": effect,
            },
        )
        assert created.status_code == 201, created.text
        payload = created.json()
        activity = payload["activity"]
        after = client.get("/api/v1/planets/me/score", headers=alpha_headers).json()

        assert activity["kind"] == "alpha-private-vocabulary"
        assert activity["tags"] == ["late night", "friends"]
        assert {key: activity["ecosystemEffect"][key] for key in effect} == effect
        assert set(activity["ecosystemEffect"]["traits"]) == {
            "vitality", "serenity", "intensity", "connection", "motion", "memory", "novelty",
        }
        assert activity["broadcast"] == {
            "active": True,
            "visible": True,
            "canClose": True,
            "seenAt": None,
        }
        assert after["behaviorEventCount"] == before["behaviorEventCount"] + 1
        assert after["memoryCount"] == before["memoryCount"]
        assert after["massScore"] > before["massScore"]
        assert payload["analysis"] == {"status": "queued"}
        assert any(item["id"] == activity["id"] for item in client.get("/api/cosmos", headers=alpha_headers).json()["activities"])
        assert all(item["id"] != activity["id"] for item in client.get("/api/cosmos", headers=beta_headers).json()["activities"])
        unauthorized_read = client.post(
            f"/api/activities/{activity['id']}/broadcast/read",
            headers=gamma_headers,
        )
        assert unauthorized_read.status_code == 404

        relationship = client.post(
            "/api/relationships",
            headers=beta_headers,
            json={
                "targetUserId": alpha["profile"]["id"],
                "relationType": "friend",
                "identityLabel": "Creative friend",
                "description": "Following Alpha's planet updates.",
            },
        )
        assert relationship.status_code == 201, relationship.text
        beta_cosmos = client.get("/api/cosmos", headers=beta_headers).json()
        beta_activity = next(item for item in beta_cosmos["activities"] if item["id"] == activity["id"])
        assert beta_activity["broadcast"]["visible"] is True
        assert beta_activity["broadcast"]["canClose"] is False
        read_broadcast = client.post(
            f"/api/activities/{activity['id']}/broadcast/read",
            headers=beta_headers,
        )
        assert read_broadcast.status_code == 200, read_broadcast.text
        assert read_broadcast.json()["activity"]["broadcast"]["visible"] is False
        assert read_broadcast.json()["activity"]["broadcast"]["seenAt"] is not None

        forbidden_close = client.post(
            f"/api/activities/{activity['id']}/broadcast/close",
            headers=beta_headers,
        )
        assert forbidden_close.status_code == 409
        closed = client.post(
            f"/api/activities/{activity['id']}/broadcast/close",
            headers=alpha_headers,
        )
        assert closed.status_code == 200, closed.text
        assert closed.json()["activity"]["broadcast"]["active"] is False
        assert closed.json()["activity"]["broadcast"]["visible"] is False

        public = client.post(
            "/api/activities",
            headers=alpha_headers,
            json={
                "kind": "reflection",
                "title": "A public signal",
                "text": "Visible across the wider universe.",
                "visibility": "public",
            },
        )
        assert public.status_code == 201, public.text
        gamma_activities = client.get("/api/cosmos", headers=gamma_headers).json()["activities"]
        assert any(item["id"] == public.json()["activity"]["id"] for item in gamma_activities)
        assert all(item["id"] != activity["id"] for item in gamma_activities)

    with app.state.database.session() as db:
        stored = db.get(ActivityPostRow, activity["id"])
        assert stored is not None
        assert stored.ecosystem_json
        events = list(db.query(UserBehaviorEventRow).filter_by(
            owner_user_id=alpha["profile"]["id"],
            event_type="activity_published",
        ))
        assert len(events) == 2


def test_views_and_visits_are_durable_deduplicated_relationship_evidence(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'interaction-evidence.db').as_posix()}", seed_demo=False)
    with TestClient(app) as client:
        alpha = client.post(
            "/api/auth/signup",
            json={"displayName": "Alpha", "email": "alpha-view@example.test", "password": "Alpha2026!"},
        ).json()
        beta = client.post(
            "/api/auth/signup",
            json={"displayName": "Beta", "email": "beta-view@example.test", "password": "Beta2026!"},
        ).json()
        alpha_headers = {"Authorization": f"Bearer {alpha['session']['token']}"}
        beta_headers = {"Authorization": f"Bearer {beta['session']['token']}"}
        client.get("/api/v1/planets/me/score", headers=alpha_headers)
        client.get("/api/v1/planets/me/score", headers=beta_headers)
        beta_cosmos = client.get("/api/cosmos", headers=beta_headers).json()
        relationship = client.post(
            "/api/relationships",
            headers=alpha_headers,
            json={
                "targetUserId": beta["profile"]["id"],
                "relationType": "friend",
                "identityLabel": "Known person",
                "description": "A label only.",
            },
        ).json()["relationships"][0]
        before_strength = relationship["strength"]

        published = client.post(
            "/api/activities",
            headers=beta_headers,
            json={"text": "A public field note.", "visibility": "public"},
        )
        assert published.status_code == 201, published.text
        activity_id = published.json()["activity"]["id"]

        first_read = client.post(
            f"/api/activities/{activity_id}/broadcast/read",
            headers=alpha_headers,
        )
        assert first_read.status_code == 200, first_read.text
        after_read = first_read.json()["cosmos"]["relationships"][0]["score"]
        assert after_read["behaviorEventCount"] == 1
        assert after_read["strength"] > before_strength

        duplicate_read = client.post(
            f"/api/activities/{activity_id}/broadcast/read",
            headers=alpha_headers,
        )
        assert duplicate_read.status_code == 200, duplicate_read.text
        assert duplicate_read.json()["cosmos"]["relationships"][0]["score"]["behaviorEventCount"] == 1

        second_activity = client.post(
            "/api/activities",
            headers=beta_headers,
            json={"text": "A second public field note.", "visibility": "public"},
        ).json()["activity"]
        second_read = client.post(
            f"/api/activities/{second_activity['id']}/broadcast/read",
            headers=alpha_headers,
        )
        assert second_read.status_code == 200, second_read.text
        # Raw receipts remain auditable, but one evidence type contributes at
        # most one dynamic-evidence bucket per direction and UTC day.
        assert second_read.json()["cosmos"]["relationships"][0]["score"]["behaviorEventCount"] == 1

        planet_id = beta_cosmos["selfPlanet"]["id"]
        first_view = client.post(
            f"/api/planets/{planet_id}/interactions",
            headers=alpha_headers,
            json={"kind": "view"},
        )
        assert first_view.status_code == 201, first_view.text
        duplicate_view = client.post(
            f"/api/planets/{planet_id}/interactions",
            headers=alpha_headers,
            json={"kind": "view"},
        )
        assert duplicate_view.status_code == 201, duplicate_view.text
        visited = client.post(
            f"/api/planets/{planet_id}/interactions",
            headers=alpha_headers,
            json={"kind": "visit"},
        )
        assert visited.status_code == 201, visited.text
        score = visited.json()["cosmos"]["relationships"][0]["score"]
        assert score["behaviorEventCount"] == 3
        assert score["strength"] >= after_read["strength"]

        with app.state.database.session() as db:
            events = db.query(UserBehaviorEventRow).filter_by(
                owner_user_id=alpha["profile"]["id"],
                target_user_id=beta["profile"]["id"],
            ).all()
            evidence_events = [event for event in events if event.event_type in {"activity_viewed", "planet_viewed", "planet_visited"}]
            assert len(evidence_events) == 4


def test_activity_mentions_become_relationship_memory_without_double_counting(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'activity-memory.db').as_posix()}", seed_demo=True)
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        maya_before = next(item for item in login["relationships"] if item["targetName"] == "Maya Chen")
        before_count = maya_before["score"]["memoryCount"]
        before_events = maya_before["score"]["behaviorEventCount"]

        created = client.post(
            "/api/activities",
            headers=headers,
            json={
                "text": "Maya Chen and I planned our next science project together.",
                "visibility": "friends",
            },
        )
        assert created.status_code == 201, created.text
        assert created.json()["analysis"] == {"status": "queued"}
        immediate = client.get("/api/cosmos", headers=headers).json()
        maya_immediate = next(item for item in immediate["relationships"] if item["targetName"] == "Maya Chen")
        assert maya_immediate["score"]["memoryCount"] == before_count
        assert maya_immediate["score"]["behaviorEventCount"] == before_events

        processed = asyncio.run(drain_activity_analysis(
            app.state.database,
            app.state.memory_agent,
            backoff_base_seconds=0,
        ))
        assert processed == {"claimed": 1, "completed": 1, "failed": 0, "dead_lettered": 0}
        cosmos = client.get("/api/cosmos", headers=headers).json()
        maya_after = next(item for item in cosmos["relationships"] if item["targetName"] == "Maya Chen")
        assert maya_after["score"]["memoryCount"] == before_count + 1
        # The post creates one targeted mention event. Its auto-memory does
        # not add a second synthetic memory_recorded behavior row.
        assert maya_after["score"]["behaviorEventCount"] == before_events + 1

        with app.state.database.session() as db:
            memory = db.query(MemoryRow).filter_by(
                owner_user_id=login["profile"]["id"],
                relationship_id=maya_before["id"],
            ).order_by(MemoryRow.created_at.desc()).first()
            assert memory is not None
            assert memory.relationship_id == maya_before["id"]
            mention_events = db.query(UserBehaviorEventRow).filter_by(
                owner_user_id=login["profile"]["id"],
                target_user_id=maya_before["targetUserId"],
                event_type="activity_mentioned",
            ).all()
            assert len(mention_events) == 1
            assert db.query(MemoryRevisionRow).filter_by(memory_id=memory.id).count() == 1
            outbox = db.query(IntegrationOutboxRow).filter_by(
                aggregate_type="memory",
                aggregate_id=memory.id,
                event_type="memory.upserted",
            ).one()
            assert outbox.destination == "agent_memory"

def test_activity_media_upload_supports_photo_voice_and_video_then_publishes(tmp_path) -> None:
    app = create_app(
        f"sqlite:///{(tmp_path / 'activity-media.db').as_posix()}",
        seed_demo=True,
        activity_upload_directory=tmp_path / "uploads",
    )
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/signin",
            json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}

        photo_response = client.post(
            "/api/activity-media",
            headers=headers,
            files={"file": ("adventurex.png", b"\x89PNG\r\n\x1a\nlocal-demo", "image/png")},
        )
        assert photo_response.status_code == 201, photo_response.text
        photo = photo_response.json()
        assert photo["type"] == "image"
        assert client.get(photo["url"]).status_code == 200

        voice_response = client.post(
            "/api/activity-media",
            headers=headers,
            files={"file": ("field-note.webm", b"local-audio-demo", "audio/webm")},
        )
        assert voice_response.status_code == 201, voice_response.text
        voice = voice_response.json()
        assert voice["type"] == "audio"
        assert client.get(voice["url"]).status_code == 200

        video_response = client.post(
            "/api/activity-media",
            headers=headers,
            files={"file": ("build-recap.mp4", b"local-video-demo", "video/mp4")},
        )
        assert video_response.status_code == 201, video_response.text
        video = video_response.json()
        assert video["type"] == "video"
        assert client.get(video["url"]).status_code == 200

        published = client.post(
            "/api/activities",
            headers=headers,
            json={
                "title": "Dinner at home with my cat",
                "text": "A very ordinary evening: cooking noodles, listening to the rain, and feeding the cat.",
                "tags": ["daily life", "cat", "rainy evening"],
                "location": "Home",
                "visibility": "friends",
                "media": [photo, voice, video],
            },
        )
        assert published.status_code == 201, published.text
        activity = published.json()["activity"]
        assert [item["type"] for item in activity["media"]] == ["image", "audio", "video"]
        assert activity["tags"] == ["daily life", "cat", "rainy evening"]
        assert activity["kind"] == "life-update"
        assert activity["analysisStatus"] == "queued"
        assert activity["ecosystemEffect"]["kind"].endswith("-terrain")
        assert activity["ecosystemEffect"]["landmarkCount"] >= 10
        assert activity["ecosystemEffect"]["traits"]["vitality"] > 0.5
        assert activity["ecosystemEffect"]["traits"]["motion"] > 0.5
        analysis_event = published.json()["analysis"]
        assert analysis_event == {"status": "queued"}
        processed = asyncio.run(drain_activity_analysis(app.state.database, app.state.memory_agent))
        assert processed["completed"] == 1
        with app.state.database.session() as db:
            stored = db.get(ActivityPostRow, activity["id"])
            assert '"analysisStatus":"completed"' in stored.content_json
            memory = db.query(MemoryRow).filter_by(owner_user_id=login["profile"]["id"]).order_by(
                MemoryRow.created_at.desc()
            ).first()
            assert memory is not None
            assert photo["url"] in memory.memory_json


def test_planet_customization_is_safe_and_deterministic(tmp_path) -> None:
    app = create_app(f"sqlite:///{(tmp_path / 'ai.db').as_posix()}", seed_demo=True)
    with TestClient(app) as client:
        login = client.post("/api/auth/signin", json={"email": "demo@socialcosmos.local", "password": "Cosmos2026!"}).json()
        headers = {"Authorization": f"Bearer {login['session']['token']}"}
        current = login["selfPlanet"]["visual"]
        first = client.post(
            "/api/ai/planet-customization",
            headers=headers,
            json={"prompt": "A calm warm ocean with a thin ring", "current": current, "profile": login["profile"]},
        )
        second = client.post(
            "/api/ai/planet-customization",
            headers=headers,
            json={"prompt": "A calm warm ocean with a thin ring", "current": current, "profile": login["profile"]},
        )
        assert first.status_code == second.status_code == 200
        assert first.json()["visual"] == second.json()["visual"]
        assert first.json()["visual"]["archetype"] == "oceanic"
        assert first.json()["visual"]["ring"] is True
        assert "customShaderId" not in first.json()["visual"]


def test_failed_graph_projection_is_saved_and_retried_without_losing_intake(tmp_path) -> None:
    class FailOnceProjection:
        backend_name = "fail-once-test"

        def __init__(self) -> None:
            self.calls = 0

        def project(self, graph) -> None:
            self.calls += 1
            if self.calls == 1:
                raise ConnectionError("Neo4j unavailable")

        def health(self):
            return {"backend": self.backend_name, "status": "ok"}

        def close(self) -> None:
            return None

    repository = FailOnceProjection()
    app = create_app(
        f"sqlite:///{(tmp_path / 'projection-outbox.db').as_posix()}",
        seed_demo=False,
        graph_repository=repository,
    )
    with TestClient(app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={"displayName": "Outbox", "email": "outbox@example.test", "password": "Outbox2026!"},
        ).json()
        headers = {"Authorization": f"Bearer {signup['session']['token']}"}
        payload = {"displayName": "Outbox", "work": [{"organization": "Reliable Graph", "role": "Builder"}]}

        first = client.put("/api/v1/users/me/intake", headers=headers, json=payload)
        assert first.status_code == 200, first.text
        # The first queued signup graph fails, then the submitted graph succeeds.
        assert first.json()["projection"] == {
            "backend": "fail-once-test", "processed": 2, "completed": 1, "failed": 1,
        }
        graph_version = first.json()["graph"]["graphVersion"]
        assert client.get("/api/v1/users/me/graph", headers=headers).json()["graphVersion"] == graph_version

        second = client.put("/api/v1/users/me/intake", headers=headers, json=payload)
        assert second.status_code == 200, second.text
        assert second.json()["projection"]["failed"] == 0

    with app.state.database.session() as db:
        rows = list(db.query(GraphProjectionOutboxRow).all())
        assert rows
        assert all(row.status == "completed" for row in rows)
