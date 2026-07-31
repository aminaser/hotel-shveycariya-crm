from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.config import DATA_DIR

MENU_PATH = DATA_DIR / "restaurant_menu.json"


def load_saved_menu() -> list[dict[str, Any]] | None:
    if not MENU_PATH.exists():
        return None
    try:
        data = json.loads(MENU_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, list):
        return None
    return data


def save_menu(tabs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    MENU_PATH.parent.mkdir(parents=True, exist_ok=True)
    MENU_PATH.write_text(
        json.dumps(tabs, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return tabs
