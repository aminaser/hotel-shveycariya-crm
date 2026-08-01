from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.permissions import require_analytics_owner
from app.models.banquet import Banquet, BanquetPaymentStatus
from app.models.employee import Employee
from app.models.guest_service import GuestService
from app.models.room import Room, RoomStatus
from app.models.spa_booking_payment import SpaBookingPayment
from app.models.stay import PaymentStatus, Stay, StayType
from app.models.takeaway_order import TakeawayOrder
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
from app.services.payment_amount import received_banquet_amount, received_payment_amount
from app.services.room_service import today_local
from app.services.timesheet_calc import shift_earnings, shift_hours

router = APIRouter(prefix="/analytics", tags=["analytics"])

PRESET_METHODS = {"cash", "kaspi", "halyk"}


def _payment_day(stay: Stay) -> date | None:
    """Revenue day = payment_date only. Check-in/record_date never count as revenue day."""
    if stay.payment_status == PaymentStatus.unpaid:
        return None
    return stay.payment_date


def _add_method_amount(
    breakdown: PaymentBreakdown, method: str | None, amount: Decimal
) -> None:
    if amount <= 0:
        return
    key = method or "other"
    if key == "cash":
        breakdown.cash += amount
    elif key == "kaspi":
        breakdown.kaspi += amount
    elif key == "halyk":
        breakdown.halyk += amount
    else:
        breakdown.other += amount


def _payment_breakdown(stays: list[Stay]) -> PaymentBreakdown:
    breakdown = PaymentBreakdown()
    for stay in stays:
        amount = received_payment_amount(stay)
        if amount <= 0:
            continue
        _add_method_amount(breakdown, stay.payment_method, amount)
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

    paid_banquets = (
        db.query(Banquet)
        .filter(
            Banquet.deleted_at.is_(None),
            Banquet.payment_date.isnot(None),
            Banquet.payment_date >= date_from,
            Banquet.payment_date <= today,
            Banquet.payment_status.in_(
                [BanquetPaymentStatus.paid, BanquetPaymentStatus.partial]
            ),
        )
        .all()
    )

    paid_takeaways = (
        db.query(TakeawayOrder)
        .filter(
            TakeawayOrder.deleted_at.is_(None),
            TakeawayOrder.payment_date.isnot(None),
            TakeawayOrder.payment_date >= date_from,
            TakeawayOrder.payment_date <= today,
            TakeawayOrder.prepayment > 0,
        )
        .all()
    )

    paid_spa = (
        db.query(SpaBookingPayment)
        .filter(
            SpaBookingPayment.deleted_at.is_(None),
            SpaBookingPayment.payment_date.isnot(None),
            SpaBookingPayment.payment_date >= date_from,
            SpaBookingPayment.payment_date <= today,
            SpaBookingPayment.amount > 0,
        )
        .all()
    )

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

    banquet_revenue = Decimal("0")
    for banquet in paid_banquets:
        amount = received_banquet_amount(banquet)
        if amount <= 0 or banquet.payment_date is None:
            continue
        banquet_revenue += amount
        daily[banquet.payment_date]["revenue"] += amount

    takeaway_revenue = Decimal("0")
    for order in paid_takeaways:
        amount = order.prepayment or Decimal("0")
        if amount <= 0 or order.payment_date is None:
            continue
        takeaway_revenue += amount
        daily[order.payment_date]["revenue"] += amount

    spa_revenue = Decimal("0")
    for payment in paid_spa:
        amount = payment.amount or Decimal("0")
        if amount <= 0 or payment.payment_date is None:
            continue
        spa_revenue += amount
        daily[payment.payment_date]["revenue"] += amount

    guest_services = (
        db.query(GuestService)
        .filter(
            GuestService.deleted_at.is_(None),
            GuestService.service_date >= date_from,
            GuestService.service_date <= today,
        )
        .all()
    )
    paid_guest_services = [
        row
        for row in guest_services
        if row.payment_status == "paid" and row.payment_date is not None
    ]
    guest_service_revenue = Decimal("0")
    for row in paid_guest_services:
        amount = row.amount or Decimal("0")
        if amount <= 0 or row.payment_date is None:
            continue
        guest_service_revenue += amount
        daily[row.payment_date]["revenue"] += amount

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

    hotel_revenue = (
        sum((received_payment_amount(s) for s in paid_stays), Decimal("0"))
        + guest_service_revenue
    )
    total_revenue = hotel_revenue + banquet_revenue + takeaway_revenue + spa_revenue
    total_checkins = sum(
        1 for s in all_stays_in_period if s.stay_type in (StayType.booking, StayType.alumni)
    )
    total_checkouts = len(checkout_stays)
    outstanding_stays = [
        s
        for s in all_stays_in_period
        if s.payment_status in (PaymentStatus.unpaid, PaymentStatus.partial)
    ]
    unpaid_guest_services = [
        row for row in guest_services if row.payment_status != "paid"
    ]
    unpaid_amount = sum(
        (
            (s.payment_amount or Decimal("0")) - received_payment_amount(s)
            for s in outstanding_stays
        ),
        Decimal("0"),
    ) + sum(
        (row.amount or Decimal("0") for row in unpaid_guest_services),
        Decimal("0"),
    )
    unpaid_stays = outstanding_stays

    unpaid_banquets = (
        db.query(Banquet)
        .filter(
            Banquet.deleted_at.is_(None),
            Banquet.event_date >= date_from,
            Banquet.event_date <= today,
            Banquet.payment_status != BanquetPaymentStatus.paid,
        )
        .all()
    )
    unpaid_takeaways = (
        db.query(TakeawayOrder)
        .filter(
            TakeawayOrder.deleted_at.is_(None),
            TakeawayOrder.order_date >= date_from,
            TakeawayOrder.order_date <= today,
            TakeawayOrder.payment_date.is_(None),
        )
        .all()
    )
    unpaid_spa = (
        db.query(SpaBookingPayment)
        .filter(
            SpaBookingPayment.deleted_at.is_(None),
            SpaBookingPayment.amount > 0,
            SpaBookingPayment.payment_date.is_(None),
        )
        .count()
    )
    unpaid_extra_count = (
        len(unpaid_banquets) + len(unpaid_takeaways) + unpaid_spa + len(unpaid_guest_services)
    )

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

    payments_by_method = _payment_breakdown(paid_stays)
    for banquet in paid_banquets:
        _add_method_amount(
            payments_by_method,
            banquet.payment_method,
            received_banquet_amount(banquet),
        )
    for order in paid_takeaways:
        _add_method_amount(
            payments_by_method, order.payment_method, order.prepayment or Decimal("0")
        )
    for payment in paid_spa:
        _add_method_amount(
            payments_by_method, payment.payment_method, payment.amount or Decimal("0")
        )
    for row in paid_guest_services:
        _add_method_amount(
            payments_by_method, row.payment_method, row.amount or Decimal("0")
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
        unpaid_count=len(unpaid_stays) + unpaid_extra_count,
        payments_by_method=payments_by_method,
        hotel_revenue=hotel_revenue,
        banquet_revenue=banquet_revenue,
        takeaway_revenue=takeaway_revenue,
        spa_revenue=spa_revenue,
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
