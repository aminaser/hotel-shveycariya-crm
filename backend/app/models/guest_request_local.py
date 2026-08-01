from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class GuestRequestLocal(Base):
    """Local mirror of Supabase requests (offline-first)."""

    __tablename__ = "guest_requests_local"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cloud_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    room: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    guest_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    type: Mapped[str] = mapped_column(String(64), nullable=False, default="other")
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    stage: Mapped[str] = mapped_column(String(32), default="received", nullable=False)
    language: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    photo_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    priority: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    updated_by_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    confirmed_by_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
