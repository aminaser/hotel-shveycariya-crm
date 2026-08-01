from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SpaBookingLocal(Base):
    """Local mirror of Supabase spa_bookings (offline-first)."""

    __tablename__ = "spa_bookings_local"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cloud_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    booking_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    slot_time: Mapped[str] = mapped_column(String(16), nullable=False)
    service: Mapped[str] = mapped_column(String(32), nullable=False)
    guest_name: Mapped[str] = mapped_column(String(255), nullable=False)
    guest_phone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    room: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    is_hotel_guest: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    people_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="confirmed", nullable=False)
    source: Mapped[str] = mapped_column(String(32), default="crm", nullable=False)
    request_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    price: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    payment_method: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    payment_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    updated_by_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
