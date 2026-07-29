from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.app_settings import AppSettings


def get_or_create_settings(db: Session) -> AppSettings:
    settings = db.query(AppSettings).first()
    if settings is None:
        settings = AppSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings
