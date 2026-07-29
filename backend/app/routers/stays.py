from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import or_

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.client import Client
from app.models.room import Room, RoomStatus
from app.models.stay import PaymentStatus, Stay, StayType
from app.models.user import User
from app.schemas.stay import (
    PaymentBreakdown,
    RegistrySummary,
    StayCreate,
    StayResponse,
    StayUpdate,
)
from app.services.audit import log_activity, set_created_by, set_updated_by, summarize_changes
from app.services.room_service import (
    get_active_stay,
    recalculate_room_status,
    apply_due_checkins,
    today_local,
    validate_stay_for_room,
)

router = APIRouter(prefix="/stays", tags=["stays"])

PRESET_METHODS = {"cash", "kaspi", "halyk"}


def _stay_to_response(stay: Stay) -> StayResponse:
    return StayResponse(
        id=stay.id,
        client_id=stay.client_id,
        room_id=stay.room_id,
        record_date=stay.record_date,
        stay_type=stay.stay_type,
        check_in=stay.check_in,
        planned_check_out=stay.planned_check_out,
        check_out=stay.check_out,
        payment_amount=stay.payment_amount,
        payment_status=stay.payment_status,
        payment_method=stay.payment_method,
        notes=stay.notes,
        created_at=stay.created_at,
        updated_at=stay.updated_at,
        client_name=stay.client.full_name if stay.client else "—",
        client_phone=stay.client.phone if stay.client else None,
        room_number=stay.room.number if stay.room else "—",
        created_by_user_id=stay.created_by_user_id,
        created_by_name=stay.created_by_name,
        updated_by_user_id=stay.updated_by_user_id,
        updated_by_name=stay.updated_by_name,
    )


def _active_stays(db: Session):
    return (
        db.query(Stay)
        .options(joinedload(Stay.client), joinedload(Stay.room))
        .filter(Stay.deleted_at.is_(None))
    )


def _validate_client_and_room(db: Session, client_id: int, room_id: int) -> None:
    client = db.query(Client).filter(Client.id == client_id, Client.deleted_at.is_(None)).first()
    if not client:
        raise HTTPException(status_code=404, detail="Клиент не найден")
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Номер не найден")


def _payment_breakdown(stays: list[Stay]) -> PaymentBreakdown:
    breakdown = PaymentBreakdown()
    for stay in stays:
        if stay.payment_status == PaymentStatus.unpaid:
            continue
        method = stay.payment_method or "other"
        if method == "cash":
            breakdown.cash += stay.payment_amount
        elif method == "kaspi":
            breakdown.kaspi += stay.payment_amount
        elif method == "halyk":
            breakdown.halyk += stay.payment_amount
        else:
            breakdown.other += stay.payment_amount
    return breakdown


@router.get("/summary", response_model=RegistrySummary)
def registry_summary(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> RegistrySummary:
    apply_due_checkins(db)
    today = today_local()
    stays_today = (
        _active_stays(db)
        .filter(Stay.record_date == today, Stay.stay_type == StayType.booking)
        .count()
    )
    checkouts_today = (
        _active_stays(db)
        .filter(
            or_(
                (Stay.planned_check_out == today) & (Stay.check_out.is_(None)),
                Stay.check_out == today,
            )
        )
        .count()
    )
    paid_stays_today = (
        db.query(Stay)
        .filter(
            Stay.deleted_at.is_(None),
            Stay.record_date == today,
            Stay.payment_status.in_([PaymentStatus.paid, PaymentStatus.partial]),
        )
        .all()
    )
    total_payments = sum((s.payment_amount for s in paid_stays_today), Decimal("0"))
    occupied = db.query(Room).filter(Room.status == RoomStatus.occupied).count()
    total_rooms = db.query(Room).count()
    total_records = _active_stays(db).count()
    return RegistrySummary(
        today_checkins=stays_today,
        today_payments_kzt=total_payments,
        today_checkouts=checkouts_today,
        occupied_rooms=occupied,
        total_rooms=total_rooms,
        total_records=total_records,
        payments_by_method=_payment_breakdown(paid_stays_today),
    )


@router.get("", response_model=list[StayResponse])
def list_stays(
    filter: str | None = Query(default=None, alias="filter"),
    search: str | None = Query(default=None),
    payment_method: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    author_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[StayResponse]:
    apply_due_checkins(db)
    query = _active_stays(db)
    today = today_local()

    if filter == "today":
        query = query.filter(Stay.record_date == today)
    elif filter == "week":
        week_start = today - timedelta(days=today.weekday())
        query = query.filter(Stay.record_date >= week_start, Stay.record_date <= today)
    elif filter == "unpaid":
        query = query.filter(Stay.payment_status != PaymentStatus.paid)
    elif filter == "checkout_today":
        query = query.filter(
            or_(
                (Stay.planned_check_out == today) & (Stay.check_out.is_(None)),
                Stay.check_out == today,
            )
        )
    elif filter == "active":
        query = query.filter(Stay.check_out.is_(None))

    if payment_method == "other":
        query = query.filter(
            Stay.payment_method.isnot(None),
            Stay.payment_method.notin_(list(PRESET_METHODS)),
        )
    elif payment_method:
        query = query.filter(Stay.payment_method == payment_method)

    if date_from:
        query = query.filter(Stay.record_date >= date_from)
    if date_to:
        query = query.filter(Stay.record_date <= date_to)

    if author_id is not None:
        query = query.filter(Stay.created_by_user_id == author_id)

    if search:
        term = f"%{search.strip()}%"
        query = query.join(Client).join(Room).filter(
            (Client.full_name.ilike(term))
            | (Client.phone.ilike(term))
            | (Room.number.ilike(term))
        )

    stays = query.order_by(Stay.record_date.desc(), Stay.id.desc()).all()
    return [_stay_to_response(s) for s in stays]


@router.post("", response_model=StayResponse, status_code=status.HTTP_201_CREATED)
def create_stay(
    payload: StayCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StayResponse:
    _validate_client_and_room(db, payload.client_id, payload.room_id)
    validate_stay_for_room(
        db,
        stay_type=payload.stay_type,
        room_id=payload.room_id,
        client_id=payload.client_id,
    )

    if (
        payload.planned_check_out
        and payload.check_in
        and payload.planned_check_out < payload.check_in
    ):
        raise HTTPException(status_code=400, detail="Дата выезда не может быть раньше заезда")

    data = payload.model_dump()
    if payload.stay_type == StayType.booking and not data.get("check_in"):
        data["check_in"] = payload.record_date

    stay = Stay(**data)
    set_created_by(stay, current_user)
    db.add(stay)
    db.flush()
    recalculate_room_status(db, stay.room_id)
    room = db.query(Room).filter(Room.id == stay.room_id).first()
    action = (
        "Создала бронирование"
        if payload.stay_type == StayType.booking
        else "Создала продление"
    )
    log_activity(
        db,
        user=current_user,
        action=action,
        entity_type="stay",
        entity_id=stay.id,
        entity_label=f"Номер №{room.number if room else '?'}",
        new_value=f"Клиент ID {stay.client_id}",
    )
    db.commit()
    db.refresh(stay)
    stay = _active_stays(db).filter(Stay.id == stay.id).first()
    assert stay is not None
    return _stay_to_response(stay)


@router.patch("/{stay_id}", response_model=StayResponse)
def update_stay(
    stay_id: int,
    payload: StayUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StayResponse:
    stay = _active_stays(db).filter(Stay.id == stay_id).first()
    if not stay:
        raise HTTPException(status_code=404, detail="Запись не найдена")

    data = payload.model_dump(exclude_unset=True)
    old_room_id = stay.room_id
    old_snapshot = {k: getattr(stay, k) for k in data}

    client_id = data.get("client_id", stay.client_id)
    room_id = data.get("room_id", stay.room_id)
    stay_type = data.get("stay_type", stay.stay_type)

    if "client_id" in data or "room_id" in data:
        _validate_client_and_room(db, client_id, room_id)

    if "stay_type" in data or "room_id" in data or "client_id" in data:
        validate_stay_for_room(
            db,
            stay_type=stay_type,
            room_id=room_id,
            client_id=client_id,
            exclude_stay_id=stay_id,
        )

    check_in = data.get("check_in", stay.check_in)
    planned_check_out = data.get("planned_check_out", stay.planned_check_out)
    if planned_check_out and check_in and planned_check_out < check_in:
        raise HTTPException(status_code=400, detail="Дата выезда не может быть раньше заезда")

    for key, value in data.items():
        setattr(stay, key, value)
    set_updated_by(stay, current_user)

    recalculate_room_status(db, old_room_id)
    if room_id != old_room_id:
        recalculate_room_status(db, room_id)

    old_val, new_val = summarize_changes(old_snapshot, {k: getattr(stay, k) for k in data})
    log_activity(
        db,
        user=current_user,
        action="Изменила запись журнала",
        entity_type="stay",
        entity_id=stay.id,
        entity_label=f"Номер №{stay.room.number if stay.room else '?'}",
        old_value=old_val,
        new_value=new_val,
    )
    db.commit()
    stay = _active_stays(db).filter(Stay.id == stay_id).first()
    assert stay is not None
    return _stay_to_response(stay)


@router.post("/{stay_id}/checkout", response_model=StayResponse)
def checkout_stay(
    stay_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StayResponse:
    stay = _active_stays(db).filter(Stay.id == stay_id).first()
    if not stay:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    if stay.check_out is not None:
        raise HTTPException(status_code=400, detail="Выезд уже оформлен")

    stay.check_out = today_local()
    set_updated_by(stay, current_user)
    recalculate_room_status(db, stay.room_id)
    log_activity(
        db,
        user=current_user,
        action="Оформила выезд",
        entity_type="stay",
        entity_id=stay.id,
        entity_label=f"Номер №{stay.room.number if stay.room else '?'}",
        new_value=str(stay.check_out),
    )
    db.commit()
    stay = _active_stays(db).filter(Stay.id == stay_id).first()
    assert stay is not None
    return _stay_to_response(stay)


@router.delete("/{stay_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_stay(
    stay_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    stay = _active_stays(db).filter(Stay.id == stay_id).first()
    if not stay:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    room_id = stay.room_id
    room_number = stay.room.number if stay.room else "?"
    stay.deleted_at = datetime.now(timezone.utc)
    set_updated_by(stay, current_user)
    recalculate_room_status(db, room_id)
    log_activity(
        db,
        user=current_user,
        action="Удалила запись журнала",
        entity_type="stay",
        entity_id=stay.id,
        entity_label=f"Номер №{room_number}",
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
