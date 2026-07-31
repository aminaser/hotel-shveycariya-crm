from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.permissions import require_analytics_owner
from app.models.employee import Employee
from app.models.room import Room, RoomStatus
from app.models.stay import PaymentStatus, Stay, StayType
from app.models.timesheet_shift import TimesheetShift
from app.models.user import User
from app.schemas.analytics import (
    AnalyticsResponse,
    AnalyticsSummary,
    ClientStat,
    DailyPoint,
    EmployeeSalaryStat,
    RoomStat,
)
from app.schemas.stay import PaymentBreakdown
from app.services.payment_amount import received_payment_amount
from app.services.room_service import today_local
from app.services.timesheet_calc import shift_earnings, shift_hours

router = APIRouter(prefix="/analytics", tags=["analytics"])

PRESET_METHODS = {"cash", "kaspi", "halyk"}


def _payment_day(stay: Stay) -> date | None:
    """Revenue day = payment_date only. Check-in/record_date never count as revenue day."""
    if stay.payment_status == PaymentStatus.unpaid:
        return None
    return stay.payment_date


def _payment_breakdown(stays: list[Stay]) -> PaymentBreakdown:
    breakdown = PaymentBreakdown()
    for stay in stays:
        amount = received_payment_amount(stay)
        if amount <= 0:
            continue
        method = stay.payment_method or "other"
        if method == "cash":
            breakdown.cash += amount
        elif method == "kaspi":
            breakdown.kaspi += amount
        elif method == "halyk":
            breakdown.halyk += amount
        else:
            breakdown.other += amount
    return breakdown


@router.get("", response_model=AnalyticsResponse)
def get_analytics(
    period: int = Query(default=30, ge=1, le=365),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_analytics_owner),
) -> AnalyticsResponse:
    # Explicit range takes priority over the preset period.
    if date_from is not None:
        range_end = date_to or date_from
        if range_end < date_from:
            date_from, range_end = range_end, date_from
        today = range_end
    else:
        today = today_local()
        date_from = today - timedelta(days=period - 1)
    period = (today - date_from).days + 1

    # Stays for occupancy / check-ins in the period (by booking record_date).
    stays = (
        db.query(Stay)
        .options(joinedload(Stay.client), joinedload(Stay.room))
        .filter(
            Stay.deleted_at.is_(None),
            Stay.record_date >= date_from,
            Stay.record_date <= today,
        )
        .all()
    )

    # Revenue attributed strictly by payment_date (not booking / check-in date).
    revenue_candidates = (
        db.query(Stay)
        .options(joinedload(Stay.client), joinedload(Stay.room))
        .filter(
            Stay.deleted_at.is_(None),
            Stay.payment_status.in_([PaymentStatus.paid, PaymentStatus.partial]),
            Stay.payment_date.isnot(None),
            Stay.payment_date >= date_from,
            Stay.payment_date <= today,
        )
        .all()
    )
    paid_stays = list(revenue_candidates)

    all_stays_in_period = stays

    daily: dict = defaultdict(
        lambda: {
            "revenue": Decimal("0"),
            "salary_expense": Decimal("0"),
            "checkins": 0,
            "checkouts": 0,
            "stays_count": 0,
        }
    )

    for stay in all_stays_in_period:
        key = stay.record_date
        daily[key]["stays_count"] += 1
        if stay.stay_type in (StayType.booking, StayType.alumni):
            daily[key]["checkins"] += 1

    for stay in paid_stays:
        day = _payment_day(stay)
        if day is not None:
            daily[day]["revenue"] += received_payment_amount(stay)

    checkout_stays = (
        db.query(Stay)
        .filter(
            Stay.deleted_at.is_(None),
            Stay.check_out.isnot(None),
            Stay.check_out >= date_from,
            Stay.check_out <= today,
        )
        .all()
    )
    for stay in checkout_stays:
        if stay.check_out:
            daily[stay.check_out]["checkouts"] += 1

    shifts = (
        db.query(TimesheetShift)
        .options(joinedload(TimesheetShift.employee))
        .join(Employee)
        .filter(
            TimesheetShift.work_date >= date_from,
            TimesheetShift.work_date <= today,
            Employee.deleted_at.is_(None),
        )
        .all()
    )

    employee_salary_stats: dict[int, dict] = defaultdict(
        lambda: {
            "name": "",
            "position": "",
            "hours": Decimal("0"),
            "earnings": Decimal("0"),
            "shifts": 0,
        }
    )

    for shift in shifts:
        hours = shift_hours(shift.start_time, shift.end_time)
        earnings = shift_earnings(hours, shift.hourly_rate)
        daily[shift.work_date]["salary_expense"] += earnings
        employee_salary_stats[shift.employee_id]["name"] = shift.employee.full_name
        employee_salary_stats[shift.employee_id]["position"] = shift.employee.position
        employee_salary_stats[shift.employee_id]["hours"] += hours
        employee_salary_stats[shift.employee_id]["earnings"] += earnings
        employee_salary_stats[shift.employee_id]["shifts"] += 1

    daily_points: list[DailyPoint] = []
    cursor = date_from
    while cursor <= today:
        point = daily[cursor]
        daily_points.append(
            DailyPoint(
                date=cursor,
                revenue=point["revenue"],
                salary_expense=point["salary_expense"],
                checkins=point["checkins"],
                checkouts=point["checkouts"],
                stays_count=point["stays_count"],
            )
        )
        cursor += timedelta(days=1)

    total_revenue = sum((received_payment_amount(s) for s in paid_stays), Decimal("0"))
    total_checkins = sum(
        1 for s in all_stays_in_period if s.stay_type in (StayType.booking, StayType.alumni)
    )
    total_checkouts = len(checkout_stays)
    outstanding_stays = [
        s
        for s in all_stays_in_period
        if s.payment_status in (PaymentStatus.unpaid, PaymentStatus.partial)
    ]
    unpaid_amount = sum(
        (
            (s.payment_amount or Decimal("0")) - received_payment_amount(s)
            for s in outstanding_stays
        ),
        Decimal("0"),
    )
    unpaid_stays = outstanding_stays

    total_rooms = db.query(Room).count() or 1
    occupied = db.query(Room).filter(Room.status == RoomStatus.occupied).count()
    occupancy_rate = round(occupied / total_rooms * 100, 1)

    room_stats: dict[int, dict] = defaultdict(
        lambda: {"revenue": Decimal("0"), "count": 0, "number": ""}
    )
    for stay in paid_stays:
        room_stats[stay.room_id]["revenue"] += received_payment_amount(stay)
        room_stats[stay.room_id]["count"] += 1
        room_stats[stay.room_id]["number"] = stay.room.number

    top_rooms = sorted(
        [
            RoomStat(
                room_number=data["number"],
                revenue=data["revenue"],
                stays_count=data["count"],
            )
            for data in room_stats.values()
            if data["number"]
        ],
        key=lambda r: r.revenue,
        reverse=True,
    )[:8]

    client_stats: dict[int, dict] = defaultdict(
        lambda: {"visits": 0, "revenue": Decimal("0"), "name": ""}
    )
    for stay in all_stays_in_period:
        client_stats[stay.client_id]["visits"] += 1
        client_stats[stay.client_id]["name"] = stay.client.full_name
    for stay in paid_stays:
        client_stats[stay.client_id]["revenue"] += received_payment_amount(stay)
        client_stats[stay.client_id]["name"] = stay.client.full_name

    top_clients = sorted(
        [
            ClientStat(
                client_name=data["name"],
                visits=data["visits"],
                revenue=data["revenue"],
            )
            for data in client_stats.values()
            if data["name"]
        ],
        key=lambda c: c.revenue,
        reverse=True,
    )[:8]

    avg_daily = total_revenue / period if period else Decimal("0")
    total_salary_expense = sum((point.salary_expense for point in daily_points), Decimal("0"))
    avg_daily_salary = total_salary_expense / period if period else Decimal("0")

    salary_by_employee = sorted(
        [
            EmployeeSalaryStat(
                employee_name=data["name"],
                position=data["position"],
                hours_worked=data["hours"],
                earnings=data["earnings"],
                shifts_count=data["shifts"],
            )
            for data in employee_salary_stats.values()
            if data["name"]
        ],
        key=lambda item: item.earnings,
        reverse=True,
    )

    summary = AnalyticsSummary(
        period_days=period,
        date_from=date_from,
        date_to=today,
        total_revenue=total_revenue,
        total_checkins=total_checkins,
        total_checkouts=total_checkouts,
        avg_daily_revenue=avg_daily.quantize(Decimal("0.01")),
        total_salary_expense=total_salary_expense,
        avg_daily_salary=avg_daily_salary.quantize(Decimal("0.01")),
        occupancy_rate=occupancy_rate,
        unpaid_amount=unpaid_amount,
        unpaid_count=len(unpaid_stays),
        payments_by_method=_payment_breakdown(paid_stays),
        bookings_count=sum(1 for s in all_stays_in_period if s.stay_type == StayType.booking),
        extensions_count=sum(
            1 for s in all_stays_in_period if s.stay_type == StayType.extension
        ),
        alumni_count=sum(1 for s in all_stays_in_period if s.stay_type == StayType.alumni),
    )

    return AnalyticsResponse(
        summary=summary,
        daily=daily_points,
        top_rooms=top_rooms,
        top_clients=top_clients,
        salary_by_employee=salary_by_employee,
    )
