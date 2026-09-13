from __future__ import annotations

import ast
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


APP_ROOT = Path(__file__).resolve().parents[1] / "app"


def imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
    return modules


def test_application_layer_does_not_depend_on_fastapi_transport() -> None:
    application_files = list((APP_ROOT / "application").glob("*.py"))
    assert application_files
    for path in application_files:
        assert all(not module.startswith("fastapi") for module in imported_modules(path)), path.name


def test_legacy_services_module_is_only_a_compatibility_facade() -> None:
    tree = ast.parse((APP_ROOT / "services.py").read_text(encoding="utf-8"))
    assert not any(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) for node in tree.body)


def test_media_storage_adapter_is_replaceable_without_changing_routes(tmp_path) -> None:
    class RecordingStorage:
        def __init__(self) -> None:
            self.saved: list[tuple[str, bytes]] = []

        def save(self, *, object_name: str, content: bytes) -> str:
            self.saved.append((object_name, content))
            return f"/test-objects/{object_name}"

    storage = RecordingStorage()
    app = create_app(
        f"sqlite:///{(tmp_path / 'storage-port.db').as_posix()}",
        seed_demo=False,
        activity_upload_directory=tmp_path / "uploads",
        media_storage=storage,
    )
    with TestClient(app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={"displayName": "Storage Port", "email": "storage-port@example.test", "password": "Storage2026!"},
        ).json()
        response = client.post(
            "/api/activity-media",
            headers={"Authorization": f"Bearer {signup['session']['token']}"},
            files={"file": ("signal.png", b"fake-image", "image/png")},
        )

    assert response.status_code == 201, response.text
    assert response.json()["url"].startswith("/test-objects/media-")
    assert len(storage.saved) == 1
    assert storage.saved[0][1] == b"fake-image"

