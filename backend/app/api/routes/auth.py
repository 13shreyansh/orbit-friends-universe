from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.application.email_verification import (
    VerificationCooldown,
    VerificationError,
    consume_signup_code,
    issue_signup_code,
)
from app.application.graph_projection import store_profile_graph
from app.application.profile import serialize_profile
from app.application.serialization import new_id
from app.application.universe import get_cosmos
from app.db import SessionRow, UserRow
from app.schemas.auth import AuthRequest, EmailVerificationRequest
from app.schemas.profile import ProfileIntake
from app.security import create_session, hash_password, verify_password

from ..dependencies import db_session
from ..middleware import client_ip
from app.infrastructure.rate_limit import protected_key


router = APIRouter()


def _enforce_limit(request: Request, key: str, *, limit: int, window_seconds: int) -> None:
    try:
        decision = request.app.state.rate_limiter.hit(key, limit=limit, window_seconds=window_seconds)
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail="Abuse protection is temporarily unavailable.",
            headers={"Retry-After": "5"},
        ) from error
    if not decision.allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please try again later.",
            headers={"Retry-After": str(decision.retry_after)},
        )


@router.get("/api/auth/config")
@router.get("/api/v1/auth/config")
@router.get("/api/public/auth-config")
def auth_config(request: Request) -> dict[str, bool]:
    return {
        "emailVerificationRequired": bool(request.app.state.email_verification_required),
        "emailDeliveryConfigured": request.app.state.email_sender.provider_name != "development-noop",
    }


@router.post("/api/auth/email-verification/send", status_code=202)
@router.post("/api/v1/auth/email-verification/send", status_code=202)
def send_email_verification(
    body: EmailVerificationRequest,
    request: Request,
    db: Session = Depends(db_session),
) -> dict[str, Any]:
    email = str(body.email).lower()
    ip = client_ip(request.scope)
    _enforce_limit(request, "social-cosmos:global:verify-minute", limit=60, window_seconds=60)
    _enforce_limit(request, protected_key("verify-ip-10m", ip), limit=5, window_seconds=600)
    _enforce_limit(request, protected_key("verify-email-10m", email), limit=3, window_seconds=600)
    _enforce_limit(request, protected_key("verify-email-day", email), limit=10, window_seconds=86400)
    _enforce_limit(
        request,
        protected_key("verify-email-cooldown", email),
        limit=1,
        window_seconds=request.app.state.email_verification_resend_seconds,
    )
    try:
        expires_in, resend_after = issue_signup_code(
            db,
            email=email,
            secret=request.app.state.email_verification_secret,
            sender=request.app.state.email_sender,
            ttl_seconds=request.app.state.email_verification_ttl_seconds,
            resend_seconds=request.app.state.email_verification_resend_seconds,
        )
    except VerificationCooldown as error:
        raise HTTPException(
            status_code=429,
            detail=str(error),
            headers={"Retry-After": str(error.retry_after)},
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail="Verification email could not be sent. Please try again later.",
            headers={"Retry-After": "30"},
        ) from error
    return {
        "accepted": True,
        "expiresIn": expires_in,
        "resendAfter": resend_after,
        "message": "If this address can be registered, a verification code has been sent.",
    }


@router.post("/api/auth/signup", status_code=201)
@router.post("/api/v1/auth/signup", status_code=201)
def signup(body: AuthRequest, request: Request, db: Session = Depends(db_session)) -> dict[str, Any]:
    if not body.display_name:
        raise HTTPException(status_code=422, detail="displayName is required.")
    email = str(body.email).lower()
    ip = client_ip(request.scope)
    _enforce_limit(request, "social-cosmos:global:signup-minute", limit=120, window_seconds=60)
    _enforce_limit(request, protected_key("signup-ip", ip), limit=10, window_seconds=600)
    _enforce_limit(request, protected_key("signup-email", email), limit=5, window_seconds=3600)
    if request.app.state.email_verification_required or body.verification_code:
        if not body.verification_code:
            raise HTTPException(status_code=422, detail="A valid email verification code is required.")
        try:
            consume_signup_code(
                db,
                email=email,
                code=body.verification_code,
                secret=request.app.state.email_verification_secret,
            )
        except VerificationError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
    user = UserRow(
        id=new_id("user"),
        email=email,
        email_verified_at=datetime.now(timezone.utc) if body.verification_code else None,
        password_hash=hash_password(body.password),
        display_name=body.display_name,
        bio="",
        tags_json="[]",
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="An account already exists for this email.") from error
    store_profile_graph(db, user.id, ProfileIntake(display_name=user.display_name))
    session = create_session(db, user.id)
    return {
        "session": {"userId": user.id, "token": session.token},
        "profile": serialize_profile(user),
        "selfPlanet": None,
        "friendPlanets": [],
        "samplePlanets": [],
        "relationships": [],
        "memories": [],
        "timeline": [],
        "activities": [],
    }


@router.post("/api/auth/signin")
@router.post("/api/v1/auth/signin")
def signin(body: AuthRequest, request: Request, db: Session = Depends(db_session)) -> dict[str, Any]:
    email = str(body.email).lower()
    ip = client_ip(request.scope)
    _enforce_limit(request, "social-cosmos:global:signin-minute", limit=300, window_seconds=60)
    _enforce_limit(request, protected_key("signin-ip", ip), limit=30, window_seconds=300)
    _enforce_limit(request, protected_key("signin-pair", f"{ip}\0{email}"), limit=10, window_seconds=300)
    _enforce_limit(request, protected_key("signin-email", email), limit=30, window_seconds=300)
    user = db.scalar(select(UserRow).where(
        UserRow.email == email,
        UserRow.deleted_at.is_(None),
    ))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    session = create_session(db, user.id)
    return {
        "session": {"userId": user.id, "token": session.token},
        **get_cosmos(db, user, semantic_similarity=request.app.state.semantic_similarity),
    }


@router.post("/api/auth/signout")
@router.post("/api/v1/auth/signout")
def signout(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(db_session),
) -> dict[str, bool]:
    token = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
    if token:
        db.execute(delete(SessionRow).where(SessionRow.token == token))
    return {"ok": True}

