from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.takeaway_order import TakeawayFulfillmentStatus, TakeawayOrder
from app.models.user import User
from app.schemas.takeaway_order import (
    TakeawayOrderCreate,
    TakeawayOrderResponse,
    TakeawayOrderUpdate,
)
from app.services.audit import log_activity, set_created_by, set_updated_by, summarize_changes
from app.services.supabase_crm_sync import (
    ensure_cloud_id,
    soft_delete_takeaway,
    sync_takeaways,
    upsert_takeaway,
)

router = APIRouter(prefix="/takeaway-orders", tags=["takeaway-orders"])


def _parse_order_clock(raw: str | None) -> time | None:
    text = (raw or "").strip()
    if not text:
        return None
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(text[:8] if fmt.endswith("S") else text[:5], fmt).time()
        except ValueError:
            continue
    return None


def _order_due_local(order: TakeawayOrder) -> datetime | None:
    """When the pickup window ends (local naive datetime)."""
    clock = _parse_order_clock(order.order_time)
    if clock is None:
        # No time → end of the order day.
        clock = time(23, 59, 59)
    return datetime.combine(order.order_date, clock)


def _normalize_fulfillment_status(
    value: str | TakeawayFulfillmentStatus | None,
) -> str:
    if value is None:
        return TakeawayFulfillmentStatus.waiting.value
    if isinstance(value, TakeawayFulfillmentStatus):
        return value.value
    text = str(value).strip().lower()
    if text in ("picked_up", "picked-up", "done", "забрали"):
        return TakeawayFulfillmentStatus.picked_up.value
    return TakeawayFulfillmentStatus.waiting.value


def _auto_mark_overdue_picked_up(db: Session, orders: list[TakeawayOrder]) -> None:
    """Flip waiting → picked_up once order date/time has passed."""
    now = datetime.now()
    changed: list[TakeawayOrder] = []
    for order in orders:
        status = _normalize_fulfillment_status(getattr(order, "fulfillment_status", None))
        if status != TakeawayFulfillmentStatus.waiting.value:
            if getattr(order, "fulfillment_status", None) != status:
                order.fulfillment_status = status
            continue
        due = _order_due_local(order)
        if due is None or now < due:
            if getattr(order, "fulfillment_status", None) != TakeawayFulfillmentStatus.waiting.value:
                order.fulfillment_status = TakeawayFulfillmentStatus.waiting.value
            continue
        order.fulfillment_status = TakeawayFulfillmentStatus.picked_up.value
        changed.append(order)

    if not changed:
        return
    db.commit()
    for order in changed:
        db.refresh(order)
        upsert_takeaway(order)


@router.get("", response_model=list[TakeawayOrderResponse])
def list_takeaway_orders(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    author_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[TakeawayOrder]:
    sync_takeaways(db)
    query = db.query(TakeawayOrder).filter(TakeawayOrder.deleted_at.is_(None))
    if date_from:
        query = query.filter(TakeawayOrder.order_date >= date_from)
    if date_to:
        query = query.filter(TakeawayOrder.order_date <= date_to)
    if author_id is not None:
        query = query.filter(TakeawayOrder.created_by_user_id == author_id)
    orders = query.order_by(TakeawayOrder.order_date.desc(), TakeawayOrder.id.desc()).all()
    _auto_mark_overdue_picked_up(db, orders)
    return orders


@router.post("", response_model=TakeawayOrderResponse, status_code=status.HTTP_201_CREATED)
def create_takeaway_order(
    payload: TakeawayOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TakeawayOrder:
    data = payload.model_dump()
    data["fulfillment_status"] = _normalize_fulfillment_status(
        data.get("fulfillment_status")
    )
    order = TakeawayOrder(**data)
    ensure_cloud_id(order)
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
    upsert_takeaway(order)
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
    if "fulfillment_status" in data:
        data["fulfillment_status"] = _normalize_fulfillment_status(
            data.get("fulfillment_status")
        )
    old_snapshot = {k: getattr(order, k) for k in data}
    for key, value in data.items():
        setattr(order, key, value)
    ensure_cloud_id(order)
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
    upsert_takeaway(order)
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
    ensure_cloud_id(order)
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
    soft_delete_takeaway(order)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
