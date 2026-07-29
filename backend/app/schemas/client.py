from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.models.room import RoomStatus
from app.models.stay import PaymentStatus, StayType
from app.services.validators import validate_bin, validate_iin


class ClientBase(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    phone: str | None = None
    iin: str | None = None
    bin: str | None = None
    client_type: str = Field(default="individual", pattern="^(individual|organization)$")
    age: int | None = Field(default=None, ge=0, le=150)
    date_of_birth: date | None = None
    document_number: str | None = None
    notes: str | None = None

    @field_validator("iin")
    @classmethod
    def check_iin(cls, value: str | None) -> str | None:
        return validate_iin(value)

    @field_validator("bin")
    @classmethod
    def check_bin(cls, value: str | None) -> str | None:
        return validate_bin(value)


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=255)
    phone: str | None = None
    iin: str | None = None
    bin: str | None = None
    client_type: str | None = Field(default=None, pattern="^(individual|organization)$")
    age: int | None = Field(default=None, ge=0, le=150)
    date_of_birth: date | None = None
    document_number: str | None = None
    notes: str | None = None

    @field_validator("iin")
    @classmethod
    def check_iin(cls, value: str | None) -> str | None:
        return validate_iin(value)

    @field_validator("bin")
    @classmethod
    def check_bin(cls, value: str | None) -> str | None:
        return validate_bin(value)


class ClientResponse(ClientBase):
    id: int
    created_at: datetime
    updated_at: datetime
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    updated_by_user_id: int | None = None
    updated_by_name: str | None = None

    model_config = {"from_attributes": True}


class StaySummary(BaseModel):
    id: int
    record_date: date
    stay_type: StayType
    payment_amount: Decimal
    payment_status: PaymentStatus
    payment_method: str | None
    room_number: str

    model_config = {"from_attributes": True}


class ClientDetailResponse(ClientResponse):
    stays: list[StaySummary] = []
