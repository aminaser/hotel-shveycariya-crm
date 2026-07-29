from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP


def shift_hours(start_time: str, end_time: str) -> Decimal:
    start_h, start_m = map(int, start_time.split(":"))
    end_h, end_m = map(int, end_time.split(":"))
    start_minutes = start_h * 60 + start_m
    end_minutes = end_h * 60 + end_m
    if end_minutes <= start_minutes:
        raise ValueError("Время окончания должно быть позже начала")
    hours = Decimal(end_minutes - start_minutes) / Decimal(60)
    return hours.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def shift_earnings(hours: Decimal, hourly_rate: Decimal) -> Decimal:
    return (hours * hourly_rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
