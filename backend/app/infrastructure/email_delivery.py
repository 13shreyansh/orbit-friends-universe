from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from app.ports.email_delivery import VerificationEmailSender


logger = logging.getLogger("social_cosmos.email")


class DevelopmentEmailSender:
    """Local-only sender. It never logs the verification code."""

    provider_name = "development-noop"

    def send_signup_code(self, *, recipient: str, code: str, expires_minutes: int) -> None:
        del code
        logger.info(
            "verification_email_suppressed",
            extra={"recipient_domain": recipient.rpartition("@")[2], "expires_minutes": expires_minutes},
        )


class QQSmtpVerificationEmailSender:
    provider_name = "qq-smtp"

    def __init__(
        self,
        *,
        username: str,
        authorization_code: str,
        host: str = "smtp.qq.com",
        port: int = 465,
        from_name: str = "Social Cosmos",
        timeout_seconds: float = 10,
    ) -> None:
        if not username.strip() or not authorization_code.strip():
            raise ValueError("QQ SMTP username and authorization code are required.")
        self.username = username.strip()
        self.authorization_code = authorization_code.strip()
        self.host = host.strip()
        self.port = port
        self.from_name = from_name.strip() or "Social Cosmos"
        self.timeout_seconds = timeout_seconds

    def send_signup_code(self, *, recipient: str, code: str, expires_minutes: int) -> None:
        message = EmailMessage()
        message["Subject"] = "Orbit verification code"
        message["From"] = formataddr((self.from_name, self.username))
        message["To"] = recipient
        message.set_content(
            f"你的 Orbit verification code是：{code}\n\n"
            f"This code expires in {expires_minutes} minutes. If you did not request it, ignore this email."
        )
        message.add_alternative(
            "<div style='font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px'>"
            "<h2 style='margin:0 0 18px'>Social Cosmos</h2>"
            "<p>Your verification code is:</p>"
            f"<div style='font-size:32px;letter-spacing:8px;font-weight:700'>{code}</div>"
            f"<p style='color:#667;margin-top:20px'>This code expires in {expires_minutes} minutes. If you did not request it, ignore this email.</p>"
            "</div>",
            subtype="html",
        )
        with smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout_seconds) as smtp:
            smtp.login(self.username, self.authorization_code)
            smtp.send_message(message)


def email_sender_from_environment() -> VerificationEmailSender:
    provider = os.getenv("EMAIL_DELIVERY_PROVIDER", "development").strip().lower()
    if provider in {"development", "noop", "local"}:
        if os.getenv("APP_ENV", "development").strip().lower() == "production":
            raise RuntimeError("Production must configure EMAIL_DELIVERY_PROVIDER=qq_smtp.")
        return DevelopmentEmailSender()
    if provider != "qq_smtp":
        raise RuntimeError(f"Unsupported email delivery provider: {provider}")
    return QQSmtpVerificationEmailSender(
        username=os.getenv("QQ_SMTP_USERNAME", ""),
        authorization_code=os.getenv("QQ_SMTP_AUTH_CODE", ""),
        host=os.getenv("QQ_SMTP_HOST", "smtp.qq.com"),
        port=int(os.getenv("QQ_SMTP_PORT", "465")),
        from_name=os.getenv("EMAIL_FROM_NAME", "Social Cosmos"),
        timeout_seconds=float(os.getenv("EMAIL_SMTP_TIMEOUT_SECONDS", "10")),
    )

