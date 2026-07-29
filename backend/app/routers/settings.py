from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.core.config import BACKUPS_DIR, DATA_DIR, settings
from app.core.database import get_db
from app.core.deps import get_current_user
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
    _: User = Depends(get_current_user),
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
    shutil.copy2(DB_PATH, backup_path)

    app_settings = get_or_create_settings(db)
    app_settings.last_backup_at = datetime.now(timezone.utc)
    db.commit()

    return BackupResponse(path=str(backup_path), created_at=app_settings.last_backup_at)


@router.post("/restore", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def restore_backup(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    if not file.filename or not file.filename.endswith(".db"):
        raise HTTPException(status_code=400, detail="Нужен файл .db")

    contents = await file.read()
    temp_path = BACKUPS_DIR / f"restore_{datetime.now(timezone.utc).timestamp()}.db"
    temp_path.write_bytes(contents)
    shutil.copy2(temp_path, DB_PATH)
    temp_path.unlink(missing_ok=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
