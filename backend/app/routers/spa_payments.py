from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.spa_booking_payment import SpaBookingPayment
from app.models.user import User
from app.schemas.spa_booking_payment import (
    SpaBookingPaymentResponse,
    SpaBookingPaymentUpsert,
)

router = APIRouter(prefix="/spa-payments", tags=["spa-payments"])


@router.get("", response_model=list[SpaBookingPaymentResponse])
def list_spa_payments(
    booking_ids: Optional[str] = Query(
        default=None,
        description="Comma-separated Supabase spa_bookings ids",
    ),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[SpaBookingPayment]:
    query = db.query(SpaBookingPayment).filter(SpaBookingPayment.deleted_at.is_(None))
    if booking_ids:
        ids = [part.strip() for part in booking_ids.split(",") if part.strip()]
        if ids:
            query = query.filter(SpaBookingPayment.booking_id.in_(ids))
    if date_from is not None:
        query = query.filter(SpaBookingPayment.payment_date >= date_from)
    if date_to is not None:
        query = query.filter(SpaBookingPayment.payment_date <= date_to)
    return query.order_by(SpaBookingPayment.payment_date.desc().nullslast()).all()


@router.put("", response_model=SpaBookingPaymentResponse)
def upsert_spa_payment(
    payload: SpaBookingPaymentUpsert,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> SpaBookingPayment:
    row = (
        db.query(SpaBookingPayment)
        .filter(SpaBookingPayment.booking_id == payload.booking_id)
        .first()
    )
    amount = payload.amount or 0
    paid = amount > 0
    method = payload.payment_method if paid else None
    pay_date = payload.payment_date if paid else None

    if row is None:
        row = SpaBookingPayment(
            booking_id=payload.booking_id,
            amount=amount,
            payment_method=method,
            payment_date=pay_date,
        )
        db.add(row)
    else:
        row.amount = amount
        row.payment_method = method
        row.payment_date = pay_date
        row.deleted_at = None

    db.commit()
    db.refresh(row)
    return row


@router.delete("/{booking_id}", status_code=status.HTTP_204_NO_CONTENT)
def soft_delete_spa_payment(
    booking_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    row = (
        db.query(SpaBookingPayment)
        .filter(
            SpaBookingPayment.booking_id == booking_id,
            SpaBookingPayment.deleted_at.is_(None),
        )
        .first()
    )
    if row:
        row.deleted_at = datetime.now(timezone.utc)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{booking_id}/restore", response_model=Optional[SpaBookingPaymentResponse])
def restore_spa_payment(
    booking_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> SpaBookingPayment | None:
    row = (
        db.query(SpaBookingPayment)
        .filter(SpaBookingPayment.booking_id == booking_id)
        .first()
    )
    if not row:
        return None
    row.deleted_at = None
    db.commit()
    db.refresh(row)
    return row
