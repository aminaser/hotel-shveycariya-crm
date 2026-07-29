from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_password_hash
from app.models.app_settings import AppSettings
from app.models.room import Room, RoomStatus
from app.models.user import User
from app.schemas.auth import SetupInitRequest, SetupStatusResponse
from app.services.settings_service import get_or_create_settings

router = APIRouter(prefix="/setup", tags=["setup"])


@router.get("/status", response_model=SetupStatusResponse)
def setup_status(db: Session = Depends(get_db)) -> SetupStatusResponse:
    has_user = db.query(User).first() is not None
    return SetupStatusResponse(is_initialized=has_user)


@router.post("/init", response_model=SetupStatusResponse)
def setup_init(payload: SetupInitRequest, db: Session = Depends(get_db)) -> SetupStatusResponse:
    if db.query(User).first() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Система уже настроена",
        )

    user = User(
        username=payload.username,
        password_hash=get_password_hash(payload.password),
        full_name=payload.username,
        role="owner",
    )
    db.add(user)

    settings = get_or_create_settings(db)
    settings.hotel_name = payload.hotel_name
    settings.hotel_city = payload.hotel_city

    for number in payload.room_numbers:
        cleaned = number.strip()
        if not cleaned:
            continue
        exists = db.query(Room).filter(Room.number == cleaned).first()
        if exists:
            continue
        db.add(Room(number=cleaned, status=RoomStatus.free))

    db.commit()
    return SetupStatusResponse(is_initialized=True)
