from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

WORKPLACES = ("letnik", "bar", "banquet", "none")


class EmployeeBase(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    position: str = Field(default="официант", min_length=2, max_length=64)
    hourly_rate: Decimal = Field(default=Decimal("750"), ge=0)


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=255)
    position: str | None = Field(default=None, min_length=2, max_length=64)
    hourly_rate: Decimal | None = Field(default=None, ge=0)


class EmployeeResponse(EmployeeBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ShiftBase(BaseModel):
    employee_id: int
    work_date: date
    start_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    end_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    workplace: str = Field(pattern=r"^(letnik|bar|banquet|none)$")
    hourly_rate: Decimal | None = Field(default=None, ge=0)

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_time(cls, value: str) -> str:
        hour, minute = map(int, value.split(":"))
        if hour > 23 or minute > 59:
            raise ValueError("Некорректное время")
        return value


class ShiftCreate(ShiftBase):
    pass


class ShiftUpdate(BaseModel):
    employee_id: int | None = None
    work_date: date | None = None
    start_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    end_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    workplace: str | None = Field(default=None, pattern=r"^(letnik|bar|banquet|none)$")
    hourly_rate: Decimal | None = Field(default=None, ge=0)


class ShiftResponse(BaseModel):
    id: int
    employee_id: int
    employee_name: str
    position: str
    work_date: date
    start_time: str
    end_time: str
    workplace: str
    hourly_rate: Decimal
    hours_worked: Decimal
    earnings: Decimal
    created_at: datetime
    updated_at: datetime


class TimesheetDaySummary(BaseModel):
    work_date: date
    total_hours: Decimal
    total_salary: Decimal
    shifts: list[ShiftResponse]


class EmployeeWeekStat(BaseModel):
    employee_id: int
    employee_name: str
    position: str
    shifts_count: int
    total_hours: Decimal
    total_salary: Decimal


class TimesheetWeekSummary(BaseModel):
    date_from: date
    date_to: date
    total_hours: Decimal
    total_salary: Decimal
    shifts: list[ShiftResponse]
    by_employee: list[EmployeeWeekStat]
