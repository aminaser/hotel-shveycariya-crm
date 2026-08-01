from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.room import RoomStatus
from app.models.stay import PaymentStatus, StayType


class RoomResponse(BaseModel):
    id: int
    number: str
    floor: int | None
    room_type: str | None
    price_per_night: Decimal | None = None
    status: RoomStatus
    notes: str | None
    current_guest: str | None = None
    status_updated_at: datetime | None = None
    stay_id: int | None = None
    guest_phone: str | None = None
    check_in: date | None = None
    planned_check_out: date | None = None
    check_out: date | None = None
    stay_updated_at: datetime | None = None
    payment_status: PaymentStatus | None = None
    payment_amount: Decimal | None = None

    model_config = {"from_attributes": True}


class RoomUpdate(BaseModel):
    floor: int | None = None
    room_type: str | None = None
    price_per_night: Decimal | None = Field(default=None, ge=0)
    status: RoomStatus | None = None
    notes: str | None = None


class StayBase(BaseModel):
    client_id: int
    room_id: int
    record_date: date
    stay_type: StayType
    check_in: date | None = None
    planned_check_out: date | None = None
    people_count: int = Field(default=1, ge=1, le=500)
    payment_amount: Decimal = Field(default=Decimal("0"), ge=0)
    prepayment: Decimal = Field(default=Decimal("0"), ge=0)
    payment_status: PaymentStatus = PaymentStatus.unpaid
    payment_method: str | None = Field(default=None, max_length=64)
    payment_date: date | None = None
    group_id: str | None = Field(default=None, max_length=36)
    extra_bedding: bool = False
    notes: str | None = None


class StayCreate(StayBase):
    pass


class StayUpdate(BaseModel):
    client_id: int | None = None
    room_id: int | None = None
    record_date: date | None = None
    stay_type: StayType | None = None
    check_in: date | None = None
    planned_check_out: date | None = None
    check_out: date | None = None
    people_count: int | None = Field(default=None, ge=1, le=500)
    payment_amount: Decimal | None = Field(default=None, ge=0)
    prepayment: Decimal | None = Field(default=None, ge=0)
    payment_status: PaymentStatus | None = None
    payment_method: str | None = Field(default=None, max_length=64)
    payment_date: date | None = None
    group_id: str | None = Field(default=None, max_length=36)
    extra_bedding: bool | None = None
    notes: str | None = None


class CheckoutRequest(BaseModel):
    check_out: date | None = None


class StayResponse(BaseModel):
    id: int
    client_id: int
    room_id: int
    record_date: date
    stay_type: StayType
    check_in: date | None
    planned_check_out: date | None
    check_out: date | None
    people_count: int = 1
    payment_amount: Decimal
    prepayment: Decimal = Decimal("0")
    payment_status: PaymentStatus
    payment_method: str | None
    payment_date: date | None = None
    group_id: str | None = None
    extra_bedding: bool = False
    notes: str | None
    checked_in_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    client_name: str
    client_phone: str | None
    client_iin: str | None = None
    room_number: str
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    updated_by_user_id: int | None = None
    updated_by_name: str | None = None
    # True when the guest is treated as physically in the room now.
    in_room: bool = False

    model_config = {"from_attributes": True}


class PaymentBreakdown(BaseModel):
    cash: Decimal = Decimal("0")
    kaspi: Decimal = Decimal("0")
    halyk: Decimal = Decimal("0")
    other: Decimal = Decimal("0")


class RegistrySummary(BaseModel):
    today_checkins: int
    today_payments_kzt: Decimal
    today_checkouts: int
    occupied_rooms: int
    total_rooms: int
    total_records: int
    payments_by_method: PaymentBreakdown
