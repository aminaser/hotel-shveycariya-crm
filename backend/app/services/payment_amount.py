from __future__ import annotations

from decimal import Decimal

from app.models.banquet import Banquet, BanquetPaymentStatus
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


def received_banquet_amount(banquet: Banquet) -> Decimal:
    """Money actually received for a banquet booking."""
    status = getattr(banquet, "payment_status", None) or BanquetPaymentStatus.unpaid
    if status == BanquetPaymentStatus.unpaid:
        return Decimal("0")
    if status == BanquetPaymentStatus.partial:
        return banquet.prepayment or Decimal("0")
    if status == BanquetPaymentStatus.paid:
        amount = banquet.payment_amount or Decimal("0")
        if amount > 0:
            return amount
        # Legacy rows: paid amount lived in prepayment.
        return banquet.prepayment or Decimal("0")
    raise AssertionError(f"Unhandled banquet payment status: {status}")
