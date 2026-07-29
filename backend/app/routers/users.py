from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.permissions import require_owner
from app.core.security import get_password_hash
from app.models.user import User
from app.routers.auth import user_to_response
from app.schemas.auth import PasswordResetRequest, UserResponse
from app.services.audit import log_activity

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[UserResponse]:
    users = db.query(User).order_by(User.id.asc()).all()
    return [user_to_response(u) for u in users]


@router.post(
    "/{user_id}/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def reset_user_password(
    user_id: int,
    payload: PasswordResetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_owner),
) -> Response:
    """Only the owner can change another user's password."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if target.id == current_user.id:
        raise HTTPException(
            status_code=400,
            detail="Свой пароль меняйте в настройках",
        )
    target.password_hash = get_password_hash(payload.new_password)
    log_activity(
        db,
        user=current_user,
        action="Сбросил пароль пользователя",
        entity_type="user",
        entity_id=target.id,
        entity_label=target.full_name or target.username,
        commit=True,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
