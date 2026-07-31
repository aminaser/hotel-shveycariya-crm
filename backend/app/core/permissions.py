from __future__ import annotations

from fastapi import Depends, HTTPException, status

from app.core.deps import get_current_user
from app.models.user import User, UserRole

# Owner tools (analytics, menu settings) are only for Жибек.
ANALYTICS_OWNER_USERNAME = "zhibek"


def require_owner(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.owner.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступно только владельцу",
        )
    return current_user


def require_analytics_owner(current_user: User = Depends(get_current_user)) -> User:
    """Analytics / menu settings: only Жибек (username zhibek)."""
    if (current_user.username or "").strip().lower() != ANALYTICS_OWNER_USERNAME:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступно только хозяйке Жибек",
        )
    return current_user
