from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Date, DateTime, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# Laundry: hotel powder / guest's own powder (₸ per item).
LAUNDRY_HOTEL_PRICE = Decimal("1000")
LAUNDRY_OWN_POWDER_PRICE = Decimal("500")


class GuestService(Base):
    """Paid hotel guest extras (laundry, etc.)."""

    __tablename__ = "guest_services"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    service_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    service_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    item_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0"), nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0"), nullable=False
    )
    stay_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    client_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    room_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    guest_name: Mapped[str] = mapped_column(String(255), nullable=False)
    room_number: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    payment_status: Mapped[str] = mapped_column(
        String(32), default="unpaid", nullable=False
    )
    payment_method: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    payment_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cloud_id: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, unique=True, index=True
    )
    created_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_by_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    updated_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    updated_by_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
