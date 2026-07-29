from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session, joinedload

from app.models.room import Room, RoomStatus
from app.models.stay import Stay, StayType

TZ = ZoneInfo("Asia/Almaty")
CHECK_IN_HOUR = 14


def today_local() -> date:
    return datetime.now(TZ).date()


def now_local() -> datetime:
    return datetime.now(TZ)


def get_active_stay(db: Session, room_id: int, exclude_stay_id: int | None = None) -> Stay | None:
    query = (
        db.query(Stay)
        .options(joinedload(Stay.client))
        .filter(
            Stay.room_id == room_id,
            Stay.deleted_at.is_(None),
            Stay.check_out.is_(None),
        )
    )
    if exclude_stay_id is not None:
        query = query.filter(Stay.id != exclude_stay_id)
    return query.order_by(Stay.record_date.desc(), Stay.id.desc()).first()


def stay_check_in_date(stay: Stay) -> date:
    return stay.check_in or stay.record_date


def stay_should_occupy(stay: Stay, now: datetime | None = None) -> bool:
    """Whether an open stay should make the room occupied (vs booked).

    Rules:
    - extension → always occupied
    - check-in date in the past → occupied
    - check-in date in the future → booked
    - check-in date is today → occupied only from 14:00 (Asia/Almaty)
    """
    now = now or now_local()
    today = now.date()

    if stay.stay_type == StayType.extension:
        return True

    check_in = stay_check_in_date(stay)
    if check_in < today:
        return True
    if check_in > today:
        return False
    return now.hour >= CHECK_IN_HOUR


def recalculate_room_status(db: Session, room_id: int) -> None:
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room or room.status == RoomStatus.maintenance:
        return

    previous = room.status
    stay = get_active_stay(db, room_id)

    if stay:
        if stay_should_occupy(stay):
            room.status = RoomStatus.occupied
        elif room.status == RoomStatus.occupied:
            # Early check-in by admin — keep occupied until checkout.
            pass
        else:
            room.status = RoomStatus.booked
    elif room.status == RoomStatus.occupied:
        room.status = RoomStatus.cleaning
    elif room.status == RoomStatus.booked:
        # Orphan booked status without an open stay.
        room.status = RoomStatus.free

    if room.status != previous:
        room.status_updated_at = now_local()


def apply_due_checkins(db: Session) -> int:
    """Promote booked rooms to occupied when check-in time has arrived.

    Safe to call on every rooms list request — only touches rooms that need a change.
    """
    changed = 0
    candidates = (
        db.query(Room)
        .filter(Room.status.in_([RoomStatus.booked, RoomStatus.free]))
        .all()
    )
    for room in candidates:
        stay = get_active_stay(db, room.id)
        if not stay:
            continue
        previous = room.status
        recalculate_room_status(db, room.id)
        if room.status != previous:
            changed += 1
    if changed:
        db.commit()
    return changed


def validate_stay_for_room(
    db: Session,
    *,
    stay_type: StayType,
    room_id: int,
    client_id: int,
    exclude_stay_id: int | None = None,
) -> None:
    from fastapi import HTTPException

    active = get_active_stay(db, room_id, exclude_stay_id=exclude_stay_id)

    if stay_type == StayType.booking:
        if active:
            guest = active.client.full_name
            if stay_should_occupy(active):
                detail = f"Номер занят ({guest}). Сначала оформите выезд."
            else:
                detail = f"Номер уже забронирован ({guest})."
            raise HTTPException(status_code=400, detail=detail)
    elif stay_type == StayType.extension:
        if not active:
            raise HTTPException(
                status_code=400,
                detail="Продление возможно только для занятого номера",
            )
        if active.client_id != client_id:
            raise HTTPException(
                status_code=400,
                detail="Номер занят другим гостем",
            )
