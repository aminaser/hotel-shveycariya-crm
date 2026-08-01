from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.permissions import require_analytics_owner
from app.models.employee import Employee
from app.models.timesheet_shift import TimesheetShift
from app.models.user import User
from app.schemas.timesheet import (
    EmployeeCreate,
    EmployeeResponse,
    EmployeeUpdate,
    EmployeeWeekStat,
    ShiftCreate,
    ShiftResponse,
    ShiftUpdate,
    TimesheetDaySummary,
    TimesheetWeekSummary,
)
from app.services.timesheet_calc import shift_earnings, shift_hours
from app.services.room_service import today_local
from app.services.supabase_crm_sync import ensure_cloud_id, queue_entity_sync

router = APIRouter(tags=["timesheet"])


def _active_employees(db: Session):
    return db.query(Employee).filter(Employee.deleted_at.is_(None))


def _active_shifts(db: Session):
    return db.query(TimesheetShift).filter(TimesheetShift.deleted_at.is_(None))


def _shift_response(shift: TimesheetShift) -> ShiftResponse:
    hours = shift_hours(shift.start_time, shift.end_time)
    rate = shift.hourly_rate
    return ShiftResponse(
        id=shift.id,
        employee_id=shift.employee_id,
        employee_name=shift.employee.full_name,
        position=shift.employee.position,
        work_date=shift.work_date,
        start_time=shift.start_time,
        end_time=shift.end_time,
        workplace=shift.workplace,
        hourly_rate=rate,
        hours_worked=hours,
        earnings=shift_earnings(hours, rate),
        created_at=shift.created_at,
        updated_at=shift.updated_at,
    )


@router.get("/employees", response_model=list[EmployeeResponse])
def list_employees(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[Employee]:
    return _active_employees(db).order_by(Employee.full_name.asc()).all()


@router.post("/employees", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_analytics_owner),
) -> Employee:
    employee = Employee(**payload.model_dump())
    db.add(employee)
    ensure_cloud_id(employee)
    db.commit()
    db.refresh(employee)
    queue_entity_sync("employees", employee)
    return employee


@router.patch("/employees/{employee_id}", response_model=EmployeeResponse)
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_analytics_owner),
) -> Employee:
    employee = _active_employees(db).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(employee, key, value)
    ensure_cloud_id(employee)
    db.commit()
    db.refresh(employee)
    queue_entity_sync("employees", employee)
    return employee


@router.delete("/employees/{employee_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_analytics_owner),
) -> Response:
    employee = _active_employees(db).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    employee.deleted_at = datetime.now(timezone.utc)
    ensure_cloud_id(employee)
    db.commit()
    queue_entity_sync("employees", employee, soft_delete=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.get("/timesheet", response_model=TimesheetDaySummary)
def get_timesheet_day(
    work_date: date = Query(default_factory=today_local),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> TimesheetDaySummary:
    shifts = (
        db.query(TimesheetShift)
        .join(Employee)
        .filter(
            TimesheetShift.work_date == work_date,
            TimesheetShift.deleted_at.is_(None),
            Employee.deleted_at.is_(None),
        )
        .order_by(TimesheetShift.start_time.asc(), Employee.full_name.asc())
        .all()
    )
    responses = [_shift_response(shift) for shift in shifts]
    total_hours = sum((item.hours_worked for item in responses), Decimal("0"))
    total_salary = sum((item.earnings for item in responses), Decimal("0"))
    return TimesheetDaySummary(
        work_date=work_date,
        total_hours=total_hours,
        total_salary=total_salary,
        shifts=responses,
    )


@router.get("/timesheet/week", response_model=TimesheetWeekSummary)
def get_timesheet_week(
    date_from: date = Query(...),
    date_to: date = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> TimesheetWeekSummary:
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="date_to не может быть раньше date_from")
    if (date_to - date_from).days > 45:
        raise HTTPException(status_code=400, detail="Период не больше 45 дней")

    shifts = (
        db.query(TimesheetShift)
        .join(Employee)
        .filter(
            TimesheetShift.work_date >= date_from,
            TimesheetShift.work_date <= date_to,
            TimesheetShift.deleted_at.is_(None),
            Employee.deleted_at.is_(None),
        )
        .order_by(
            TimesheetShift.work_date.asc(),
            TimesheetShift.start_time.asc(),
            Employee.full_name.asc(),
        )
        .all()
    )
    responses = [_shift_response(shift) for shift in shifts]
    total_hours = sum((item.hours_worked for item in responses), Decimal("0"))
    total_salary = sum((item.earnings for item in responses), Decimal("0"))

    by_emp: dict[int, EmployeeWeekStat] = {}
    for item in responses:
        row = by_emp.get(item.employee_id)
        if row is None:
            by_emp[item.employee_id] = EmployeeWeekStat(
                employee_id=item.employee_id,
                employee_name=item.employee_name,
                position=item.position,
                shifts_count=1,
                total_hours=item.hours_worked,
                total_salary=item.earnings,
            )
        else:
            row.shifts_count += 1
            row.total_hours += item.hours_worked
            row.total_salary += item.earnings

    by_employee = sorted(
        by_emp.values(),
        key=lambda row: (-row.total_salary, row.employee_name),
    )
    return TimesheetWeekSummary(
        date_from=date_from,
        date_to=date_to,
        total_hours=total_hours,
        total_salary=total_salary,
        shifts=responses,
        by_employee=by_employee,
    )


@router.post("/timesheet", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED)
def create_shift(
    payload: ShiftCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ShiftResponse:
    employee = _active_employees(db).filter(Employee.id == payload.employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    try:
        shift_hours(payload.start_time, payload.end_time)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    hourly_rate = payload.hourly_rate if payload.hourly_rate is not None else employee.hourly_rate
    shift = TimesheetShift(
        employee_id=payload.employee_id,
        work_date=payload.work_date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        workplace=payload.workplace,
        hourly_rate=hourly_rate,
    )
    db.add(shift)
    ensure_cloud_id(employee)
    ensure_cloud_id(shift)
    db.commit()
    db.refresh(shift)
    queue_entity_sync("employees", employee)
    queue_entity_sync("timesheet_shifts", shift)
    return _shift_response(shift)


@router.patch("/timesheet/{shift_id}", response_model=ShiftResponse)
def update_shift(
    shift_id: int,
    payload: ShiftUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ShiftResponse:
    shift = _active_shifts(db).filter(TimesheetShift.id == shift_id).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Смена не найдена")

    data = payload.model_dump(exclude_unset=True)
    if "employee_id" in data:
        employee = _active_employees(db).filter(Employee.id == data["employee_id"]).first()
        if not employee:
            raise HTTPException(status_code=404, detail="Сотрудник не найден")

    for key, value in data.items():
        setattr(shift, key, value)

    try:
        shift_hours(shift.start_time, shift.end_time)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    ensure_cloud_id(shift)
    db.commit()
    db.refresh(shift)
    queue_entity_sync("timesheet_shifts", shift)
    return _shift_response(shift)


@router.delete("/timesheet/{shift_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_shift(
    shift_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    shift = _active_shifts(db).filter(TimesheetShift.id == shift_id).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Смена не найдена")
    shift.deleted_at = datetime.now(timezone.utc)
    ensure_cloud_id(shift)
    db.commit()
    queue_entity_sync("timesheet_shifts", shift, soft_delete=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
