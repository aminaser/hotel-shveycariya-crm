from __future__ import annotations

import json
from typing import Any

from app.core.config import DATA_DIR

AS_PRICES_PATH = DATA_DIR / "as_prices.json"
DEFAULT_PRICE_PER_PERSON = 3_000.0


def load_as_price_per_person() -> float:
    if not AS_PRICES_PATH.exists():
        return DEFAULT_PRICE_PER_PERSON
    try:
        data = json.loads(AS_PRICES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return DEFAULT_PRICE_PER_PERSON
    if not isinstance(data, dict):
        return DEFAULT_PRICE_PER_PERSON
    try:
        value = float(data.get("price_per_person", DEFAULT_PRICE_PER_PERSON))
    except (TypeError, ValueError):
        return DEFAULT_PRICE_PER_PERSON
    return value if value >= 0 else DEFAULT_PRICE_PER_PERSON


def save_as_price_per_person(price: Any) -> float:
    try:
        value = float(price)
    except (TypeError, ValueError):
        value = DEFAULT_PRICE_PER_PERSON
    if value < 0:
        value = DEFAULT_PRICE_PER_PERSON
    AS_PRICES_PATH.parent.mkdir(parents=True, exist_ok=True)
    AS_PRICES_PATH.write_text(
        json.dumps({"price_per_person": value}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return value
