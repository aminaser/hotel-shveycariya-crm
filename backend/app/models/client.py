from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    iin: Mapped[Optional[str]] = mapped_column(String(12), nullable=True, index=True)
    bin: Mapped[Optional[str]] = mapped_column(String(12), nullable=True, index=True)
    client_type: Mapped[str] = mapped_column(String(16), default="individual", nullable=False)
    age: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    document_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
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

    stays = relationship("Stay", back_populates="client")
