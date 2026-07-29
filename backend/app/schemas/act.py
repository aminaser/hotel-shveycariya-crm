from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.validators import validate_bin, validate_iin


class ActLineItemInput(BaseModel):
    description: str = Field(min_length=1, max_length=512)
    service_date: str = Field(min_length=1, max_length=128)
    unit: str = Field(default="услуга", max_length=32)
    quantity: Decimal = Field(gt=0)
    unit_price: Decimal = Field(ge=0)
    amount: Decimal | None = Field(default=None, ge=0)
    vat_amount: Decimal = Field(default=Decimal("0"), ge=0)

    @model_validator(mode="after")
    def fill_amount(self) -> ActLineItemInput:
        if self.amount is None:
            self.amount = (self.quantity * self.unit_price).quantize(Decimal("1"))
        return self


class ActLineItem(BaseModel):
    line_no: int
    description: str
    service_date: str
    unit: str
    quantity: Decimal
    unit_price: Decimal
    amount: Decimal
    vat_amount: Decimal = Decimal("0")
    stay_id: int | None = None


class ActParty(BaseModel):
    name: str
    identifier_label: str
    identifier: str
    address: str | None = None
    iban: str | None = None


class ActDocument(BaseModel):
    act_number: str
    act_date: date
    executor: ActParty
    customer: ActParty
    contract_number: str | None
    line_items: list[ActLineItem]
    total_quantity: Decimal
    total_amount: Decimal
    total_vat: Decimal
    total_amount_words: str
    currency: str = "KZT"


class ActLookupResponse(BaseModel):
    found: bool
    client_id: int | None = None
    full_name: str | None = None
    iin: str | None = None
    bin: str | None = None
    client_type: str | None = None
    phone: str | None = None


class ActNextNumberResponse(BaseModel):
    next_number: int


class ActJournalLinesRequest(BaseModel):
    recipient_type: Literal["individual", "organization"]
    iin: str | None = None
    bin: str | None = None
    client_id: int | None = None
    date_from: date
    date_to: date
    stay_ids: list[int] | None = None

    @field_validator("iin")
    @classmethod
    def check_iin(cls, value: str | None) -> str | None:
        return validate_iin(value)

    @field_validator("bin")
    @classmethod
    def check_bin(cls, value: str | None) -> str | None:
        return validate_bin(value)

    @model_validator(mode="after")
    def validate_period(self) -> ActJournalLinesRequest:
        if self.date_to < self.date_from:
            raise ValueError("Дата окончания не может быть раньше даты начала")
        return self


class ActJournalLinesResponse(BaseModel):
    line_items: list[ActLineItem]


class ActPreviewRequest(BaseModel):
    recipient_type: Literal["individual", "organization"]
    iin: str | None = None
    bin: str | None = None
    client_id: int | None = None
    customer_name: str | None = Field(default=None, max_length=255)
    customer_address: str | None = Field(default=None, max_length=512)
    customer_iban: str | None = Field(default=None, max_length=256)
    date_from: date | None = None
    date_to: date | None = None
    act_date: date | None = None
    act_number: str | None = Field(default=None, max_length=32)
    contract_number: str | None = Field(default=None, max_length=128)
    line_items: list[ActLineItemInput] | None = None
    stay_ids: list[int] | None = None
    use_journal: bool = False

    @field_validator("iin")
    @classmethod
    def check_iin(cls, value: str | None) -> str | None:
        return validate_iin(value)

    @field_validator("bin")
    @classmethod
    def check_bin(cls, value: str | None) -> str | None:
        return validate_bin(value)

    @model_validator(mode="after")
    def validate_request(self) -> ActPreviewRequest:
        has_manual_lines = bool(self.line_items)
        if self.use_journal:
            if not self.date_from or not self.date_to:
                raise ValueError("Укажите период для заполнения из журнала")
            if self.date_to < self.date_from:
                raise ValueError("Дата окончания не может быть раньше даты начала")
        elif not has_manual_lines:
            raise ValueError("Добавьте хотя бы одну строку услуги")
        return self
