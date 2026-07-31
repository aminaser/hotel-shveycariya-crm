from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.config import DATA_DIR

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


def load_saved_menu() -> list[dict[str, Any]] | None:
    return _load_menu(MENU_PATH)


def save_menu(tabs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return _save_menu(MENU_PATH, tabs)


def load_saved_takeaway_menu() -> list[dict[str, Any]] | None:
    return _load_menu(TAKEAWAY_MENU_PATH)


def save_takeaway_menu(tabs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return _save_menu(TAKEAWAY_MENU_PATH, tabs)