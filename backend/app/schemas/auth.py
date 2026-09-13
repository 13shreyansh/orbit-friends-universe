from __future__ import annotations

from pydantic import Field, field_validator

from .base import ApiModel


class AuthRequest(ApiModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = Field(default=None, min_length=2, max_length=80)
    verification_code: str | None = Field(default=None, min_length=6, max_length=6, pattern=r"^\d{6}$")

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("enter a valid email address")
        return normalized


class EmailVerificationRequest(ApiModel):
    email: str = Field(min_length=3, max_length=320)
    purpose: str = Field(default="signup", pattern=r"^signup$")

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return AuthRequest.validate_email(value)
