from datetime import date, datetime
from decimal import Decimal
from typing import Optional
import enum

from sqlalchemy import Date, DateTime, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TakeawayFulfillmentStatus(str, enum.Enum):
    waiting = "waiting"
    picked_up = "picked_up"


class TakeawayOrder(Base):
    __tablename__ = "takeaway_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cloud_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    order_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    order_time: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    guest_name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    prepayment: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0"), nullable=False
    )
    payment_method: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    payment_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    # waiting | picked_up — stored as plain string for SQLite-friendly migrations.
    fulfillment_status: Mapped[str] = mapped_column(
        String(32),
        default=TakeawayFulfillmentStatus.waiting.value,
        nullable=False,
    )
    dishes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
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
