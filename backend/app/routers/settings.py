from __future__ import annotations

import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.core.config import BACKUPS_DIR, DATA_DIR, settings
from app.core.database import engine, get_db
from app.core.deps import get_current_user
from app.core.permissions import require_owner
from app.core.security import get_password_hash, verify_password
from app.models.user import User
from app.schemas.settings import (
    AppSettingsResponse,
    AppSettingsUpdate,
    BackupResponse,
    PasswordChangeRequest,
)
from app.services.audit import log_activity
from app.services.settings_service import get_or_create_settings

router = APIRouter(prefix="/settings", tags=["settings"])

DB_PATH = DATA_DIR / "hotel_crm.db"
SQLITE_HEADER = b"SQLite format 3\x00"
# Auto-backup on exit creates a file every close — keep only the newest ones.
MAX_BACKUPS = 20


def _prune_old_backups(keep: int = MAX_BACKUPS) -> None:
    backups = sorted(
        BACKUPS_DIR.glob("hotel_crm_*.db"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for old in backups[keep:]:
        try:
            old.unlink(missing_ok=True)
        except OSError:
            pass
        for suffix in ("-wal", "-shm"):
            try:
                old.with_name(old.name + suffix).unlink(missing_ok=True)
            except OSError:
                pass

    # Orphan sidecars left after older cleanups / interrupted SQLite copies.
    for sidecar in list(BACKUPS_DIR.glob("hotel_crm_*.db-wal")) + list(
        BACKUPS_DIR.glob("hotel_crm_*.db-shm")
    ):
        main = BACKUPS_DIR / sidecar.name.removesuffix("-wal").removesuffix("-shm")
        if not main.exists():
            try:
                sidecar.unlink(missing_ok=True)
            except OSError:
                pass


def _settings_response(app_settings, db_path: str) -> AppSettingsResponse:
    return AppSettingsResponse(
        hotel_name=app_settings.hotel_name,
        hotel_city=app_settings.hotel_city,
        hotel_legal_name=app_settings.hotel_legal_name,
        hotel_bin=app_settings.hotel_bin,
        hotel_address=app_settings.hotel_address,
        hotel_director=app_settings.hotel_director,
        timezone=app_settings.timezone,
        currency=app_settings.currency,
        last_backup_at=app_settings.last_backup_at,
        auto_lock_minutes=app_settings.auto_lock_minutes,
        auto_backup_on_exit=app_settings.auto_backup_on_exit,
        database_path=str(db_path),
    )


@router.get("", response_model=AppSettingsResponse)
def get_settings(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> AppSettingsResponse:
    app_settings = get_or_create_settings(db)
    return _settings_response(app_settings, DB_PATH)


@router.patch("", response_model=AppSettingsResponse)
def update_settings(
    payload: AppSettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_owner),
) -> AppSettingsResponse:
    app_settings = get_or_create_settings(db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(app_settings, key, value)
    db.commit()
    db.refresh(app_settings)
    return _settings_response(app_settings, DB_PATH)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def change_password(
    payload: PasswordChangeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Неверный текущий пароль")
    current_user.password_hash = get_password_hash(payload.new_password)
    log_activity(
        db,
        user=current_user,
        action="Изменила свой пароль",
        entity_type="user",
        entity_id=current_user.id,
        entity_label=current_user.full_name or current_user.username,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/backup", response_model=BackupResponse)
def create_backup(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> BackupResponse:
    if not DB_PATH.exists():
        raise HTTPException(status_code=404, detail="База данных не найдена")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_path = BACKUPS_DIR / f"hotel_crm_{timestamp}.db"

    # Use SQLite online backup API so WAL contents are included.
    src = sqlite3.connect(str(DB_PATH))
    try:
        dst = sqlite3.connect(str(backup_path))
        try:
            src.backup(dst)
            dst.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            dst.close()
    finally:
        src.close()

    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(backup_path) + suffix)
        try:
            sidecar.unlink(missing_ok=True)
        except OSError:
            pass

    app_settings = get_or_create_settings(db)
    app_settings.last_backup_at = datetime.now(timezone.utc)
    db.commit()

    _prune_old_backups()

    return BackupResponse(path=str(backup_path), created_at=app_settings.last_backup_at)


@router.post("/restore", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def restore_backup(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_owner),
) -> Response:
    if not file.filename or not file.filename.endswith(".db"):
        raise HTTPException(status_code=400, detail="Нужен файл .db")

    contents = await file.read()
    if not contents.startswith(SQLITE_HEADER):
        raise HTTPException(status_code=400, detail="Файл не является базой SQLite")

    # Validate uploaded file is a readable SQLite DB before swapping.
    temp_path = BACKUPS_DIR / f"restore_{datetime.now(timezone.utc).timestamp()}.db"
    temp_path.write_bytes(contents)
    try:
        probe = sqlite3.connect(str(temp_path))
        try:
            probe.execute("PRAGMA schema_version")
            tables = {
                row[0]
                for row in probe.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
        finally:
            probe.close()
    except sqlite3.Error as exc:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Повреждённый файл базы: {exc}") from exc

    if "users" not in tables:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="В файле нет таблиц CRM")

    # Close ORM sessions / pooled connections so WAL cannot overwrite the restore.
    db.close()
    engine.dispose()

    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(DB_PATH) + suffix)
        try:
            sidecar.unlink(missing_ok=True)
        except OSError:
            pass

    shutil.copy2(temp_path, DB_PATH)
    temp_path.unlink(missing_ok=True)

    # Make sure no leftover WAL from the copy target remains.
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(DB_PATH) + suffix)
        try:
            sidecar.unlink(missing_ok=True)
        except OSError:
            pass

    return Response(status_code=status.HTTP_204_NO_CONTENT)
