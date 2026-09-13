from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.application.serialization import new_id
from app.db import EmailVerificationRow, UserRow
from app.ports.email_delivery import VerificationEmailSender


class VerificationError(ValueError):
    pass


class VerificationCooldown(VerificationError):
    def __init__(self, retry_after: int) -> None:
        super().__init__("Please wait before requesting another verification code.")
        self.retry_after = retry_after


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _code_hash(secret: str, row_id: str, email: str, code: str) -> str:
    payload = f"{row_id}\0{email}\0signup\0{code}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def issue_signup_code(
    db: Session,
    *,
    email: str,
    secret: str,
    sender: VerificationEmailSender,
    ttl_seconds: int = 600,
    resend_seconds: int = 60,
) -> tuple[int, int]:
    now = datetime.now(timezone.utc)
    latest = db.scalar(
        select(EmailVerificationRow)
        .where(EmailVerificationRow.email == email, EmailVerificationRow.purpose == "signup")
        .order_by(EmailVerificationRow.sent_at.desc())
        .limit(1)
    )
    if latest:
        elapsed = (now - _aware(latest.sent_at)).total_seconds()
        if elapsed < resend_seconds:
            raise VerificationCooldown(max(1, int(resend_seconds - elapsed + 0.999)))

    # Do not reveal whether an account already exists. The response remains
    # identical, but no email is sent for an address that cannot be registered.
    if db.scalar(select(UserRow.id).where(UserRow.email == email, UserRow.deleted_at.is_(None))):
        return ttl_seconds, resend_seconds

    row_id = new_id("email-verification")
    code = f"{secrets.randbelow(1_000_000):06d}"
    row = EmailVerificationRow(
        id=row_id,
        email=email,
        purpose="signup",
        code_hash=_code_hash(secret, row_id, email, code),
        attempts=0,
        max_attempts=5,
        expires_at=now + timedelta(seconds=ttl_seconds),
        sent_at=now,
    )
    db.add(row)
    db.flush()
    sender.send_signup_code(
        recipient=email,
        code=code,
        expires_minutes=max(1, (ttl_seconds + 59) // 60),
    )
    return ttl_seconds, resend_seconds


def consume_signup_code(db: Session, *, email: str, code: str, secret: str) -> EmailVerificationRow:
    now = datetime.now(timezone.utc)
    row = db.scalar(
        select(EmailVerificationRow)
        .where(
            EmailVerificationRow.email == email,
            EmailVerificationRow.purpose == "signup",
            EmailVerificationRow.consumed_at.is_(None),
        )
        .order_by(EmailVerificationRow.sent_at.desc())
        .with_for_update()
        .limit(1)
    )
    if not row or _aware(row.expires_at) <= now:
        raise VerificationError("Verification code is invalid or expired.")
    if row.attempts >= row.max_attempts:
        raise VerificationError("Verification code has reached its attempt limit.")
    expected = _code_hash(secret, row.id, email, code)
    if not hmac.compare_digest(row.code_hash, expected):
        row.attempts += 1
        db.flush()
        # Persist the failed-attempt counter even though the HTTP request will
        # return an error and the dependency normally rolls back exceptions.
        db.commit()
        raise VerificationError("Verification code is invalid or expired.")
    row.consumed_at = now
    db.flush()
    return row

