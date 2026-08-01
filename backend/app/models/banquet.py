from datetime import date, datetime
from decimal import Decimal
from typing import Optional
import enum

from sqlalchemy import Date, DateTime, Enum, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class BanquetPaymentStatus(str, enum.Enum):
    paid = "paid"
    partial = "partial"
    unpaid = "unpaid"


class Banquet(Base):
    __tablename__ = "banquets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cloud_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    event_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    event_time: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    guest_name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    venue: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    people_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    event_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    # Full amount due (menu total / Ас package).
    payment_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0"), nullable=False
    )
    # Amount already received when payment_status is partial.
    prepayment: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0"), nullable=False
    )
    payment_status: Mapped[BanquetPaymentStatus] = mapped_column(
        Enum(BanquetPaymentStatus),
        default=BanquetPaymentStatus.unpaid,
        nullable=False,
    )
    payment_method: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    payment_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
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
