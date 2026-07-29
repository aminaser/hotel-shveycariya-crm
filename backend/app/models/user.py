from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UserRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"


ROLE_LABELS = {
    UserRole.owner: "Владелец",
    UserRole.admin: "Администратор",
}


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    role: Mapped[str] = mapped_column(String(32), nullable=False, default=UserRole.admin.value)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    @property
    def role_label(self) -> str:
        try:
            return ROLE_LABELS[UserRole(self.role)]
        except ValueError:
            return self.role

    @property
    def is_owner(self) -> bool:
        return self.role == UserRole.owner.value
