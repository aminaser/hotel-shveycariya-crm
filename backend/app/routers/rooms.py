from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.permissions import ANALYTICS_OWNER_USERNAME
from app.models.room import Room, RoomStatus
from app.models.user import User
from app.schemas.stay import RoomResponse, RoomUpdate
from app.services.audit import log_activity
from app.services.room_service import TZ, apply_due_checkins, get_active_stay, stay_should_occupy


router = APIRouter(prefix="/rooms", tags=["rooms"])


def _room_with_guest(db: Session, room: Room) -> RoomResponse:
    current_guest = None
    stay_id = None
    guest_phone = None
    check_in = None
    planned_check_out = None
    check_out = None
    stay_updated_at = None
    payment_status = None
    payment_amount = None

    stay = get_active_stay(db, room.id)
    if stay:
        current_guest = stay.client.full_name
        stay_id = stay.id
        guest_phone = stay.client.phone
        check_in = stay.check_in or stay.record_date
        planned_check_out = stay.planned_check_out
        check_out = stay.check_out
        stay_updated_at = stay.updated_at
        payment_status = stay.payment_status
        payment_amount = stay.payment_amount

    return RoomResponse(
        id=room.id,
        number=room.number,
        floor=room.floor,
        room_type=room.room_type,
        price_per_night=room.price_per_night,
        status=room.status,
        notes=room.notes,
        current_guest=current_guest,
        status_updated_at=room.status_updated_at,
        stay_id=stay_id,
        guest_phone=guest_phone,
        check_in=check_in,
        planned_check_out=planned_check_out,
        check_out=check_out,
        stay_updated_at=stay_updated_at,
        payment_status=payment_status,
        payment_amount=payment_amount,
    )


def _sort_room_number(room: Room) -> tuple[int, int, str]:
    try:
        return (0, int(room.number), "")
    except ValueError:
        return (1, 0, room.number)


@router.get("", response_model=list[RoomResponse])
def list_rooms(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[RoomResponse]:
    # Auto check-in: after 13:00 on the booking date, booked → occupied.
    apply_due_checkins(db)
    rooms = db.query(Room).all()
    rooms_sorted = sorted(rooms, key=_sort_room_number)
    return [_room_with_guest(db, r) for r in rooms_sorted]


@router.patch("/{room_id}", response_model=RoomResponse)
def update_room(
    room_id: int,
    payload: RoomUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RoomResponse:
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Номер не найден")

    data = payload.model_dump(exclude_unset=True)
    if {"price_per_night", "room_type"} & data.keys():
        if (current_user.username or "").strip().lower() != ANALYTICS_OWNER_USERNAME:
            raise HTTPException(
                status_code=403,
                detail="Цены и тип номера может менять только хозяйка Жибек",
            )

    new_status = data.get("status")
    if new_status is not None and new_status != RoomStatus.occupied:
        active = get_active_stay(db, room_id)
        if active and stay_should_occupy(active):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Нельзя изменить статус — гость {active.client.full_name} ещё не выехал. "
                    "Оформите выезд в журнале."
                ),
            )

    old_status = room.status.value if hasattr(room.status, "value") else str(room.status)
    old_price = room.price_per_night
    if "status" in data and data["status"] != room.status:
        room.status_updated_at = datetime.now(TZ)

    for key, value in data.items():
        setattr(room, key, value)

    if "status" in data:
        new_status_val = data["status"].value if hasattr(data["status"], "value") else str(data["status"])
        log_activity(
            db,
            user=current_user,
            action="Изменила статус номера",
            entity_type="room",
            entity_id=room.id,
            entity_label=f"Номер №{room.number}",
            old_value=old_status,
            new_value=new_status_val,
        )
    elif "price_per_night" in data or "room_type" in data:
        log_activity(
            db,
            user=current_user,
            action="Изменила цену/тип номера",
            entity_type="room",
            entity_id=room.id,
            entity_label=f"Номер №{room.number}",
            old_value=str(old_price) if old_price is not None else None,
            new_value=str(room.price_per_night) if room.price_per_night is not None else None,
        )

    db.commit()
    db.refresh(room)
    return _room_with_guest(db, room)
