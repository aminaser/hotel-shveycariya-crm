import enum
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, Enum, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class RoomStatus(str, enum.Enum):
    free = "free"
    occupied = "occupied"
    cleaning = "cleaning"
    maintenance = "maintenance"
    booked = "booked"


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    number: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    floor: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    room_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    price_per_night: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    status: Mapped[RoomStatus] = mapped_column(
        Enum(RoomStatus), default=RoomStatus.free, nullable=False
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status_updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cloud_id: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, unique=True, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    stays = relationship("Stay", back_populates="room")
