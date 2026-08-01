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
    # Check-in date reached but not occupying yet (no confirm, or before 13:00).
    # Must include checked_in_at rows that are still waiting for 13:00 — otherwise
    # the room looks free and the next booking disappears from «Номера».
    awaiting_arrival = [
        s
        for s in open_stays
        if stay_check_in_date(s) <= today
        and not stay_released_by_checkout_time(s)
        and not stay_should_occupy(s)
        and s.stay_type != StayType.extension
    ]
    if awaiting_arrival:
        return awaiting_arrival[0]
    return None


def stay_released_by_checkout_time(stay: Stay, now: datetime | None = None) -> bool:
    """True when the guest should have left by planned checkout (room free for turnover).

    - Planned checkout date already in the past → released
    - Planned checkout is today from 12:00 → released (in from 13:00 for next guest)
    """
    now = now or now_local()
    planned_out = stay.planned_check_out
    if planned_out is None:
        return False
    today = now.date()
    if planned_out < today:
        return True
    return planned_out == today and now.hour >= CHECK_OUT_HOUR


def stay_should_occupy(stay: Stay, now: datetime | None = None) -> bool:
    """Whether an open stay should make the room occupied (vs booked).

    Rules:
    - planned checkout day from 12:00 (or past) → not occupying
    - extension → occupied until planned checkout 12:00
    - booking / alumni → need staff confirm (checked_in_at) AND
      on check-in day only after 13:00 (hotel arrival time)
    """
    now = now or now_local()
    today = now.date()

    if stay_released_by_checkout_time(stay, now):
        # Выезд до 12:00 — после полудня номер свободен под заезд с 13:00.
        return False

    if stay.stay_type == StayType.extension:
        return True

    check_in = stay_check_in_date(stay)
    if check_in > today:
        return False

    if getattr(stay, "checked_in_at", None) is None:
        return False

    # Check-in day: «в номере» only from 13:00.
    if check_in == today and now.hour < CHECK_IN_HOUR:
        return False

    return True


def can_mark_occupied_now(stay: Stay | None = None, now: datetime | None = None) -> tuple[bool, str]:
    """Whether staff may set room status to occupied right now."""
    now = now or now_local()
    if stay is not None:
        check_in = stay_check_in_date(stay)
        if check_in > now.date():
            return False, "Дата заезда ещё не наступила"
        if check_in == now.date() and now.hour < CHECK_IN_HOUR:
            return (
                False,
                f"Статус «в номере» можно поставить с {CHECK_IN_HOUR}:00 в день заезда",
            )
        return True, ""
    if now.hour < CHECK_IN_HOUR:
        return False, f"Заселение в номер с {CHECK_IN_HOUR}:00"
    return True, ""


def mark_stay_arrived(stay: Stay, at: datetime | None = None) -> None:
    """Record that the guest physically checked in."""
    if stay.checked_in_at is None:
        stay.checked_in_at = at or now_local()


def clear_stay_arrived(stay: Stay) -> None:
    stay.checked_in_at = None


def recalculate_room_status(db: Session, room_id: int) -> None:
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room or room.status == RoomStatus.maintenance:
        return

    previous = room.status
    stay = get_active_stay(db, room_id)

    if stay:
        if stay_should_occupy(stay):
            room.status = RoomStatus.occupied
        else:
            # Future booking or check-in day without confirmed arrival.
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
    """Sync room status from open stays: demote false «occupied» before arrival,
    free rooms after checkout 12:00. Does not auto-check-in at 13:00.
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
