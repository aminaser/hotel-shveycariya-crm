"""Seed hotel room rates and types for ТРК «Швейцария»."""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.room import Room

# Расценки на гостиничные номера. Завтрак включён. Сутки до 12:00.
ROOM_RATES: dict[str, tuple[Decimal, str]] = {
    "1": (Decimal("11000"), "одноместный"),
    "2": (Decimal("8000"), "одноместный"),
    "3": (Decimal("15000"), "одноместный"),
    "4": (Decimal("15000"), "семейный"),
    "5": (Decimal("10000"), "одноместный"),
    "7": (Decimal("10000"), "одноместный"),
    "10": (Decimal("12000"), "двухместный"),
    "11": (Decimal("12000"), "двухместный"),
    "12": (Decimal("9000"), "одноместный"),
    "13": (Decimal("9000"), "одноместный"),
    "14": (Decimal("11000"), "одноместный"),
    "15": (Decimal("10000"), "одноместный"),
}

ROOM_POLICY_NOTE = "Завтрак включен. Сутки до 12:00."


def seed_room_rates(db: Session) -> None:
    rooms = db.query(Room).all()
    if not rooms:
        return

    changed = False
    for room in rooms:
        rate = ROOM_RATES.get(str(room.number).strip())
        if not rate:
            continue
        price, room_type = rate
        if room.price_per_night != price:
            room.price_per_night = price
            changed = True
        if room.room_type != room_type:
            room.room_type = room_type
            changed = True
        if not room.notes or ROOM_POLICY_NOTE not in room.notes:
            room.notes = ROOM_POLICY_NOTE
            changed = True

    if changed:
        db.commit()
