from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.employee import Employee
from app.models.timesheet_shift import TimesheetShift
from app.models.user import User
from app.schemas.timesheet import (
    EmployeeCreate,
    EmployeeResponse,
    EmployeeUpdate,
    ShiftCreate,
    ShiftResponse,
    ShiftUpdate,
    TimesheetDaySummary,
)
from app.services.timesheet_calc import shift_earnings, shift_hours
from app.services.room_service import today_local

router = APIRouter(tags=["timesheet"])


def _active_employees(db: Session):
    return db.query(Employee).filter(Employee.deleted_at.is_(None))


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
    _: User = Depends(get_current_user),
) -> Employee:
    employee = Employee(**payload.model_dump())
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee


@router.patch("/employees/{employee_id}", response_model=EmployeeResponse)
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Employee:
    employee = _active_employees(db).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(employee, key, value)
    db.commit()
    db.refresh(employee)
    return employee


@router.delete("/employees/{employee_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    employee = _active_employees(db).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    employee.deleted_at = datetime.now(timezone.utc)
    db.commit()
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
        .filter(TimesheetShift.work_date == work_date, Employee.deleted_at.is_(None))
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
    db.commit()
    db.refresh(shift)
    return _shift_response(shift)


@router.patch("/timesheet/{shift_id}", response_model=ShiftResponse)
def update_shift(
    shift_id: int,
    payload: ShiftUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ShiftResponse:
    shift = db.query(TimesheetShift).filter(TimesheetShift.id == shift_id).first()
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

    db.commit()
    db.refresh(shift)
    return _shift_response(shift)


@router.delete("/timesheet/{shift_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_shift(
    shift_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    shift = db.query(TimesheetShift).filter(TimesheetShift.id == shift_id).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Смена не найдена")
    db.delete(shift)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
