from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hotel_name: Mapped[str] = mapped_column(String(128), default="Швейцария")
    hotel_city: Mapped[str] = mapped_column(String(128), default="Текели")
    hotel_legal_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    hotel_bin: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    hotel_address: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    hotel_director: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    act_next_number: Mapped[int] = mapped_column(Integer, default=1)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Almaty")
    currency: Mapped[str] = mapped_column(String(8), default="KZT")
    last_backup_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    auto_lock_minutes: Mapped[int] = mapped_column(Integer, default=15)
    auto_backup_on_exit: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
