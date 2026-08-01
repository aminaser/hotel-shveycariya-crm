from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class SpaBookingCreate(BaseModel):
    booking_date: date
    slot_time: str
    service: str
    guest_name: str
    guest_phone: Optional[str] = None
    room: Optional[str] = None
    is_hotel_guest: bool = False
    people_count: int = 1
    status: str = "confirmed"
    source: str = "crm"
    notes: Optional[str] = None
    price: Optional[Decimal] = None
    payment_method: Optional[str] = None
    payment_date: Optional[date] = None


class SpaBookingUpdate(BaseModel):
    booking_date: Optional[date] = None
    slot_time: Optional[str] = None
    service: Optional[str] = None
    guest_name: Optional[str] = None
    guest_phone: Optional[str] = None
    room: Optional[str] = None
    is_hotel_guest: Optional[bool] = None
    people_count: Optional[int] = None
    status: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    price: Optional[Decimal] = None
    payment_method: Optional[str] = None
    payment_date: Optional[date] = None
    request_id: Optional[str] = None


class SpaBookingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None
    booking_date: date
    slot_time: str
    service: str
    guest_name: str
    guest_phone: Optional[str] = None
    room: Optional[str] = None
    is_hotel_guest: bool
    people_count: int
    status: str
    source: str
    request_id: Optional[str] = None
    notes: Optional[str] = None
    price: Optional[Decimal] = None
    payment_method: Optional[str] = None
    payment_date: Optional[date] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None


class GuestRequestUpdate(BaseModel):
    stage: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    deleted_at: Optional[datetime] = Field(default=None)


class GuestRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None
    room: Optional[str] = None
    guest_name: Optional[str] = None
    type: str
    title: Optional[str] = None
    description: Optional[str] = None
    stage: str
    language: Optional[str] = None
    photo_url: Optional[str] = None
    priority: Optional[str] = None
    rating: Optional[int] = None
    source: Optional[str] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None
    confirmed_by_name: Optional[str] = None


class SyncStatusResponse(BaseModel):
    online: bool
    syncing: bool
    last_sync_at: Optional[str] = None
    last_error: Optional[str] = None
    pending_outbox: int = 0
