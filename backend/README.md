# Orbit backend

The FastAPI service contains the Orbit album-understanding and shared-visit adapters alongside the inherited Distance application. It is separate from the static GitHub Pages demo.

Start with the [development guide](../docs/DEVELOPMENT.md) for a local environment and the [architecture](../docs/ARCHITECTURE.md) for the dependency structure.

```sh
# From the repository root, with Python 3.10+
python3 -m venv .venv
.venv/bin/python -m pip install -e './backend[test,production]'
.venv/bin/python -m pytest -q backend/tests/orbit
```

The Orbit suite uses temporary databases and mocked image-understanding responses. It does not require a real OpenAI key or verify live model quality.

| Component | Responsibility |
| --- | --- |
| [orbit_albums.py](app/orbit_albums.py) | Validate uploads, request chapters, preview, confirm, and persist photo memories |
| [orbit_visits.py](app/orbit_visits.py) | Shared destination, page state, guest sessions, and presence |
| [main.py](app/main.py) | Register routes, configure adapters, initialize the app |
| [tests/orbit](tests/orbit) | Contract, access, limits, persistence, and synchronization tests |

The public frontend installs a fixture transport and does not invoke these adapters. A live album-understanding deployment needs an intentionally configured server, model access, storage, and an integrated entry flow. See [visual intelligence](../docs/VISUAL_INTELLIGENCE.md) and [limitations](../docs/LIMITATIONS.md).

The inherited README is preserved as [historical reference](../docs/reference/backend-readme-original.md), including its original language and service descriptions. Those descriptions are not evidence that all upstream production integrations are deployed for Orbit.
