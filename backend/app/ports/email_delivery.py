from __future__ import annotations

from typing import Protocol


class VerificationEmailSender(Protocol):
    provider_name: str

    def send_signup_code(self, *, recipient: str, code: str, expires_minutes: int) -> None: ...

