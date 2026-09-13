from __future__ import annotations

from typing import Annotated, Iterator
from datetime import datetime, timezone
import re

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db import UserRow
from app.security import session_user_id
from app.orbit_visit_models import OrbitReadOnlySessionRow, OrbitVisitRow


def db_session(request: Request) -> Iterator[Session]:
    with request.app.state.database.session() as db:
        authorization = request.headers.get('authorization', '')
        token = authorization[7:] if authorization.startswith('Bearer ') else ''
        guest = db.get(OrbitReadOnlySessionRow, token) if token else None
        if guest:
            visit = db.get(OrbitVisitRow, guest.visit_id)
            expiry = visit.expires_at if visit else None
            if expiry and expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            if not expiry or expiry <= datetime.now(timezone.utc):
                raise HTTPException(status_code=403, detail='This shared visit session has expired.')
            path = request.url.path.rstrip('/')
            shared = re.fullmatch(r'/api/orbit/visits/([^/]+)(?:/(join|state|heartbeat))?', path)
            own_logout = request.method == 'POST' and path in ('/api/auth/signout', '/api/v1/auth/signout')
            allowed_get = request.method == 'GET' and (
                path in ('/api/cosmos', '/api/v1/universe/window', '/api/v1/universe/snapshot', '/api/v1/planets/me/score', '/api/nebulae', '/api/v1/memories', '/api/v1/memory-signals', '/api/v1/users/me/intake')
                or re.fullmatch(r'/api/nebulae/[^/]+/space', path)
                or re.fullmatch(r'/api/v1/memories/[^/]+', path)
            )
            own_visit = shared and shared.group(1) == guest.visit_id and (
                request.method == 'GET' and shared.group(2) is None
                or request.method == 'POST' and shared.group(2) in ('state', 'heartbeat')
            )
            if not (own_logout or allowed_get or own_visit):
                raise HTTPException(status_code=403, detail='Shared visit sessions can explore memories but cannot modify this account.')
        yield db


def current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(db_session),
) -> UserRow:
    token = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
    user_id = session_user_id(db, token)
    user = db.get(UserRow, user_id) if user_id else None
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    return user
