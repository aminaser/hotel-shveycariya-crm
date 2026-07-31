from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import logging

from sqlalchemy import or_, func

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.client import Client
from app.models.room import Room, RoomStatus
from app.models.stay import PaymentStatus, Stay, StayType
from app.models.user import User
from app.schemas.stay import (
    CheckoutRequest,
    PaymentBreakdown,
    RegistrySummary,
    StayCreate,
    StayResponse,
    StayUpdate,
)
from app.services.audit import log_activity, set_created_by, set_updated_by, summarize_changes
from app.services.payment_amount import received_payment_amount
from app.services.room_sync import sync_checkin, sync_checkout
from app.services.room_service import (
    get_active_stay,
    recalculate_room_status,
    apply_due_checkins,
    today_local,
    now_local,
    validate_stay_for_room,
    CHECK_IN_HOUR,
)

router = APIRouter(prefix="/stays", tags=["stays"])
logger = logging.getLogger(__name__)

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
        prepayment=getattr(stay, "prepayment", None) or Decimal("0"),
        payment_status=stay.payment_status,
        payment_method=stay.payment_method,
        payment_date=stay.payment_date,
        people_count=getattr(stay, "people_count", None) or 1,
        group_id=getattr(stay, "group_id", None),
        notes=stay.notes,
        created_at=stay.created_at,
        updated_at=stay.updated_at,
        client_name=stay.client.full_name if stay.client else "—",
        client_phone=stay.client.phone if stay.client else None,
        client_iin=stay.client.iin if stay.client else None,
        room_number=stay.room.number if stay.room else "—",
        created_by_user_id=stay.created_by_user_id,
        created_by_name=stay.created_by_name,
        updated_by_user_id=stay.updated_by_user_id,
        updated_by_name=stay.updated_by_name,
    )


def effective_payment_date(stay: Stay) -> date | None:
    """Date used for revenue. Only explicit payment_date counts — never check-in/record date."""
    if stay.payment_status == PaymentStatus.unpaid:
        return None
    return stay.payment_date


def _normalize_payment_fields(
    *,
    payment_status: PaymentStatus,
    payment_date: date | None,
    previous_status: PaymentStatus | None = None,
) -> date | None:
    if payment_status == PaymentStatus.unpaid:
        return None
    if payment_date:
        return payment_date
    # Newly marked as paid/partial without an explicit date → today.
    if previous_status == PaymentStatus.unpaid or previous_status is None:
        return today_local()
    return payment_date


def _normalize_prepayment(
    *,
    payment_status: PaymentStatus,
    prepayment: Decimal | None,
) -> Decimal:
    if payment_status == PaymentStatus.unpaid:
        return Decimal("0")
    if payment_status == PaymentStatus.paid:
        return Decimal("0")
    return prepayment if prepayment is not None else Decimal("0")


def _stay_holds_group_payment(stay: Stay) -> bool:
    """True when this row is the money-bearing stay in a multi-room group."""
    amount = stay.payment_amount or Decimal("0")
    prepay = stay.prepayment or Decimal("0")
    if stay.payment_status == PaymentStatus.partial and prepay > 0:
        return True
    if stay.stay_type == StayType.alumni and amount > 0:
        return True
    return False


def _clear_sibling_group_payments(db: Session, stay: Stay) -> None:
    """Ensure package / partial prepayment lives on at most one stay per group_id."""
    if not stay.group_id or not _stay_holds_group_payment(stay):
        return
    siblings = (
        _active_stays(db)
        .filter(Stay.group_id == stay.group_id, Stay.id != stay.id)
        .all()
    )
    for sib in siblings:
        if stay.stay_type == StayType.alumni:
            sib.payment_amount = Decimal("0")
            sib.prepayment = Decimal("0")
            sib.payment_status = PaymentStatus.unpaid
            sib.payment_date = None
            continue
        # Non-alumni multi-room: rooms keep their own amounts; only one partial prepay.
        if sib.payment_status == PaymentStatus.partial or (sib.prepayment or Decimal("0")) > 0:
            sib.prepayment = Decimal("0")
            if sib.payment_status == PaymentStatus.partial:
                sib.payment_status = PaymentStatus.unpaid
                sib.payment_date = None


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


def _create_stay_action(stay_type: StayType) -> str:
    if stay_type == StayType.booking:
        return "Создала бронирование"
    if stay_type == StayType.extension:
        return "Создала продление"
    if stay_type == StayType.alumni:
        return "Создала встречу выпускников"
    raise AssertionError(f"Unhandled stay type: {stay_type}")


@router.get("/summary", response_model=RegistrySummary)
def registry_summary(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> RegistrySummary:
    apply_due_checkins(db)
    today = today_local()
    stays_today = (
        _active_stays(db)
        .filter(Stay.record_date == today, Stay.stay_type.in_([StayType.booking, StayType.alumni]))
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
    # Revenue for today = payments whose payment_date is today
    # (booking/check-in date does not matter).
    paid_stays_today = (
        db.query(Stay)
        .filter(
            Stay.deleted_at.is_(None),
            Stay.payment_status.in_([PaymentStatus.paid, PaymentStatus.partial]),
            Stay.payment_date == today,
        )
        .all()
    )
    total_payments = sum((received_payment_amount(s) for s in paid_stays_today), Decimal("0"))
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
        # Actually in the room now — exclude future check-ins (бронь).
        check_in_expr = func.coalesce(Stay.check_in, Stay.record_date)
        hour = now_local().hour
        if hour >= CHECK_IN_HOUR:
            in_room_today = check_in_expr <= today
        else:
            in_room_today = check_in_expr < today
        query = query.filter(
            Stay.check_out.is_(None),
            or_(Stay.stay_type == StayType.extension, in_room_today),
        )

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
            | (Client.iin.ilike(term))
            | (Room.number.ilike(term))
        ).distinct()

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
        check_in=payload.check_in or payload.record_date,
        planned_check_out=payload.planned_check_out,
    )

    if (
        payload.planned_check_out
        and payload.check_in
        and payload.planned_check_out < payload.check_in
    ):
        raise HTTPException(status_code=400, detail="Дата выезда не может быть раньше заезда")

    data = payload.model_dump()
    if payload.stay_type in (StayType.booking, StayType.alumni) and not data.get("check_in"):
        data["check_in"] = payload.record_date
    if payload.stay_type != StayType.alumni:
        data["people_count"] = data.get("people_count") or 1
    data["payment_date"] = _normalize_payment_fields(
        payment_status=payload.payment_status,
        payment_date=payload.payment_date,
        previous_status=None,
    )
    data["prepayment"] = _normalize_prepayment(
        payment_status=payload.payment_status,
        prepayment=payload.prepayment,
    )
    if (
        payload.payment_status == PaymentStatus.partial
        and data["prepayment"] <= 0
    ):
        raise HTTPException(
            status_code=400,
            detail="Укажите сумму предоплаты при частичной оплате",
        )

    stay = Stay(**data)
    set_created_by(stay, current_user)
    db.add(stay)
    db.flush()
    _clear_sibling_group_payments(db, stay)
    recalculate_room_status(db, stay.room_id)
    room = db.query(Room).filter(Room.id == stay.room_id).first()
    action = _create_stay_action(payload.stay_type)

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

    try:
        if stay.client and stay.room:
            sync_checkin(
                room_number=stay.room.number,
                guest_name=stay.client.full_name,
                phone=stay.client.phone,
                check_in=stay.check_in or stay.record_date,
                planned_check_out=stay.planned_check_out,
            )
    except Exception:
        logger.exception("Failed to sync check-in to Supabase for stay %s", stay.id)

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

    check_in = data.get("check_in", stay.check_in)
    planned_check_out = data.get("planned_check_out", stay.planned_check_out)
    if planned_check_out and check_in and planned_check_out < check_in:
        raise HTTPException(status_code=400, detail="Дата выезда не может быть раньше заезда")

    next_check_out = data.get("check_out", stay.check_out) if "check_out" in data else stay.check_out
    if next_check_out and check_in and next_check_out < check_in:
        raise HTTPException(status_code=400, detail="Дата выезда не может быть раньше заезда")

    if (
        "stay_type" in data
        or "room_id" in data
        or "client_id" in data
        or "check_in" in data
        or "planned_check_out" in data
        or ("check_out" in data and data["check_out"] is None)
    ):
        # When undoing checkout, re-validate room occupancy conflicts.
        validate_stay_for_room(
            db,
            stay_type=stay_type,
            room_id=room_id,
            client_id=client_id,
            check_in=check_in or stay.record_date,
            planned_check_out=planned_check_out,
            exclude_stay_id=stay_id,
        )

    previous_status = stay.payment_status
    previous_payment_date = stay.payment_date

    for key, value in data.items():
        setattr(stay, key, value)

    if "payment_status" in data or "payment_date" in data:
        stay.payment_date = _normalize_payment_fields(
            payment_status=stay.payment_status,
            payment_date=data["payment_date"] if "payment_date" in data else previous_payment_date,
            previous_status=previous_status,
        )

    if "payment_status" in data or "prepayment" in data:
        stay.prepayment = _normalize_prepayment(
            payment_status=stay.payment_status,
            prepayment=stay.prepayment,
        )
        if stay.payment_status == PaymentStatus.partial and stay.prepayment <= 0:
            raise HTTPException(
                status_code=400,
                detail="Укажите сумму предоплаты при частичной оплате",
            )

    set_updated_by(stay, current_user)
    _clear_sibling_group_payments(db, stay)

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

    try:
        if stay.room and stay.client:
            if stay.check_out:
                sync_checkout(stay.room.number)
            else:
                sync_checkin(
                    room_number=stay.room.number,
                    guest_name=stay.client.full_name,
                    phone=stay.client.phone,
                    check_in=stay.check_in or stay.record_date,
                    planned_check_out=stay.planned_check_out,
                )
    except Exception:
        logger.exception("Failed to sync stay update to Supabase for stay %s", stay.id)

    return _stay_to_response(stay)


@router.post("/{stay_id}/checkout", response_model=StayResponse)
def checkout_stay(
    stay_id: int,
    payload: CheckoutRequest = CheckoutRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StayResponse:
    stay = _active_stays(db).filter(Stay.id == stay_id).first()
    if not stay:
        raise HTTPException(status_code=404, detail="Запись не найдена")

    check_out_date = payload.check_out or today_local()
    check_in = stay.check_in or stay.record_date
    if check_out_date < check_in:
        raise HTTPException(status_code=400, detail="Дата выезда не может быть раньше заезда")

    was_checked_out = stay.check_out is not None
    stay.check_out = check_out_date
    set_updated_by(stay, current_user)
    recalculate_room_status(db, stay.room_id)
    log_activity(
        db,
        user=current_user,
        action="Изменила выезд" if was_checked_out else "Оформила выезд",
        entity_type="stay",
        entity_id=stay.id,
        entity_label=f"Номер №{stay.room.number if stay.room else '?'}",
        new_value=str(stay.check_out),
    )
    db.commit()
    stay = _active_stays(db).filter(Stay.id == stay_id).first()
    assert stay is not None

    try:
        if stay.room:
            sync_checkout(stay.room.number)
    except Exception:
        logger.exception("Failed to sync checkout to Supabase for stay %s", stay.id)

    return _stay_to_response(stay)


@router.post("/{stay_id}/undo-checkout", response_model=StayResponse)
def undo_checkout_stay(
    stay_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StayResponse:
    stay = _active_stays(db).filter(Stay.id == stay_id).first()
    if not stay:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    if stay.check_out is None:
        raise HTTPException(status_code=400, detail="Выезд не оформлен")

    validate_stay_for_room(
        db,
        stay_type=stay.stay_type,
        room_id=stay.room_id,
        client_id=stay.client_id,
        check_in=stay.check_in or stay.record_date,
        planned_check_out=stay.planned_check_out,
        exclude_stay_id=stay_id,
    )

    old_value = str(stay.check_out)
    stay.check_out = None
    set_updated_by(stay, current_user)
    recalculate_room_status(db, stay.room_id)
    log_activity(
        db,
        user=current_user,
        action="Отменила выезд",
        entity_type="stay",
        entity_id=stay.id,
        entity_label=f"Номер №{stay.room.number if stay.room else '?'}",
        old_value=old_value,
        new_value="отменён",
    )
    db.commit()
    stay = _active_stays(db).filter(Stay.id == stay_id).first()
    assert stay is not None

    try:
        if stay.room and stay.client:
            sync_checkin(
                room_number=stay.room.number,
                guest_name=stay.client.full_name,
                phone=stay.client.phone,
                check_in=stay.check_in or stay.record_date,
                planned_check_out=stay.planned_check_out,
            )
    except Exception:
        logger.exception("Failed to sync undo-checkout to Supabase for stay %s", stay.id)

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

    try:
        if room_number != "?":
            sync_checkout(room_number)
    except Exception:
        logger.exception("Failed to sync delete/checkout to Supabase for stay %s", stay_id)

    return Response(status_code=status.HTTP_204_NO_CONTENT)
