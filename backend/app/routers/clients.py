from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.client import Client
from app.models.stay import Stay
from app.models.user import User
from app.schemas.client import (
    ClientCreate,
    ClientDetailResponse,
    ClientResponse,
    ClientUpdate,
    StaySummary,
)
from app.services.audit import log_activity, set_created_by, set_updated_by, summarize_changes

router = APIRouter(prefix="/clients", tags=["clients"])


def _active_clients(db: Session):
    return db.query(Client).filter(Client.deleted_at.is_(None))


@router.get("", response_model=list[ClientResponse])
def list_clients(
    search: str | None = Query(default=None),
    author_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[Client]:
    query = _active_clients(db)
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Client.full_name.ilike(term),
                Client.phone.ilike(term),
                Client.iin.ilike(term),
            )
        )
    if author_id is not None:
        query = query.filter(Client.created_by_user_id == author_id)
    return query.order_by(Client.full_name.asc()).all()


@router.post("", response_model=ClientResponse, status_code=status.HTTP_201_CREATED)
def create_client(
    payload: ClientCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Client:
    if payload.iin:
        existing = (
            db.query(Client)
            .filter(Client.iin == payload.iin, Client.deleted_at.is_(None))
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Клиент с таким ИИН уже существует")
    if payload.bin:
        existing = (
            db.query(Client)
            .filter(Client.bin == payload.bin, Client.deleted_at.is_(None))
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Клиент с таким БИН уже существует")
    client = Client(**payload.model_dump())
    set_created_by(client, current_user)
    db.add(client)
    db.flush()
    log_activity(
        db,
        user=current_user,
        action="Создала клиента",
        entity_type="client",
        entity_id=client.id,
        entity_label=client.full_name,
    )
    db.commit()
    db.refresh(client)
    return client


@router.get("/{client_id}", response_model=ClientDetailResponse)
def get_client(
    client_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ClientDetailResponse:
    client = _active_clients(db).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Клиент не найден")

    stays = (
        db.query(Stay)
        .options(joinedload(Stay.room))
        .filter(Stay.client_id == client_id, Stay.deleted_at.is_(None))
        .order_by(Stay.record_date.desc())
        .all()
    )
    stay_summaries = [
        StaySummary(
            id=s.id,
            record_date=s.record_date,
            stay_type=s.stay_type,
            payment_amount=s.payment_amount,
            payment_status=s.payment_status,
            payment_method=s.payment_method,
            room_number=s.room.number if s.room else "—",
        )
        for s in stays
    ]
    return ClientDetailResponse.model_validate(
        {**ClientResponse.model_validate(client).model_dump(), "stays": stay_summaries}
    )


@router.patch("/{client_id}", response_model=ClientResponse)
def update_client(
    client_id: int,
    payload: ClientUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Client:
    client = _active_clients(db).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Клиент не найден")

    data = payload.model_dump(exclude_unset=True)
    old_snapshot = {k: getattr(client, k) for k in data}
    if "iin" in data and data["iin"]:
        existing = (
            db.query(Client)
            .filter(
                Client.iin == data["iin"],
                Client.id != client_id,
                Client.deleted_at.is_(None),
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Клиент с таким ИИН уже существует")
    if "bin" in data and data["bin"]:
        existing = (
            db.query(Client)
            .filter(
                Client.bin == data["bin"],
                Client.id != client_id,
                Client.deleted_at.is_(None),
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Клиент с таким БИН уже существует")

    for key, value in data.items():
        setattr(client, key, value)
    set_updated_by(client, current_user)
    old_val, new_val = summarize_changes(old_snapshot, {k: getattr(client, k) for k in data})
    log_activity(
        db,
        user=current_user,
        action="Изменила клиента",
        entity_type="client",
        entity_id=client.id,
        entity_label=client.full_name,
        old_value=old_val,
        new_value=new_val,
    )
    db.commit()
    db.refresh(client)
    return client


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_client(
    client_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    client = _active_clients(db).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Клиент не найден")

    active_stays = (
        db.query(Stay)
        .filter(Stay.client_id == client_id, Stay.deleted_at.is_(None), Stay.check_out.is_(None))
        .count()
    )
    if active_stays > 0:
        raise HTTPException(
            status_code=400,
            detail="Нельзя удалить клиента с активным проживанием. Сначала оформите выезд.",
        )

    name = client.full_name
    client.deleted_at = datetime.now(timezone.utc)
    set_updated_by(client, current_user)
    log_activity(
        db,
        user=current_user,
        action="Удалила клиента",
        entity_type="client",
        entity_id=client.id,
        entity_label=name,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
