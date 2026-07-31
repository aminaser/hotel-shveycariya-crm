from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session, joinedload

from app.models.room import Room, RoomStatus
from app.models.stay import Stay, StayType

TZ = ZoneInfo("Asia/Almaty")
# Buffer between guests on the same calendar day: out by 12:00, in from 13:00.
CHECK_OUT_HOUR = 12
CHECK_IN_HOUR = 13


def today_local() -> date:
    return datetime.now(TZ).date()


def now_local() -> datetime:
    return datetime.now(TZ)


def stay_check_in_date(stay: Stay) -> date:
    return stay.check_in or stay.record_date


def stay_period_end(stay: Stay) -> date | None:
    """Planned or actual departure date (checkout day, room free after 12:00)."""
    return stay.check_out or stay.planned_check_out


def periods_overlap(
    a_start: date,
    a_end: date | None,
    b_start: date,
    b_end: date | None,
) -> bool:
    """Half-open hotel days [start, end): same-day turnover does not overlap.

    Guest A: check-in Mon, checkout Wed 12:00 → occupies Mon..Tue nights, free Wed 12:00.
    Guest B: check-in Wed 13:00 → [Wed, ...) does not overlap [Mon, Wed).
    """
    if a_end is None and b_end is None:
        return True
    if a_end is None:
        return a_start < (b_end or a_start)
    if b_end is None:
        return b_start < a_end
    return a_start < b_end and b_start < a_end


def get_open_stays(
    db: Session,
    room_id: int,
    exclude_stay_id: int | None = None,
) -> list[Stay]:
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
    return query.order_by(Stay.record_date.desc(), Stay.id.desc()).all()


def get_active_stay(db: Session, room_id: int, exclude_stay_id: int | None = None) -> Stay | None:
    """Stay that currently drives room status (prefer occupied over future booking).

    Stays past planned checkout (from 12:00) no longer drive status — room can
    go free/cleaning while the record awaits formal checkout.
    """
    open_stays = get_open_stays(db, room_id, exclude_stay_id=exclude_stay_id)
    if not open_stays:
        return None
    occupying = [s for s in open_stays if stay_should_occupy(s)]
    if occupying:
        return occupying[0]
    today = today_local()
    future = [s for s in open_stays if stay_check_in_date(s) > today]
    if future:
        return future[0]
    pending_today = [
        s
        for s in open_stays
        if stay_check_in_date(s) == today and not stay_released_by_checkout_time(s)
    ]
    if pending_today:
        return pending_today[0]
    return None


def stay_released_by_checkout_time(stay: Stay, now: datetime | None = None) -> bool:
    """True when planned checkout day has reached 12:00 — room is free for turnover."""
    now = now or now_local()
    planned_out = stay.planned_check_out
    return (
        planned_out is not None
        and planned_out == now.date()
        and now.hour >= CHECK_OUT_HOUR
    )


def stay_should_occupy(stay: Stay, now: datetime | None = None) -> bool:
    """Whether an open stay should make the room occupied (vs booked).

    Rules:
    - extension → occupied until planned checkout day 12:00 (same as booking)
    - check-in date in the past → occupied
    - check-in date in the future → booked
    - check-in date is today → occupied only from 13:00 (Asia/Almaty)
    - planned checkout day from 12:00 → room freed for next guest (even without
      formal checkout yet); date ranges use half-open [check_in, checkout)
    """
    now = now or now_local()
    today = now.date()

    if stay_released_by_checkout_time(stay, now):
        # Выезд до 12:00 — после полудня номер свободен под заезд с 13:00.
        return False

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
        elif (
            room.status == RoomStatus.occupied
            and stay_check_in_date(stay) == today_local()
        ):
            # Early check-in on the check-in day (before 13:00) — keep occupied.
            pass
        else:
            # Future booking — not in the room yet.
            room.status = RoomStatus.booked
    else:
        open_stays = get_open_stays(db, room_id)
        auto_freed = any(stay_released_by_checkout_time(s) for s in open_stays)
        if auto_freed:
            # Planned checkout reached 12:00 — номер свободен (выезд ещё можно
            # оформить в журнале позже).
            room.status = RoomStatus.free
        elif room.status == RoomStatus.occupied:
            # Formal checkout / vacated — needs cleaning.
            room.status = RoomStatus.cleaning
        elif room.status == RoomStatus.booked:
            # Orphan booked status without an open stay.
            room.status = RoomStatus.free

    if room.status != previous:
        room.status_updated_at = now_local()


def apply_due_checkins(db: Session) -> int:
    """Promote booked→occupied at check-in time; free rooms after checkout 12:00;
    demote occupied→booked when the only open stay is still a future booking.
    """
    changed = 0
    candidates = (
        db.query(Room)
        .filter(Room.status.in_([RoomStatus.booked, RoomStatus.free, RoomStatus.occupied, RoomStatus.cleaning]))
        .all()
    )
    for room in candidates:
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
    check_in: date | None = None,
    planned_check_out: date | None = None,
    exclude_stay_id: int | None = None,
) -> None:
    from fastapi import HTTPException

    open_stays = get_open_stays(db, room_id, exclude_stay_id=exclude_stay_id)

    if stay_type == StayType.booking or stay_type == StayType.alumni:
        new_start = check_in
        new_end = planned_check_out
        for active in open_stays:
            guest = active.client.full_name
            existing_start = stay_check_in_date(active)
            existing_end = stay_period_end(active)

            # Same-day turnover: previous checkout date == new check-in date is OK
            # (out 12:00, in 13:00). Only block real overlaps.
            if new_start is not None and periods_overlap(
                existing_start, existing_end, new_start, new_end
            ):
                if stay_should_occupy(active) and (
                    existing_end is None or new_start < existing_end
                ):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Номер занят ({guest}). Сначала оформите выезд.",
                    )
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Номер уже занят/забронирован ({guest}) на эти даты. "
                        f"Выезд в 12:00, заезд с 13:00 — в день выезда можно селить следующего гостя."
                    ),
                )
            if new_start is None and active:
                # No dates given — keep legacy: block any open stay
                if stay_should_occupy(active):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Номер занят ({guest}). Сначала оформите выезд.",
                    )
                raise HTTPException(
                    status_code=400,
                    detail=f"Номер уже забронирован ({guest}).",
                )
        return
    if stay_type == StayType.extension:
        occupying = next((s for s in open_stays if stay_should_occupy(s)), None)
        if not occupying:
            raise HTTPException(
                status_code=400,
                detail="Продление возможно только для занятого номера",
            )
        if occupying.client_id != client_id:
            raise HTTPException(
                status_code=400,
                detail="Номер занят другим гостем",
            )
        return
    raise AssertionError(f"Unhandled stay type: {stay_type}")
