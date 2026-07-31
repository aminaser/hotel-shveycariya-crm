from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.banquet import Banquet
from app.models.client import Client
from app.models.stay import Stay, StayType
from app.models.user import User
from app.services.audit import log_activity, set_updated_by
from app.services.room_service import recalculate_room_status, validate_stay_for_room

router = APIRouter(prefix="/trash", tags=["trash"])

TrashType = Literal["stay", "client", "banquet"]


class TrashItem(BaseModel):
    type: TrashType
    id: int
    title: str
    subtitle: str | None = None
    deleted_at: datetime


class TrashRestoreRequest(BaseModel):
    type: TrashType
    id: int


def _fmt(d) -> str:
    return d.strftime("%d.%m.%Y") if d else ""


@router.get("", response_model=list[TrashItem])
def list_trash(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[TrashItem]:
    items: list[TrashItem] = []

    stays = (
        db.query(Stay)
        .options(joinedload(Stay.room), joinedload(Stay.client))
        .filter(Stay.deleted_at.isnot(None))
        .all()
    )
    for stay in stays:
        period = _fmt(stay.check_in or stay.record_date)
        end = stay.check_out or stay.planned_check_out
        if end:
            period += f" – {_fmt(end)}"
        guest = stay.client.full_name if stay.client else "Гость"
        room_part = f" · номер {stay.room.number}" if stay.room else ""
        items.append(
            TrashItem(
                type="stay",
                id=stay.id,
                title=f"Журнал: {guest}{room_part}",
                subtitle=period,
                deleted_at=stay.deleted_at,
            )
        )

    clients = db.query(Client).filter(Client.deleted_at.isnot(None)).all()
    for client in clients:
        items.append(
            TrashItem(
                type="client",
                id=client.id,
                title=f"Клиент: {client.full_name}",
                subtitle=client.phone,
                deleted_at=client.deleted_at,
            )
        )

    banquets = db.query(Banquet).filter(Banquet.deleted_at.isnot(None)).all()
    for banquet in banquets:
        subtitle = _fmt(banquet.event_date)
        if banquet.venue:
            subtitle += f" · {banquet.venue}"
        items.append(
            TrashItem(
                type="banquet",
                id=banquet.id,
                title=f"Банкет: {banquet.guest_name}",
                subtitle=subtitle,
                deleted_at=banquet.deleted_at,
            )
        )

    items.sort(key=lambda item: item.deleted_at, reverse=True)
    return items


@router.post("/restore", response_model=TrashItem)
def restore_item(
    payload: TrashRestoreRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TrashItem:
    if payload.type == "stay":
        stay = (
            db.query(Stay)
            .options(joinedload(Stay.room), joinedload(Stay.client))
            .filter(Stay.id == payload.id, Stay.deleted_at.isnot(None))
            .first()
        )
        if not stay:
            raise HTTPException(status_code=404, detail="Запись не найдена в корзине")
        if stay.check_out is None:
            # Same rules as create: half-open days, checkout 12:00 / check-in 13:00.
            stay_type = (
                StayType(stay.stay_type)
                if not isinstance(stay.stay_type, StayType)
                else stay.stay_type
            )
            validate_stay_for_room(
                db,
                stay_type=stay_type,
                room_id=stay.room_id,
                client_id=stay.client_id,
                check_in=stay.check_in or stay.record_date,
                planned_check_out=stay.planned_check_out,
                exclude_stay_id=stay.id,
            )
        deleted_at = stay.deleted_at
        stay.deleted_at = None
        set_updated_by(stay, current_user)
        recalculate_room_status(db, stay.room_id)
        guest = stay.client.full_name if stay.client else "Гость"
        room_part = f" · номер {stay.room.number}" if stay.room else ""
        log_activity(
            db,
            user=current_user,
            action="Восстановила запись из корзины",
            entity_type="stay",
            entity_id=stay.id,
            entity_label=f"{guest}{room_part}",
        )
        db.commit()
        return TrashItem(
            type="stay",
            id=stay.id,
            title=f"Журнал: {guest}{room_part}",
            deleted_at=deleted_at,
        )

    if payload.type == "client":
        client = (
            db.query(Client)
            .filter(Client.id == payload.id, Client.deleted_at.isnot(None))
            .first()
        )
        if not client:
            raise HTTPException(status_code=404, detail="Клиент не найден в корзине")
        deleted_at = client.deleted_at
        client.deleted_at = None
        set_updated_by(client, current_user)
        log_activity(
            db,
            user=current_user,
            action="Восстановила клиента из корзины",
            entity_type="client",
            entity_id=client.id,
            entity_label=client.full_name,
        )
        db.commit()
        return TrashItem(
            type="client",
            id=client.id,
            title=f"Клиент: {client.full_name}",
            deleted_at=deleted_at,
        )

    banquet = (
        db.query(Banquet)
        .filter(Banquet.id == payload.id, Banquet.deleted_at.isnot(None))
        .first()
    )
    if not banquet:
        raise HTTPException(status_code=404, detail="Бронирование не найдено в корзине")
    deleted_at = banquet.deleted_at
    banquet.deleted_at = None
    set_updated_by(banquet, current_user)
    log_activity(
        db,
        user=current_user,
        action="Восстановила банкет из корзины",
        entity_type="banquet",
        entity_id=banquet.id,
        entity_label=banquet.guest_name,
    )
    db.commit()
    return TrashItem(
        type="banquet",
        id=banquet.id,
        title=f"Банкет: {banquet.guest_name}",
        deleted_at=deleted_at,
    )


@router.delete("/clear", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def clear_trash(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Permanently remove all soft-deleted CRM records (entire trash)."""
    stays = db.query(Stay).filter(Stay.deleted_at.isnot(None)).all()
    clients = db.query(Client).filter(Client.deleted_at.isnot(None)).all()
    banquets = db.query(Banquet).filter(Banquet.deleted_at.isnot(None)).all()

    # Delete stays first so client FK references do not block hard-delete.
    for stay in stays:
        db.delete(stay)

    # Soft-deleted clients may still be referenced by historical (non-deleted)
    # stays — cascade those so clear_trash does not raise IntegrityError.
    for client in clients:
        leftover = db.query(Stay).filter(Stay.client_id == client.id).all()
        for stay in leftover:
            db.delete(stay)
        db.delete(client)

    for banquet in banquets:
        db.delete(banquet)

    count = len(stays) + len(clients) + len(banquets)
    log_activity(
        db,
        user=current_user,
        action="Очистила корзину",
        entity_type="trash",
        new_value=f"Удалено навсегда: {count}",
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
