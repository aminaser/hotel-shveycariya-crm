from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.permissions import require_owner
from app.models.guest_request_local import GuestRequestLocal
from app.models.spa_booking_local import SpaBookingLocal
from app.models.user import User
from app.schemas.sync_entities import GuestRequestResponse, GuestRequestUpdate
from app.services.supabase_crm_sync import (
    ensure_cloud_id,
    enqueue_outbox,
    run_full_sync,
    _request_payload,
    _spa_payload,
)

router = APIRouter(prefix="/guest-requests", tags=["guest-requests"])


def _to_response(row: GuestRequestLocal) -> GuestRequestResponse:
    return GuestRequestResponse(
        id=row.cloud_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        deleted_at=row.deleted_at,
        room=row.room,
        guest_name=row.guest_name,
        type=row.type,
        title=row.title,
        description=row.description,
        stage=row.stage,
        language=row.language,
        photo_url=row.photo_url,
        priority=row.priority,
        rating=row.rating,
        source=row.source,
        created_by_name=row.created_by_name,
        updated_by_name=row.updated_by_name,
        confirmed_by_name=row.confirmed_by_name,
    )


def _author_name(user: User) -> str:
    return (user.full_name or user.username or "").strip() or "CRM"


@router.get("", response_model=list[GuestRequestResponse])
def list_guest_requests(
    include_deleted: bool = Query(False),
    deleted_only: bool = Query(False),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[GuestRequestResponse]:
    run_full_sync(db)
    q = db.query(GuestRequestLocal)
    if deleted_only:
        q = q.filter(GuestRequestLocal.deleted_at.isnot(None))
    elif not include_deleted:
        q = q.filter(GuestRequestLocal.deleted_at.is_(None))
    rows = q.order_by(GuestRequestLocal.created_at.desc()).all()
    return [_to_response(r) for r in rows]


@router.delete("/trash", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def purge_guest_requests_trash(
    db: Session = Depends(get_db),
    _: User = Depends(require_owner),
) -> Response:
    rows = (
        db.query(GuestRequestLocal)
        .filter(GuestRequestLocal.deleted_at.isnot(None))
        .all()
    )
    for row in rows:
        enqueue_outbox(db, "guest_requests", ensure_cloud_id(row), "delete")
        db.delete(row)
    db.commit()
    run_full_sync(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{request_id}", response_model=GuestRequestResponse)
def update_guest_request(
    request_id: str,
    payload: GuestRequestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> GuestRequestResponse:
    row = (
        db.query(GuestRequestLocal)
        .filter(GuestRequestLocal.cloud_id == request_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(row, key, value)
    author = _author_name(current_user)
    row.updated_by_name = author
    stage = data.get("stage")
    if stage == "assigned":
        row.confirmed_by_name = author
    row.updated_at = datetime.now(timezone.utc)
    ensure_cloud_id(row)
    enqueue_outbox(db, "guest_requests", row.cloud_id, "upsert", _request_payload(row))

    # Mirror linked spa booking status when request stage changes.
    spa_status = None
    if stage == "assigned":
        spa_status = "confirmed"
    elif stage == "done":
        spa_status = "done"
    elif stage == "received":
        spa_status = "pending"
    if spa_status:
        linked = (
            db.query(SpaBookingLocal)
            .filter(
                SpaBookingLocal.request_id == request_id,
                SpaBookingLocal.deleted_at.is_(None),
            )
            .all()
        )
        for spa in linked:
            spa.status = spa_status
            spa.updated_by_name = author
            spa.updated_at = datetime.now(timezone.utc)
            enqueue_outbox(
                db, "spa_bookings", ensure_cloud_id(spa), "upsert", _spa_payload(spa)
            )

    db.commit()
    db.refresh(row)
    run_full_sync(db)
    return _to_response(row)


@router.post("/{request_id}/restore", response_model=GuestRequestResponse)
def restore_guest_request(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> GuestRequestResponse:
    row = (
        db.query(GuestRequestLocal)
        .filter(GuestRequestLocal.cloud_id == request_id)
        .first()
    )
    if not row or not row.deleted_at:
        raise HTTPException(status_code=404, detail="Заявка не найдена в корзине")
    row.deleted_at = None
    row.updated_by_name = _author_name(current_user)
    row.updated_at = datetime.now(timezone.utc)
    enqueue_outbox(
        db, "guest_requests", ensure_cloud_id(row), "upsert", _request_payload(row)
    )
    db.commit()
    db.refresh(row)
    run_full_sync(db)
    return _to_response(row)


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def soft_delete_guest_request(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    row = (
        db.query(GuestRequestLocal)
        .filter(GuestRequestLocal.cloud_id == request_id)
        .first()
    )
    if not row or row.deleted_at:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    row.deleted_at = datetime.now(timezone.utc)
    row.updated_by_name = _author_name(current_user)
    enqueue_outbox(db, "guest_requests", ensure_cloud_id(row), "delete")
    db.commit()
    run_full_sync(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
