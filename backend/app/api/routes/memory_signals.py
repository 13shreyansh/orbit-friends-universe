from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.application.memory_sharing import (
    close_memory_signal,
    list_memory_signals,
    mark_memory_signal_read,
)
from app.db import UserRow

from ..dependencies import current_user, db_session


router = APIRouter()


@router.get("/api/v1/memory-signals")
def memory_signal_list(
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict:
    return {"signals": list_memory_signals(db, user)}


@router.post("/api/v1/memory-signals/{signal_id}/read")
def memory_signal_read(
    signal_id: str,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict:
    result = mark_memory_signal_read(db, user, signal_id)
    db.commit()
    return {"signal": result}


@router.post("/api/v1/memory-signals/{signal_id}/close")
def memory_signal_close(
    signal_id: str,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> dict:
    result = close_memory_signal(db, user, signal_id)
    db.commit()
    return {"signal": result}
