from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.banquet import Banquet
from app.models.user import User
from app.schemas.banquet import BanquetCreate, BanquetResponse, BanquetUpdate
from app.services.audit import log_activity, set_created_by, set_updated_by, summarize_changes

router = APIRouter(prefix="/banquets", tags=["banquets"])


@router.get("", response_model=list[BanquetResponse])
def list_banquets(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    author_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[Banquet]:
    query = db.query(Banquet).filter(Banquet.deleted_at.is_(None))
    if date_from:
        query = query.filter(Banquet.event_date >= date_from)
    if date_to:
        query = query.filter(Banquet.event_date <= date_to)
    if author_id is not None:
        query = query.filter(Banquet.created_by_user_id == author_id)
    return query.order_by(Banquet.event_date.desc(), Banquet.id.desc()).all()


@router.post("", response_model=BanquetResponse, status_code=status.HTTP_201_CREATED)
def create_banquet(
    payload: BanquetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Banquet:
    banquet = Banquet(**payload.model_dump())
    set_created_by(banquet, current_user)
    db.add(banquet)
    db.flush()
    log_activity(
        db,
        user=current_user,
        action="Создала банкет",
        entity_type="banquet",
        entity_id=banquet.id,
        entity_label=banquet.guest_name,
        new_value=f"{banquet.event_date}" + (f" · {banquet.venue}" if banquet.venue else ""),
    )
    db.commit()
    db.refresh(banquet)
    return banquet


@router.patch("/{banquet_id}", response_model=BanquetResponse)
def update_banquet(
    banquet_id: int,
    payload: BanquetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Banquet:
    banquet = (
        db.query(Banquet)
        .filter(Banquet.id == banquet_id, Banquet.deleted_at.is_(None))
        .first()
    )
    if not banquet:
        raise HTTPException(status_code=404, detail="Бронирование не найдено")

    data = payload.model_dump(exclude_unset=True)
    old_snapshot = {k: getattr(banquet, k) for k in data}
    for key, value in data.items():
        setattr(banquet, key, value)
    set_updated_by(banquet, current_user)
    old_val, new_val = summarize_changes(old_snapshot, {k: getattr(banquet, k) for k in data})
    log_activity(
        db,
        user=current_user,
        action="Изменила банкет",
        entity_type="banquet",
        entity_id=banquet.id,
        entity_label=banquet.guest_name,
        old_value=old_val,
        new_value=new_val,
    )
    db.commit()
    db.refresh(banquet)
    return banquet


@router.delete("/{banquet_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_banquet(
    banquet_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    banquet = (
        db.query(Banquet)
        .filter(Banquet.id == banquet_id, Banquet.deleted_at.is_(None))
        .first()
    )
    if not banquet:
        raise HTTPException(status_code=404, detail="Бронирование не найдено")

    name = banquet.guest_name
    banquet.deleted_at = datetime.now(timezone.utc)
    set_updated_by(banquet, current_user)
    log_activity(
        db,
        user=current_user,
        action="Удалила банкет",
        entity_type="banquet",
        entity_id=banquet.id,
        entity_label=name,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
