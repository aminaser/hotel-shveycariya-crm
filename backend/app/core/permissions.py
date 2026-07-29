from __future__ import annotations

from fastapi import Depends, HTTPException, status

from app.core.deps import get_current_user
from app.models.user import User, UserRole


def require_owner(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.owner.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступно только владельцу",
        )
    return current_user
