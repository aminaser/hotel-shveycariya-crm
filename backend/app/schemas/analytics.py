from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel

from app.schemas.stay import PaymentBreakdown


class DailyPoint(BaseModel):
    date: date
    revenue: Decimal
    salary_expense: Decimal
    checkins: int
    checkouts: int
    stays_count: int


class RoomStat(BaseModel):
    room_number: str
    revenue: Decimal
    stays_count: int


class ClientStat(BaseModel):
    client_name: str
    visits: int
    revenue: Decimal


class EmployeeSalaryStat(BaseModel):
    employee_name: str
    position: str
    hours_worked: Decimal
    earnings: Decimal
    shifts_count: int


class AnalyticsSummary(BaseModel):
    period_days: int
    date_from: date
    date_to: date
    total_revenue: Decimal
    total_checkins: int
    total_checkouts: int
    avg_daily_revenue: Decimal
    total_salary_expense: Decimal
    avg_daily_salary: Decimal
    occupancy_rate: float
    unpaid_amount: Decimal
    unpaid_count: int
    payments_by_method: PaymentBreakdown
    bookings_count: int
    extensions_count: int
    alumni_count: int = 0


class AnalyticsResponse(BaseModel):
    summary: AnalyticsSummary
    daily: list[DailyPoint]
    top_rooms: list[RoomStat]
    top_clients: list[ClientStat]
    salary_by_employee: list[EmployeeSalaryStat]
