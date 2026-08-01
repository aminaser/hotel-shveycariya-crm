import enum
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class StayType(str, enum.Enum):
    booking = "booking"
    extension = "extension"
    alumni = "alumni"


class PaymentStatus(str, enum.Enum):
    paid = "paid"
    partial = "partial"
    unpaid = "unpaid"


class Stay(Base):
    __tablename__ = "stays"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"), nullable=False)
    record_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    stay_type: Mapped[StayType] = mapped_column(Enum(StayType), nullable=False)
    check_in: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # Planned departure date (filled in the form). Actual checkout clears the room
    # and is stored in check_out when staff presses «Выезд».
    planned_check_out: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    check_out: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # Guests in package (e.g. alumni meeting at fixed price per person).
    people_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    payment_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0"), nullable=False
    )
    # Amount already received when payment_status is partial.
    prepayment: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0"), nullable=False
    )
    payment_status: Mapped[PaymentStatus] = mapped_column(
        Enum(PaymentStatus), default=PaymentStatus.unpaid, nullable=False
    )
    payment_method: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    payment_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    # Shared id when several rooms were booked together in one journal submit.
    group_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cloud_id: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, unique=True, index=True
    )
    # Set when staff confirms arrival (Rooms: booked→occupied / walk-in).
    # Until then, a booking for today stays «бронь» even after 13:00.
    checked_in_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
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

    client = relationship("Client", back_populates="stays")
    room = relationship("Room", back_populates="stays")
