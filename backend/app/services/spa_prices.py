from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.config import DATA_DIR

SPA_PRICES_PATH = DATA_DIR / "spa_prices.json"

DEFAULT_SPA_PRICES: dict[str, float] = {
    "sauna": 5000,
    "banya": 5000,
}


def load_spa_prices() -> dict[str, float]:
    if not SPA_PRICES_PATH.exists():
        return dict(DEFAULT_SPA_PRICES)
    try:
        data = json.loads(SPA_PRICES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_SPA_PRICES)
    if not isinstance(data, dict):
        return dict(DEFAULT_SPA_PRICES)
    result = dict(DEFAULT_SPA_PRICES)
    for key in ("sauna", "banya"):
        raw = data.get(key)
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value >= 0:
            result[key] = value
    return result


def save_spa_prices(prices: dict[str, Any]) -> dict[str, float]:
    result = dict(DEFAULT_SPA_PRICES)
    for key in ("sauna", "banya"):
        raw = prices.get(key, result[key])
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value >= 0:
            result[key] = value
    SPA_PRICES_PATH.parent.mkdir(parents=True, exist_ok=True)
    SPA_PRICES_PATH.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return result
