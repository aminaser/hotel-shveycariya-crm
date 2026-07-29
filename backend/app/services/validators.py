from __future__ import annotations

import re

IIN_PATTERN = re.compile(r"^\d{12}$")
BIN_PATTERN = re.compile(r"^\d{12}$")


def validate_iin(iin: str | None) -> str | None:
    if iin is None or iin == "":
        return None
    cleaned = iin.strip()
    if not IIN_PATTERN.match(cleaned):
        raise ValueError("ИИН должен содержать ровно 12 цифр")
    return cleaned


def validate_bin(bin_value: str | None) -> str | None:
    if bin_value is None or bin_value == "":
        return None
    cleaned = bin_value.strip()
    if not BIN_PATTERN.match(cleaned):
        raise ValueError("БИН должен содержать ровно 12 цифр")
    return cleaned
