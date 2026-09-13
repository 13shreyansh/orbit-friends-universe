from app.db import Database, GraphProjectionOutboxRow, UserRow
from app.outbox_worker import drain_once, run_worker
from app.schemas.profile import ProfileIntake
from app.services import store_profile_graph


class RecordingProjection:
    backend_name = "recording"

    def __init__(self) -> None:
        self.owners: list[str] = []

    def project(self, graph) -> None:
        self.owners.append(graph.owner_user_id)

    def close(self) -> None:
        return None

    def health(self):
        return {"backend": self.backend_name, "status": "ok"}


def create_pending_database(tmp_path) -> Database:
    database = Database(f"sqlite:///{(tmp_path / 'worker.db').as_posix()}")
    database.create_schema()
    with database.session() as db:
        user = UserRow(
            id="worker-user",
            email="worker@example.test",
            password_hash="unused",
            display_name="Worker",
        )
        db.add(user)
        db.flush()
        store_profile_graph(db, user.id, ProfileIntake(display_name="Worker"))
    return database


def test_drain_once_projects_and_completes_pending_entry(tmp_path) -> None:
    database = create_pending_database(tmp_path)
    repository = RecordingProjection()

    result = drain_once(database, repository, batch_size=10)

    assert result == {"backend": "recording", "processed": 1, "completed": 1, "failed": 0}
    assert repository.owners == ["worker-user"]
    with database.session() as db:
        row = db.query(GraphProjectionOutboxRow).one()
        assert row.status == "completed"
        assert row.attempts == 1
        assert row.projected_at is not None


def test_once_worker_returns_failure_exit_code_for_projection_error(tmp_path) -> None:
    database = create_pending_database(tmp_path)

    class BrokenProjection(RecordingProjection):
        def project(self, graph) -> None:
            raise RuntimeError("neo4j unavailable")

    assert run_worker(database, BrokenProjection(), once=True) == 1
    with database.session() as db:
        row = db.query(GraphProjectionOutboxRow).one()
        assert row.status == "failed"
        assert row.attempts == 1
        assert row.last_error == "neo4j unavailable"
