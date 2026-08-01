from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.sync_meta import SyncOutbox
from app.models.user import User
from app.schemas.sync_entities import SyncStatusResponse
from app.services.supabase_crm_sync import get_sync_status, probe_online, run_full_sync

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/status", response_model=SyncStatusResponse)
def sync_status(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> SyncStatusResponse:
    # Refresh reachability on each poll so the UI chip is not stuck on startup False.
    online = probe_online()
    status = get_sync_status()
    pending = 0
    try:
        pending = db.query(SyncOutbox).count()
    except Exception:
        pending = int(status.get("pending_outbox") or 0)
    return SyncStatusResponse(
        online=online,
        syncing=bool(status.get("syncing")),
        last_sync_at=status.get("last_sync_at"),
        last_error=status.get("last_error"),
        pending_outbox=pending,
    )


@router.post("/run", response_model=SyncStatusResponse)
def sync_now(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> SyncStatusResponse:
    status = run_full_sync(db)
    return SyncStatusResponse(
        online=bool(status.get("online")),
        syncing=bool(status.get("syncing")),
        last_sync_at=status.get("last_sync_at"),
        last_error=status.get("last_error"),
        pending_outbox=int(status.get("pending_outbox") or 0),
    )
