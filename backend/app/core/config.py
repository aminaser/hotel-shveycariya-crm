from __future__ import annotations

import os
import shutil
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[3]


def _resolve_data_dir() -> Path:
    """Prefer Electron AppData path so reinstalls do not wipe the CRM database.

    Packaged Electron sets HOTEL_CRM_DATA_DIR=%APPDATA%/.../data.
    Without it (dev), fall back to backend/../data.
    """
    raw = (os.environ.get("HOTEL_CRM_DATA_DIR") or "").strip()
    if raw:
        return Path(raw)
    return ROOT_DIR / "data"


DATA_DIR = _resolve_data_dir()
DATA_DIR.mkdir(parents=True, exist_ok=True)
BACKUPS_DIR = DATA_DIR / "backups"
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)


def recover_legacy_database() -> str | None:
    """If AppData DB is missing/empty, copy from old install-dir location or backups."""
    target = DATA_DIR / "hotel_crm.db"
    if target.exists() and target.stat().st_size > 1024:
        return None

    candidates: list[Path] = [
        ROOT_DIR / "data" / "hotel_crm.db",
        ROOT_DIR / "data" / "backups",
    ]

    # Windows NSIS may leave the previous tree as «….__old» after ForceRemoveInstallDir.
    local_app = os.environ.get("LOCALAPPDATA", "").strip()
    if local_app:
        programs = Path(local_app) / "Programs"
        for name in (
            "Hotel Shveycariya CRM.__old",
            "HotelShveycariyaCRM.__old",
            "Hotel Shveycariya CRM",
            "HotelShveycariyaCRM",
        ):
            base = programs / name / "resources" / "backend" / "data"
            candidates.append(base / "hotel_crm.db")
            candidates.append(base / "backups")

    best: Path | None = None
    best_size = 0
    for item in candidates:
        if not item.exists():
            continue
        if item.is_file() and item.name.endswith(".db"):
            size = item.stat().st_size
            if size > best_size:
                best, best_size = item, size
            continue
        if item.is_dir():
            for backup in sorted(item.glob("hotel_crm_*.db"), reverse=True):
                size = backup.stat().st_size
                if size > best_size:
                    best, best_size = backup, size

    if best is None or best_size <= 1024:
        return None

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best, target)
    for suffix in ("-wal", "-shm"):
        side = Path(str(best) + suffix)
        if side.exists():
            shutil.copy2(side, Path(str(target) + suffix))
    return str(best)


# Attempt recovery as soon as config loads (before SQLAlchemy opens the DB).
RECOVERED_DB_FROM = recover_legacy_database()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Hotel Shveycariya CRM"
    database_url: str = f"sqlite:///{DATA_DIR / 'hotel_crm.db'}"
    secret_key: str = "dev-secret-change-in-production"
    access_token_expire_minutes: int = 60 * 24 * 30
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
