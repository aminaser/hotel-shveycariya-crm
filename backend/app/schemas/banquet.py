from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class BanquetBase(BaseModel):
    event_date: date
    event_time: Optional[str] = None
    guest_name: str = Field(min_length=1, max_length=255)
    phone: Optional[str] = None
    venue: Optional[str] = None
    people_count: int = Field(default=1, ge=1)
    event_type: Optional[str] = None
    prepayment: Decimal = Decimal("0")
    payment_method: Optional[str] = None
    payment_date: Optional[date] = None
    dishes: Optional[str] = None
    notes: Optional[str] = None


class BanquetCreate(BanquetBase):
    pass


class BanquetUpdate(BaseModel):
    event_date: Optional[date] = None
    event_time: Optional[str] = None
    guest_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    phone: Optional[str] = None
    venue: Optional[str] = None
    people_count: Optional[int] = Field(default=None, ge=1)
    event_type: Optional[str] = None
    prepayment: Optional[Decimal] = None
    payment_method: Optional[str] = None
    payment_date: Optional[date] = None
    dishes: Optional[str] = None
    notes: Optional[str] = None


class BanquetResponse(BanquetBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    created_by_user_id: Optional[int] = None
    created_by_name: Optional[str] = None
    updated_by_user_id: Optional[int] = None
    updated_by_name: Optional[str] = None
