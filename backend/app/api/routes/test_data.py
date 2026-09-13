from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.application.graph_projection import project_graph_outbox
from app.application.test_data_cleanup import delete_synthetic_account
from app.db import UserRow
from app.schemas.test_data import SyntheticAccountDeleteRequest, SyntheticAccountDeletedView

from ..dependencies import current_user, db_session


router = APIRouter()


@router.delete("/api/v1/test-data/account", response_model=SyntheticAccountDeletedView)
def remove_synthetic_account(
    body: SyntheticAccountDeleteRequest,
    request: Request,
    user: UserRow = Depends(current_user),
    db: Session = Depends(db_session),
) -> SyntheticAccountDeletedView:
    if os.getenv("SOCIAL_COSMOS_TEST_CLEANUP_ENABLED", "").strip().lower() != "true":
        raise HTTPException(status_code=404, detail="Not found.")
    account_id = user.id
    audit = delete_synthetic_account(db, user, body)
    db.commit()
    with request.app.state.database.session() as projection_db:
        projection = project_graph_outbox(
            projection_db,
            request.app.state.graph_repository,
            owner_user_id=account_id,
        )
    return SyntheticAccountDeletedView(
        deleted=True,
        account_id=account_id,
        audit_id=audit.id,
        deleted_job_count=audit.deleted_job_count,
        deleted_conversation_count=audit.deleted_conversation_count,
        deleted_at=audit.deleted_at,
        graph_projection=projection,
    )
