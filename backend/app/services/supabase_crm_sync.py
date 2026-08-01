"""Best-effort Supabase REST mirror for CRM banquets / takeaway.

SQLite stays the offline source of truth. Each row gets a stable ``cloud_id`` (UUID)
that is used as the primary key in Supabase so multiple PCs can sync without
colliding on local integer ids.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.banquet import Banquet, BanquetPaymentStatus
from app.models.takeaway_order import TakeawayOrder

logger = logging.getLogger(__name__)


def _configured() -> bool:
    return bool(settings.supabase_url and settings.supabase_key)


def ensure_cloud_id(entity: Banquet | TakeawayOrder) -> str:
    if not getattr(entity, "cloud_id", None):
        entity.cloud_id = str(uuid.uuid4())
    return entity.cloud_id  # type: ignore[return-value]


def _headers(prefer: str = "return=minimal") -> dict[str, str]:
    return {
        "apikey": settings.supabase_key,
        "Authorization": f"Bearer {settings.supabase_key}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"Not JSON serializable: {type(value)!r}")


def _request(
    method: str,
    path: str,
    body: Optional[dict | list] = None,
    *,
    prefer: str = "return=minimal",
) -> Optional[list | dict]:
    if not _configured():
        return None

    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/{path}"
    data = (
        json.dumps(body, default=_json_default).encode() if body is not None else None
    )
    req = urllib.request.Request(
        url, data=data, headers=_headers(prefer=prefer), method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read()
            if not raw:
                return None
            return json.loads(raw.decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        logger.warning("Supabase sync failed (%s %s): %s %s", method, path, exc.code, detail)
    except Exception:
        logger.warning("Supabase sync error", exc_info=True)
    return None


def _parse_date(value: Any) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value)[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _parse_datetime(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _banquet_payload(banquet: Banquet) -> dict[str, Any]:
    cloud_id = ensure_cloud_id(banquet)
    return {
        "id": cloud_id,
        "crm_id": banquet.id,
        "event_date": banquet.event_date,
        "event_time": banquet.event_time,
        "guest_name": banquet.guest_name,
        "phone": banquet.phone,
        "venue": banquet.venue,
        "people_count": banquet.people_count,
        "event_type": banquet.event_type,
        "prepayment": banquet.prepayment or Decimal("0"),
        "payment_amount": getattr(banquet, "payment_amount", None) or Decimal("0"),
        "payment_status": getattr(
            getattr(banquet, "payment_status", None), "value", None
        )
        or "unpaid",
        "payment_method": banquet.payment_method,
        "payment_date": banquet.payment_date,
        "dishes": banquet.dishes,
        "notes": banquet.notes,
        "deleted_at": banquet.deleted_at,
        "created_by_name": banquet.created_by_name,
        "updated_by_name": banquet.updated_by_name,
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }


def _takeaway_payload(order: TakeawayOrder) -> dict[str, Any]:
    cloud_id = ensure_cloud_id(order)
    return {
        "id": cloud_id,
        "crm_id": order.id,
        "order_date": order.order_date,
        "order_time": order.order_time,
        "guest_name": order.guest_name,
        "phone": order.phone,
        "prepayment": order.prepayment or Decimal("0"),
        "payment_method": order.payment_method,
        "payment_date": order.payment_date,
        "dishes": order.dishes,
        "notes": order.notes,
        "deleted_at": order.deleted_at,
        "created_by_name": order.created_by_name,
        "updated_by_name": order.updated_by_name,
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }


def upsert_banquet(banquet: Banquet) -> None:
    if not banquet.id:
        return
    payload = _banquet_payload(banquet)
    _request(
        "POST",
        "crm_banquets",
        payload,
        prefer="resolution=merge-duplicates,return=minimal",
    )


def soft_delete_banquet(banquet: Banquet) -> None:
    if not banquet.cloud_id and not banquet.id:
        return
    ensure_cloud_id(banquet)
    deleted_at = banquet.deleted_at or datetime.utcnow()
    _request(
        "PATCH",
        f"crm_banquets?id=eq.{banquet.cloud_id}",
        {
            "deleted_at": deleted_at,
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "updated_by_name": banquet.updated_by_name,
        },
    )


def upsert_takeaway(order: TakeawayOrder) -> None:
    if not order.id:
        return
    payload = _takeaway_payload(order)
    _request(
        "POST",
        "crm_takeaway_orders",
        payload,
        prefer="resolution=merge-duplicates,return=minimal",
    )


def soft_delete_takeaway(order: TakeawayOrder) -> None:
    if not order.cloud_id and not order.id:
        return
    ensure_cloud_id(order)
    deleted_at = order.deleted_at or datetime.utcnow()
    _request(
        "PATCH",
        f"crm_takeaway_orders?id=eq.{order.cloud_id}",
        {
            "deleted_at": deleted_at,
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "updated_by_name": order.updated_by_name,
        },
    )


def fetch_remote_banquets(*, include_deleted: bool = True) -> list[dict[str, Any]]:
    deleted_filter = "" if include_deleted else "&deleted_at=is.null"
    result = _request(
        "GET",
        f"crm_banquets?order=updated_at.desc&select=*{deleted_filter}",
        prefer="return=representation",
    )
    return result if isinstance(result, list) else []


def fetch_remote_takeaways(*, include_deleted: bool = True) -> list[dict[str, Any]]:
    deleted_filter = "" if include_deleted else "&deleted_at=is.null"
    result = _request(
        "GET",
        f"crm_takeaway_orders?order=updated_at.desc&select=*{deleted_filter}",
        prefer="return=representation",
    )
    return result if isinstance(result, list) else []


def push_unsynced_banquets(db: Session) -> int:
    """Assign cloud_id + push only rows that were never mirrored."""
    if not _configured():
        return 0
    rows = (
        db.query(Banquet)
        .filter(Banquet.deleted_at.is_(None), Banquet.cloud_id.is_(None))
        .all()
    )
    pushed = 0
    for banquet in rows:
        ensure_cloud_id(banquet)
        upsert_banquet(banquet)
        pushed += 1
    if pushed:
        db.commit()
    return pushed


def push_unsynced_takeaways(db: Session) -> int:
    if not _configured():
        return 0
    rows = (
        db.query(TakeawayOrder)
        .filter(TakeawayOrder.deleted_at.is_(None), TakeawayOrder.cloud_id.is_(None))
        .all()
    )
    pushed = 0
    for order in rows:
        ensure_cloud_id(order)
        upsert_takeaway(order)
        pushed += 1
    if pushed:
        db.commit()
    return pushed


def pull_banquets_into_local(db: Session) -> int:
    """Import/update local banquets from Supabase. Returns number of touched rows."""
    if not _configured():
        return 0
    remote_rows = fetch_remote_banquets(include_deleted=True)
    touched = 0
    for row in remote_rows:
        cloud_id = str(row.get("id") or "")
        if not cloud_id:
            continue
        event_date = _parse_date(row.get("event_date"))
        guest_name = (row.get("guest_name") or "").strip()
        if not event_date or not guest_name:
            continue

        local = db.query(Banquet).filter(Banquet.cloud_id == cloud_id).first()
        if local is None and row.get("deleted_at"):
            # Never existed locally and already deleted in cloud — skip.
            continue
        if local is None:
            local = Banquet(cloud_id=cloud_id)
            db.add(local)

        local.event_date = event_date
        local.event_time = row.get("event_time")
        local.guest_name = guest_name
        local.phone = row.get("phone")
        local.venue = row.get("venue")
        local.people_count = int(row.get("people_count") or 1)
        local.event_type = row.get("event_type")
        local.prepayment = Decimal(str(row.get("prepayment") or "0"))
        local.payment_amount = Decimal(
            str(row.get("payment_amount") or local.prepayment or "0")
        )
        status_raw = (row.get("payment_status") or "").strip().lower()
        if status_raw in ("paid", "partial", "unpaid"):
            local.payment_status = BanquetPaymentStatus(status_raw)
        elif local.prepayment > 0:
            local.payment_status = BanquetPaymentStatus.paid
        else:
            local.payment_status = BanquetPaymentStatus.unpaid
        local.payment_method = row.get("payment_method")
        local.payment_date = _parse_date(row.get("payment_date"))
        local.dishes = row.get("dishes")
        local.notes = row.get("notes")
        local.deleted_at = _parse_datetime(row.get("deleted_at"))
        local.created_by_name = row.get("created_by_name")
        local.updated_by_name = row.get("updated_by_name")
        touched += 1
    if touched:
        db.commit()
    return touched


def pull_takeaways_into_local(db: Session) -> int:
    if not _configured():
        return 0
    remote_rows = fetch_remote_takeaways(include_deleted=True)
    touched = 0
    for row in remote_rows:
        cloud_id = str(row.get("id") or "")
        if not cloud_id:
            continue
        order_date = _parse_date(row.get("order_date"))
        guest_name = (row.get("guest_name") or "").strip()
        if not order_date or not guest_name:
            continue

        local = db.query(TakeawayOrder).filter(TakeawayOrder.cloud_id == cloud_id).first()
        if local is None and row.get("deleted_at"):
            continue
        if local is None:
            local = TakeawayOrder(cloud_id=cloud_id)
            db.add(local)

        local.order_date = order_date
        local.order_time = row.get("order_time")
        local.guest_name = guest_name
        local.phone = row.get("phone")
        local.prepayment = Decimal(str(row.get("prepayment") or "0"))
        local.payment_method = row.get("payment_method")
        local.payment_date = _parse_date(row.get("payment_date"))
        local.dishes = row.get("dishes")
        local.notes = row.get("notes")
        local.deleted_at = _parse_datetime(row.get("deleted_at"))
        local.created_by_name = row.get("created_by_name")
        local.updated_by_name = row.get("updated_by_name")
        touched += 1
    if touched:
        db.commit()
    return touched


def sync_banquets(db: Session) -> None:
    """Best-effort bidirectional sync before serving list endpoints."""
    try:
        pull_banquets_into_local(db)
        push_unsynced_banquets(db)
    except Exception:
        logger.warning("Banquet cloud sync skipped", exc_info=True)


def sync_takeaways(db: Session) -> None:
    try:
        pull_takeaways_into_local(db)
        push_unsynced_takeaways(db)
    except Exception:
        logger.warning("Takeaway cloud sync skipped", exc_info=True)


def fetch_paid_banquets(date_from: date, date_to: date) -> list[dict[str, Any]]:
    path = (
        f"crm_banquets?deleted_at=is.null"
        f"&payment_date=gte.{date_from.isoformat()}"
        f"&payment_date=lte.{date_to.isoformat()}"
        f"&prepayment=gt.0"
        f"&select=*"
    )
    result = _request("GET", path, prefer="return=representation")
    return result if isinstance(result, list) else []


def fetch_paid_takeaways(date_from: date, date_to: date) -> list[dict[str, Any]]:
    path = (
        f"crm_takeaway_orders?deleted_at=is.null"
        f"&payment_date=gte.{date_from.isoformat()}"
        f"&payment_date=lte.{date_to.isoformat()}"
        f"&prepayment=gt.0"
        f"&select=*"
    )
    result = _request("GET", path, prefer="return=representation")
    return result if isinstance(result, list) else []
