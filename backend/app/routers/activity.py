from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.permissions import require_owner
from app.models.activity_log import ActivityLog
from app.models.user import User
from app.schemas.auth import ActivityLogResponse
from app.services.audit import log_activity

router = APIRouter(prefix="/activity", tags=["activity"])


class ActivityCreate(BaseModel):
    action: str = Field(min_length=1, max_length=255)
    entity_type: str | None = None
    entity_id: str | None = None
    entity_label: str | None = None
    old_value: str | None = None
    new_value: str | None = None


@router.get("", response_model=list[ActivityLogResponse])
def list_activity(
    limit: int = Query(default=200, ge=1, le=1000),
    user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[ActivityLog]:
    query = db.query(ActivityLog)
    if user_id is not None:
        query = query.filter(ActivityLog.user_id == user_id)
    return query.order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc()).limit(limit).all()


@router.post("", response_model=ActivityLogResponse, status_code=status.HTTP_201_CREATED)
def create_activity(
    payload: ActivityCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ActivityLog:
    entry = log_activity(
        db,
        user=current_user,
        action=payload.action,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        entity_label=payload.entity_label,
        old_value=payload.old_value,
        new_value=payload.new_value,
        commit=True,
    )
    return entry


@router.delete("", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def clear_activity(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_owner),
) -> Response:
    db.query(ActivityLog).delete()
    log_activity(
        db,
        user=current_user,
        action="Очистил журнал действий",
        entity_type="activity",
        commit=True,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
