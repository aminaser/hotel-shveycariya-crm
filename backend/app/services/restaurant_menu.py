from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from app.core.config import DATA_DIR

logger = logging.getLogger(__name__)

MENU_PATH = DATA_DIR / "restaurant_menu.json"
TAKEAWAY_MENU_PATH = DATA_DIR / "takeaway_menu.json"


def _load_menu(path: Path) -> list[dict[str, Any]] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, list):
        return None
    return data


def _save_menu(path: Path, tabs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(tabs, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return tabs


def _push_menu_cloud(doc_id: str, tabs: list[dict[str, Any]], updated_by: str | None = None) -> None:
    try:
        from app.services.supabase_crm_sync import push_menu_doc

        push_menu_doc(doc_id, tabs, updated_by_name=updated_by)
    except Exception:
        logger.warning("Menu cloud push skipped (%s)", doc_id, exc_info=True)


def load_saved_menu() -> list[dict[str, Any]] | None:
    return _load_menu(MENU_PATH)


def save_menu(
    tabs: list[dict[str, Any]],
    *,
    updated_by: str | None = None,
) -> list[dict[str, Any]]:
    saved = _save_menu(MENU_PATH, tabs)
    _push_menu_cloud("restaurant", saved, updated_by)
    return saved


def load_saved_takeaway_menu() -> list[dict[str, Any]] | None:
    return _load_menu(TAKEAWAY_MENU_PATH)


def save_takeaway_menu(
    tabs: list[dict[str, Any]],
    *,
    updated_by: str | None = None,
) -> list[dict[str, Any]]:
    saved = _save_menu(TAKEAWAY_MENU_PATH, tabs)
    _push_menu_cloud("takeaway", saved, updated_by)
    return saved


def apply_cloud_menu_doc(doc_id: str, tabs: list[dict[str, Any]]) -> None:
    """Overwrite local menu file from cloud snapshot."""
    if doc_id == "restaurant":
        _save_menu(MENU_PATH, tabs)
    elif doc_id == "takeaway":
        _save_menu(TAKEAWAY_MENU_PATH, tabs)
