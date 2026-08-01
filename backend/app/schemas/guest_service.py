from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

GuestServiceType = Literal["laundry_hotel", "laundry_own"]
PaymentStatus = Literal["paid", "partial", "unpaid"]


class GuestServiceBase(BaseModel):
    service_date: date
    service_type: GuestServiceType
    item_count: int = Field(ge=1, default=1)
    stay_id: Optional[int] = None
    client_id: Optional[int] = None
    room_id: Optional[int] = None
    guest_name: str = Field(min_length=1, max_length=255)
    room_number: Optional[str] = None
    payment_status: PaymentStatus = "unpaid"
    payment_method: Optional[str] = None
    payment_date: Optional[date] = None
    notes: Optional[str] = None


class GuestServiceCreate(GuestServiceBase):
    pass


class GuestServiceUpdate(BaseModel):
    service_date: Optional[date] = None
    service_type: Optional[GuestServiceType] = None
    item_count: Optional[int] = Field(default=None, ge=1)
    stay_id: Optional[int] = None
    client_id: Optional[int] = None
    room_id: Optional[int] = None
    guest_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    room_number: Optional[str] = None
    payment_status: Optional[PaymentStatus] = None
    payment_method: Optional[str] = None
    payment_date: Optional[date] = None
    notes: Optional[str] = None


class GuestServiceResponse(GuestServiceBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    unit_price: Decimal
    amount: Decimal
    created_at: datetime
    updated_at: datetime
    created_by_user_id: Optional[int] = None
    created_by_name: Optional[str] = None
    updated_by_user_id: Optional[int] = None
    updated_by_name: Optional[str] = None
