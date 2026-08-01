from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.guest_service import (
    LAUNDRY_HOTEL_PRICE,
    LAUNDRY_OWN_POWDER_PRICE,
    GuestService,
)
from app.models.user import User
from app.schemas.guest_service import (
    GuestServiceCreate,
    GuestServiceResponse,
    GuestServiceUpdate,
)
from app.services.audit import log_activity, set_created_by, set_updated_by, summarize_changes

router = APIRouter(prefix="/guest-services", tags=["guest-services"])

SERVICE_LABELS = {
    "laundry_hotel": "Стирка (порошок гостиницы)",
    "laundry_own": "Стирка (свой порошок)",
}


def unit_price_for(service_type: str) -> Decimal:
    if service_type == "laundry_hotel":
        return LAUNDRY_HOTEL_PRICE
    if service_type == "laundry_own":
        return LAUNDRY_OWN_POWDER_PRICE
    raise HTTPException(status_code=400, detail="Неизвестный тип услуги")


def apply_pricing(row: GuestService) -> None:
    unit = unit_price_for(row.service_type)
    count = max(1, int(row.item_count or 1))
    row.item_count = count
    row.unit_price = unit
    row.amount = unit * count


def normalize_payment(row: GuestService) -> None:
    if row.payment_status == "unpaid":
        row.payment_method = None
        row.payment_date = None
    elif row.payment_status == "paid" and not row.payment_date:
        row.payment_date = row.service_date


@router.get("", response_model=list[GuestServiceResponse])
def list_guest_services(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    author_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[GuestService]:
    query = db.query(GuestService).filter(GuestService.deleted_at.is_(None))
    if date_from:
        query = query.filter(GuestService.service_date >= date_from)
    if date_to:
        query = query.filter(GuestService.service_date <= date_to)
    if author_id is not None:
        query = query.filter(GuestService.created_by_user_id == author_id)
    return query.order_by(GuestService.service_date.desc(), GuestService.id.desc()).all()


@router.post("", response_model=GuestServiceResponse, status_code=status.HTTP_201_CREATED)
def create_guest_service(
    payload: GuestServiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> GuestService:
    row = GuestService(**payload.model_dump())
    apply_pricing(row)
    normalize_payment(row)
    set_created_by(row, current_user)
    db.add(row)
    db.flush()
    label = SERVICE_LABELS.get(row.service_type, row.service_type)
    log_activity(
        db,
        user=current_user,
        action="Создала услугу для гостя",
        entity_type="guest_service",
        entity_id=row.id,
        entity_label=f"{label}: {row.guest_name}",
        new_value=f"{row.item_count} шт. · {row.amount} ₸",
    )
    db.commit()
    db.refresh(row)
    from app.services.supabase_crm_sync import queue_entity_sync

    queue_entity_sync("guest_services", row)
    return row


@router.patch("/{service_id}", response_model=GuestServiceResponse)
def update_guest_service(
    service_id: int,
    payload: GuestServiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> GuestService:
    row = (
        db.query(GuestService)
        .filter(GuestService.id == service_id, GuestService.deleted_at.is_(None))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Услуга не найдена")

    data = payload.model_dump(exclude_unset=True)
    old_snapshot = {k: getattr(row, k) for k in data}
    for key, value in data.items():
        setattr(row, key, value)
    apply_pricing(row)
    normalize_payment(row)
    set_updated_by(row, current_user)
    old_val, new_val = summarize_changes(old_snapshot, {k: getattr(row, k) for k in data})
    label = SERVICE_LABELS.get(row.service_type, row.service_type)
    log_activity(
        db,
        user=current_user,
        action="Изменила услугу для гостя",
        entity_type="guest_service",
        entity_id=row.id,
        entity_label=f"{label}: {row.guest_name}",
        old_value=old_val,
        new_value=new_val,
    )
    db.commit()
    db.refresh(row)
    from app.services.supabase_crm_sync import queue_entity_sync

    queue_entity_sync("guest_services", row)
    return row


@router.delete("/{service_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_guest_service(
    service_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    row = (
        db.query(GuestService)
        .filter(GuestService.id == service_id, GuestService.deleted_at.is_(None))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Услуга не найдена")
    row.deleted_at = datetime.now(timezone.utc)
    set_updated_by(row, current_user)
    label = SERVICE_LABELS.get(row.service_type, row.service_type)
    log_activity(
        db,
        user=current_user,
        action="Удалила услугу для гостя",
        entity_type="guest_service",
        entity_id=row.id,
        entity_label=f"{label}: {row.guest_name}",
    )
    db.commit()
    from app.services.supabase_crm_sync import queue_entity_sync

    queue_entity_sync("guest_services", row, soft_delete=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
