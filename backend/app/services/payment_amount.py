from __future__ import annotations

from decimal import Decimal

from app.models.stay import PaymentStatus, Stay


def received_payment_amount(stay: Stay) -> Decimal:
    """Money actually received for revenue: full amount if paid, prepayment if partial."""
    if stay.payment_status == PaymentStatus.unpaid:
        return Decimal("0")
    if stay.payment_status == PaymentStatus.partial:
        return getattr(stay, "prepayment", None) or Decimal("0")
    if stay.payment_status == PaymentStatus.paid:
        return stay.payment_amount or Decimal("0")
    raise AssertionError(f"Unhandled payment status: {stay.payment_status}")
