from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[3]

# Electron sets HOTEL_CRM_DATA_DIR to a writable userData path in production.
# Dev falls back to <repo>/data.
_data_override = os.environ.get("HOTEL_CRM_DATA_DIR", "").strip()
DATA_DIR = Path(_data_override) if _data_override else ROOT_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
BACKUPS_DIR = DATA_DIR / "backups"
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

# Load .env from the backend package dir (cwd may differ).
_ENV_FILE = ROOT_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE.exists() else ".env",
        extra="ignore",
    )

    app_name: str = "Hotel Shveycariya CRM"
    database_url: str = f"sqlite:///{DATA_DIR / 'hotel_crm.db'}"
    # Override via SECRET_KEY in .env for production. Desktop installs may keep the default.
    secret_key: str = "dev-secret-change-in-production"
    access_token_expire_minutes: int = 60 * 24 * 7
    algorithm: str = "HS256"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ]
    supabase_url: str = ""
    supabase_key: str = ""


settings = Settings()
