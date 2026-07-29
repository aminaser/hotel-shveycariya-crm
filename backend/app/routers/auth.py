from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import create_access_token, verify_password
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse, UserResponse
from app.services.audit import log_activity

router = APIRouter(prefix="/auth", tags=["auth"])


def user_to_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        username=user.username,
        full_name=user.full_name or user.username,
        role=user.role,
        role_label=user.role_label,
        created_at=user.created_at,
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter(User.username == payload.username.strip()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль.",
        )
    token = create_access_token(user.username)
    log_activity(
        db,
        user=user,
        action="Вход в систему",
        entity_type="auth",
        commit=True,
    )
    return TokenResponse(access_token=token, user=user_to_response(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def logout(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    log_activity(
        db,
        user=current_user,
        action="Выход из системы",
        entity_type="auth",
        commit=True,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return user_to_response(current_user)
