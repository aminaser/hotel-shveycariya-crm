from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.takeaway_order import TakeawayOrder
from app.models.user import User
from app.schemas.takeaway_order import (
    TakeawayOrderCreate,
    TakeawayOrderResponse,
    TakeawayOrderUpdate,
)
from app.services.audit import log_activity, set_created_by, set_updated_by, summarize_changes

router = APIRouter(prefix="/takeaway-orders", tags=["takeaway-orders"])


@router.get("", response_model=list[TakeawayOrderResponse])
def list_takeaway_orders(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    author_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[TakeawayOrder]:
    query = db.query(TakeawayOrder).filter(TakeawayOrder.deleted_at.is_(None))
    if date_from:
        query = query.filter(TakeawayOrder.order_date >= date_from)
    if date_to:
        query = query.filter(TakeawayOrder.order_date <= date_to)
    if author_id is not None:
        query = query.filter(TakeawayOrder.created_by_user_id == author_id)
    return query.order_by(TakeawayOrder.order_date.desc(), TakeawayOrder.id.desc()).all()


@router.post("", response_model=TakeawayOrderResponse, status_code=status.HTTP_201_CREATED)
def create_takeaway_order(
    payload: TakeawayOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TakeawayOrder:
    order = TakeawayOrder(**payload.model_dump())
    set_created_by(order, current_user)
    db.add(order)
    db.flush()
    log_activity(
        db,
        user=current_user,
        action="Создала заказ на вынос",
        entity_type="takeaway_order",
        entity_id=order.id,
        entity_label=order.guest_name,
        new_value=f"{order.order_date}",
    )
    db.commit()
    db.refresh(order)
    return order


@router.patch("/{order_id}", response_model=TakeawayOrderResponse)
def update_takeaway_order(
    order_id: int,
    payload: TakeawayOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TakeawayOrder:
    order = (
        db.query(TakeawayOrder)
        .filter(TakeawayOrder.id == order_id, TakeawayOrder.deleted_at.is_(None))
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Заказ не найден")

    data = payload.model_dump(exclude_unset=True)
    old_snapshot = {k: getattr(order, k) for k in data}
    for key, value in data.items():
        setattr(order, key, value)
    set_updated_by(order, current_user)
    old_val, new_val = summarize_changes(old_snapshot, {k: getattr(order, k) for k in data})
    log_activity(
        db,
        user=current_user,
        action="Изменила заказ на вынос",
        entity_type="takeaway_order",
        entity_id=order.id,
        entity_label=order.guest_name,
        old_value=old_val,
        new_value=new_val,
    )
    db.commit()
    db.refresh(order)
    return order


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_takeaway_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    order = (
        db.query(TakeawayOrder)
        .filter(TakeawayOrder.id == order_id, TakeawayOrder.deleted_at.is_(None))
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Заказ не найден")

    name = order.guest_name
    order.deleted_at = datetime.now(timezone.utc)
    set_updated_by(order, current_user)
    log_activity(
        db,
        user=current_user,
        action="Удалила заказ на вынос",
        entity_type="takeaway_order",
        entity_id=order.id,
        entity_label=name,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
