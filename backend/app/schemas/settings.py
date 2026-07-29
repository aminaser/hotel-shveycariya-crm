from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class AppSettingsResponse(BaseModel):
    hotel_name: str
    hotel_city: str
    hotel_legal_name: str | None
    hotel_bin: str | None
    hotel_address: str | None
    hotel_director: str | None
    timezone: str
    currency: str
    last_backup_at: datetime | None
    auto_lock_minutes: int
    auto_backup_on_exit: bool
    database_path: str

    model_config = {"from_attributes": True}


class AppSettingsUpdate(BaseModel):
    hotel_name: str | None = Field(default=None, max_length=128)
    hotel_city: str | None = Field(default=None, max_length=128)
    hotel_legal_name: str | None = Field(default=None, max_length=255)
    hotel_bin: str | None = Field(default=None, max_length=12)
    hotel_address: str | None = Field(default=None, max_length=512)
    hotel_director: str | None = Field(default=None, max_length=255)
    auto_lock_minutes: int | None = Field(default=None, ge=1, le=120)
    auto_backup_on_exit: bool | None = None


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)


class BackupResponse(BaseModel):
    path: str
    created_at: datetime
