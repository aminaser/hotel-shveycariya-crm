from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

TakeawayFulfillmentStatus = Literal["waiting", "picked_up"]


class TakeawayOrderBase(BaseModel):
    order_date: date
    order_time: Optional[str] = None
    guest_name: str = Field(min_length=1, max_length=255)
    phone: Optional[str] = None
    prepayment: Decimal = Decimal("0")
    payment_method: Optional[str] = None
    payment_date: Optional[date] = None
    fulfillment_status: TakeawayFulfillmentStatus = "waiting"
    dishes: Optional[str] = None
    notes: Optional[str] = None


class TakeawayOrderCreate(TakeawayOrderBase):
    pass


class TakeawayOrderUpdate(BaseModel):
    order_date: Optional[date] = None
    order_time: Optional[str] = None
    guest_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    phone: Optional[str] = None
    prepayment: Optional[Decimal] = None
    payment_method: Optional[str] = None
    payment_date: Optional[date] = None
    fulfillment_status: Optional[TakeawayFulfillmentStatus] = None
    dishes: Optional[str] = None
    notes: Optional[str] = None


class TakeawayOrderResponse(TakeawayOrderBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cloud_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    created_by_user_id: Optional[int] = None
    created_by_name: Optional[str] = None
    updated_by_user_id: Optional[int] = None
    updated_by_name: Optional[str] = None
