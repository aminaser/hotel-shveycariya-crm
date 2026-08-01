from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.permissions import require_owner
from app.models.spa_booking_local import SpaBookingLocal
from app.models.user import User
from app.schemas.sync_entities import (
    SpaBookingCreate,
    SpaBookingResponse,
    SpaBookingUpdate,
)
from app.services.supabase_crm_sync import (
    ensure_cloud_id,
    mark_entity_dirty,
    run_full_sync,
    _spa_payload,
    enqueue_outbox,
)

router = APIRouter(prefix="/spa-bookings", tags=["spa-bookings"])


def _to_response(row: SpaBookingLocal) -> SpaBookingResponse:
    return SpaBookingResponse(
        id=row.cloud_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        deleted_at=row.deleted_at,
        booking_date=row.booking_date,
        slot_time=row.slot_time,
        service=row.service,
        guest_name=row.guest_name,
        guest_phone=row.guest_phone,
        room=row.room,
        is_hotel_guest=row.is_hotel_guest,
        people_count=row.people_count,
        status=row.status,
        source=row.source,
        request_id=row.request_id,
        notes=row.notes,
        price=row.price,
        payment_method=row.payment_method,
        payment_date=row.payment_date,
        created_by_name=row.created_by_name,
        updated_by_name=row.updated_by_name,
    )


def _author_name(user: User) -> str:
    return (user.full_name or user.username or "").strip() or "CRM"


@router.get("", response_model=list[SpaBookingResponse])
def list_spa_bookings(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    include_deleted: bool = Query(False),
    deleted_only: bool = Query(False),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[SpaBookingResponse]:
    run_full_sync(db)
    q = db.query(SpaBookingLocal)
    if deleted_only:
        q = q.filter(SpaBookingLocal.deleted_at.isnot(None))
    elif not include_deleted:
        q = q.filter(SpaBookingLocal.deleted_at.is_(None))
    if date_from:
        q = q.filter(SpaBookingLocal.booking_date >= date_from)
    if date_to:
        q = q.filter(SpaBookingLocal.booking_date <= date_to)
    rows = q.order_by(
        SpaBookingLocal.booking_date.desc(), SpaBookingLocal.slot_time.asc()
    ).all()
    return [_to_response(r) for r in rows]


@router.delete("/trash", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def purge_spa_bookings_trash(
    db: Session = Depends(get_db),
    _: User = Depends(require_owner),
) -> Response:
    rows = (
        db.query(SpaBookingLocal)
        .filter(SpaBookingLocal.deleted_at.isnot(None))
        .all()
    )
    for row in rows:
        enqueue_outbox(db, "spa_bookings", ensure_cloud_id(row), "delete")
        db.delete(row)
    db.commit()
    run_full_sync(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("", response_model=SpaBookingResponse)
def create_spa_booking(
    payload: SpaBookingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SpaBookingResponse:
    author = _author_name(current_user)
    row = SpaBookingLocal(
        cloud_id=str(uuid.uuid4()),
        booking_date=payload.booking_date,
        slot_time=payload.slot_time,
        service=payload.service,
        guest_name=payload.guest_name.strip(),
        guest_phone=payload.guest_phone,
        room=payload.room,
        is_hotel_guest=payload.is_hotel_guest,
        people_count=payload.people_count or 1,
        status=payload.status or "confirmed",
        source=payload.source or "crm",
        notes=payload.notes,
        price=payload.price,
        payment_method=payload.payment_method,
        payment_date=payload.payment_date,
        created_by_name=author,
        updated_by_name=author,
    )
    if not row.guest_name:
        raise HTTPException(status_code=400, detail="Укажите имя гостя")
    db.add(row)
    enqueue_outbox(db, "spa_bookings", row.cloud_id, "upsert", _spa_payload(row))
    db.commit()
    db.refresh(row)
    run_full_sync(db)
    return _to_response(row)


@router.patch("/{booking_id}", response_model=SpaBookingResponse)
def update_spa_booking(
    booking_id: str,
    payload: SpaBookingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SpaBookingResponse:
    row = (
        db.query(SpaBookingLocal)
        .filter(SpaBookingLocal.cloud_id == booking_id)
        .first()
    )
    if not row or row.deleted_at:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(row, key, value)
    row.updated_by_name = _author_name(current_user)
    row.updated_at = datetime.now(timezone.utc)
    enqueue_outbox(db, "spa_bookings", row.cloud_id, "upsert", _spa_payload(row))
    db.commit()
    db.refresh(row)
    run_full_sync(db)
    return _to_response(row)


@router.delete("/{booking_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_spa_booking(
    booking_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    row = (
        db.query(SpaBookingLocal)
        .filter(SpaBookingLocal.cloud_id == booking_id)
        .first()
    )
    if not row or row.deleted_at:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    row.deleted_at = datetime.now(timezone.utc)
    row.updated_by_name = _author_name(current_user)
    mark_entity_dirty(db, "spa_bookings", row, soft_delete=True)
    enqueue_outbox(db, "spa_bookings", ensure_cloud_id(row), "delete")
    db.commit()
    run_full_sync(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{booking_id}/restore", response_model=SpaBookingResponse)
def restore_spa_booking(
    booking_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SpaBookingResponse:
    row = (
        db.query(SpaBookingLocal)
        .filter(SpaBookingLocal.cloud_id == booking_id)
        .first()
    )
    if not row or not row.deleted_at:
        raise HTTPException(status_code=404, detail="Запись не найдена в корзине")
    row.deleted_at = None
    row.updated_by_name = _author_name(current_user)
    row.updated_at = datetime.now(timezone.utc)
    enqueue_outbox(
        db, "spa_bookings", ensure_cloud_id(row), "upsert", _spa_payload(row)
    )
    db.commit()
    db.refresh(row)
    run_full_sync(db)
    return _to_response(row)
