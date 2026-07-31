from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class SpaBookingPaymentUpsert(BaseModel):
    booking_id: str = Field(min_length=1, max_length=64)
    amount: Decimal = Decimal("0")
    payment_method: Optional[str] = None
    payment_date: Optional[date] = None


class SpaBookingPaymentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    booking_id: str
    amount: Decimal
    payment_method: Optional[str] = None
    payment_date: Optional[date] = None
    deleted_at: Optional[datetime] = None
    updated_at: datetime
