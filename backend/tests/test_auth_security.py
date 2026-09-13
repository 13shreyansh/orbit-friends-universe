from __future__ import annotations

from fastapi.testclient import TestClient

from app.db import UserRow
from app.infrastructure.rate_limit import InMemoryRateLimiter
from app.main import create_app


class RecordingEmailSender:
    provider_name = "test"

    def __init__(self) -> None:
        self.messages: list[tuple[str, str, int]] = []

    def send_signup_code(self, *, recipient: str, code: str, expires_minutes: int) -> None:
        self.messages.append((recipient, code, expires_minutes))


def secure_app(tmp_path, monkeypatch):
    monkeypatch.setenv("EMAIL_VERIFICATION_SECRET", "test-secret-with-at-least-thirty-two-characters")
    sender = RecordingEmailSender()
    app = create_app(
        f"sqlite:///{(tmp_path / 'secure-auth.db').as_posix()}",
        seed_demo=False,
        email_sender=sender,
        rate_limiter=InMemoryRateLimiter(),
        email_verification_required=True,
    )
    return app, sender


def test_verified_signup_binds_email_and_consumes_one_time_code(tmp_path, monkeypatch) -> None:
    app, sender = secure_app(tmp_path, monkeypatch)
    with TestClient(app) as client:
        sent = client.post(
            "/api/auth/email-verification/send",
            json={"email": "verified@qq.com", "purpose": "signup"},
        )
        assert sent.status_code == 202, sent.text
        assert sent.json()["expiresIn"] == 600
        assert len(sender.messages) == 1
        recipient, code, _expires = sender.messages[0]
        assert recipient == "verified@qq.com"
        assert len(code) == 6 and code.isdigit()

        missing = client.post(
            "/api/auth/signup",
            json={"displayName": "No Code", "email": "missing@qq.com", "password": "Secure2026!"},
        )
        assert missing.status_code == 422

        signup = client.post(
            "/api/auth/signup",
            json={
                "displayName": "Verified User",
                "email": "verified@qq.com",
                "password": "Secure2026!",
                "verificationCode": code,
            },
        )
        assert signup.status_code == 201, signup.text
        assert signup.json()["profile"]["email"] == "verified@qq.com"
        assert signup.json()["profile"]["emailVerified"] is True

        replay = client.post(
            "/api/auth/signup",
            json={
                "displayName": "Replay",
                "email": "verified@qq.com",
                "password": "Secure2026!",
                "verificationCode": code,
            },
        )
        assert replay.status_code == 422

    with app.state.database.session() as db:
        user = db.query(UserRow).filter_by(email="verified@qq.com").one()
        assert user.email_verified_at is not None


def test_wrong_code_is_rejected_and_send_endpoint_is_rate_limited(tmp_path, monkeypatch) -> None:
    app, sender = secure_app(tmp_path, monkeypatch)
    with TestClient(app) as client:
        sent = client.post(
            "/api/v1/auth/email-verification/send",
            json={"email": "wrong@qq.com", "purpose": "signup"},
        )
        assert sent.status_code == 202
        wrong = client.post(
            "/api/v1/auth/signup",
            json={
                "displayName": "Wrong Code",
                "email": "wrong@qq.com",
                "password": "Secure2026!",
                "verificationCode": "000000",
            },
        )
        assert wrong.status_code == 422

        # The first send above plus four more addresses consume the five-IP
        # budget; the following request is rejected before SMTP is contacted.
        for index in range(4):
            response = client.post(
                "/api/auth/email-verification/send",
                json={"email": f"rate-{index}@qq.com", "purpose": "signup"},
            )
            assert response.status_code == 202
        limited = client.post(
            "/api/auth/email-verification/send",
            json={"email": "rate-blocked@qq.com", "purpose": "signup"},
        )
        assert limited.status_code == 429
        assert int(limited.headers["retry-after"]) > 0
        assert len(sender.messages) == 5

