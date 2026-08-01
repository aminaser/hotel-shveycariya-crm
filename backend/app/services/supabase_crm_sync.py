"""Offline-first Supabase sync: SQLite is source of truth; cloud is a mirror.

Flow: pull remote → merge by updated_at (LWW) → flush outbox upserts/deletes.
Network failures never raise to callers; they only log + keep outbox rows.
"""

from __future__ import annotations

import json
import logging
import threading
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.models.banquet import Banquet, BanquetPaymentStatus
from app.models.client import Client
from app.models.employee import Employee
from app.models.guest_request_local import GuestRequestLocal
from app.models.guest_service import GuestService
from app.models.room import Room, RoomStatus
from app.models.spa_booking_local import SpaBookingLocal
from app.models.stay import PaymentStatus, Stay, StayType
from app.models.sync_meta import SyncOutbox, SyncState
from app.models.takeaway_order import TakeawayOrder
from app.models.timesheet_shift import TimesheetShift

logger = logging.getLogger(__name__)

TRASH_RETENTION_DAYS = 90
_sync_lock = threading.Lock()
_last_status: dict[str, Any] = {
    "online": False,
    "syncing": False,
    "last_sync_at": None,
    "last_error": None,
    "pending_outbox": 0,
}


def get_sync_status() -> dict[str, Any]:
    return dict(_last_status)


def _configured() -> bool:
    return bool(settings.supabase_url and settings.supabase_key)


def ensure_cloud_id(entity: Any) -> str:
    if not getattr(entity, "cloud_id", None):
        entity.cloud_id = str(uuid.uuid4())
    return entity.cloud_id


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
    timeout: float = 12,
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
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return None
            return json.loads(raw.decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        logger.warning("Supabase sync failed (%s %s): %s %s", method, path, exc.code, detail)
        raise
    except Exception:
        logger.warning("Supabase sync error (%s %s)", method, path, exc_info=True)
        raise


def probe_online() -> bool:
    if not _configured():
        _last_status["online"] = False
        return False
    try:
        # Root /rest/v1/ requires a secret key with new publishable keys.
        # Probe a real table instead — 200/empty or even 404 still means reachable.
        url = (
            f"{settings.supabase_url.rstrip('/')}/rest/v1/crm_clients"
            f"?select=id&limit=1"
        )
        req = urllib.request.Request(url, headers=_headers("return=minimal"), method="GET")
        with urllib.request.urlopen(req, timeout=4) as resp:
            _ = resp.read(64)
        _last_status["online"] = True
        return True
    except urllib.error.HTTPError as exc:
        # Auth/schema quirks still prove the host is reachable.
        if exc.code in {401, 403, 404, 406}:
            _last_status["online"] = True
            return True
        _last_status["online"] = False
        return False
    except Exception:
        _last_status["online"] = False
        return False


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


def _as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _remote_is_newer(local_updated: Optional[datetime], remote_updated: Any) -> bool:
    remote_dt = _as_utc(_parse_datetime(remote_updated))
    local_dt = _as_utc(local_updated)
    if remote_dt is None:
        return False
    if local_dt is None:
        return True
    return remote_dt > local_dt


def _norm_name(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _adopt_cloud_id(entity: Any, cloud_id: str) -> None:
    """Bind a local row to the cloud identity (prevents duplicate inserts)."""
    if not cloud_id:
        return
    current = getattr(entity, "cloud_id", None)
    if current and current != cloud_id:
        return
    entity.cloud_id = cloud_id


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def enqueue_outbox(
    db: Session,
    entity_type: str,
    cloud_id: str,
    operation: str = "upsert",
    payload: Optional[dict[str, Any]] = None,
) -> None:
    # Coalesce: one pending row per entity+cloud_id.
    existing = (
        db.query(SyncOutbox)
        .filter(
            SyncOutbox.entity_type == entity_type,
            SyncOutbox.cloud_id == cloud_id,
        )
        .order_by(SyncOutbox.id.desc())
        .first()
    )
    payload_json = json.dumps(payload, default=_json_default) if payload else None
    if existing:
        existing.operation = operation
        existing.payload_json = payload_json
        existing.attempts = 0
        existing.last_error = None
    else:
        db.add(
            SyncOutbox(
                entity_type=entity_type,
                cloud_id=cloud_id,
                operation=operation,
                payload_json=payload_json,
            )
        )


def mark_entity_dirty(db: Session, entity_type: str, entity: Any, *, soft_delete: bool = False) -> None:
    cloud_id = ensure_cloud_id(entity)
    op = "delete" if soft_delete else "upsert"
    enqueue_outbox(db, entity_type, cloud_id, op)


# ─── Payload builders ────────────────────────────────────────────────────────


def _banquet_payload(banquet: Banquet) -> dict[str, Any]:
    return {
        "id": ensure_cloud_id(banquet),
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
        "updated_at": _now_iso(),
    }


def _takeaway_payload(order: TakeawayOrder) -> dict[str, Any]:
    return {
        "id": ensure_cloud_id(order),
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
        "updated_at": _now_iso(),
    }


def _client_payload(client: Client) -> dict[str, Any]:
    return {
        "id": ensure_cloud_id(client),
        "crm_id": client.id,
        "full_name": client.full_name,
        "phone": client.phone,
        "iin": client.iin,
        "bin": client.bin,
        "client_type": client.client_type or "individual",
        "age": client.age,
        "date_of_birth": client.date_of_birth,
        "document_number": client.document_number,
        "notes": client.notes,
        "deleted_at": client.deleted_at,
        "created_by_name": client.created_by_name,
        "updated_by_name": client.updated_by_name,
        "updated_at": _now_iso(),
    }


def _room_payload(room: Room) -> dict[str, Any]:
    return {
        "id": ensure_cloud_id(room),
        "crm_id": room.id,
        "number": room.number,
        "floor": room.floor,
        "room_type": room.room_type,
        "price_per_night": room.price_per_night,
        "status": getattr(room.status, "value", room.status) or "free",
        "notes": room.notes,
        "status_updated_at": room.status_updated_at,
        "deleted_at": None,
        "updated_at": _now_iso(),
    }


def _stay_payload(stay: Stay) -> dict[str, Any]:
    client = stay.client
    room = stay.room
    client_cloud = ensure_cloud_id(client) if client else None
    room_cloud = ensure_cloud_id(room) if room else None
    return {
        "id": ensure_cloud_id(stay),
        "crm_id": stay.id,
        "client_cloud_id": client_cloud,
        "room_cloud_id": room_cloud,
        "room_number": room.number if room else None,
        "client_name": client.full_name if client else None,
        "record_date": stay.record_date,
        "stay_type": getattr(stay.stay_type, "value", stay.stay_type),
        "check_in": stay.check_in,
        "planned_check_out": stay.planned_check_out,
        "check_out": stay.check_out,
        "people_count": stay.people_count or 1,
        "payment_amount": stay.payment_amount or Decimal("0"),
        "prepayment": stay.prepayment or Decimal("0"),
        "payment_status": getattr(stay.payment_status, "value", stay.payment_status)
        or "unpaid",
        "payment_method": stay.payment_method,
        "payment_date": stay.payment_date,
        "group_id": stay.group_id,
        "extra_bedding": bool(getattr(stay, "extra_bedding", False)),
        "notes": stay.notes,
        "checked_in_at": stay.checked_in_at,
        "deleted_at": stay.deleted_at,
        "created_by_name": stay.created_by_name,
        "updated_by_name": stay.updated_by_name,
        "updated_at": _now_iso(),
    }


def _guest_service_payload(row: GuestService, db: Session) -> dict[str, Any]:
    stay_cloud = None
    client_cloud = None
    room_cloud = None
    if row.stay_id:
        stay = db.query(Stay).filter(Stay.id == row.stay_id).first()
        if stay:
            stay_cloud = ensure_cloud_id(stay)
    if row.client_id:
        client = db.query(Client).filter(Client.id == row.client_id).first()
        if client:
            client_cloud = ensure_cloud_id(client)
    if row.room_id:
        room = db.query(Room).filter(Room.id == row.room_id).first()
        if room:
            room_cloud = ensure_cloud_id(room)
    return {
        "id": ensure_cloud_id(row),
        "crm_id": row.id,
        "service_date": row.service_date,
        "service_type": row.service_type,
        "item_count": row.item_count,
        "unit_price": row.unit_price or Decimal("0"),
        "amount": row.amount or Decimal("0"),
        "stay_cloud_id": stay_cloud,
        "client_cloud_id": client_cloud,
        "room_cloud_id": room_cloud,
        "guest_name": row.guest_name,
        "room_number": row.room_number,
        "payment_status": row.payment_status or "unpaid",
        "payment_method": row.payment_method,
        "payment_date": row.payment_date,
        "notes": row.notes,
        "deleted_at": row.deleted_at,
        "created_by_name": row.created_by_name,
        "updated_by_name": row.updated_by_name,
        "updated_at": _now_iso(),
    }


def _spa_payload(row: SpaBookingLocal) -> dict[str, Any]:
    return {
        "id": ensure_cloud_id(row),
        "booking_date": row.booking_date.isoformat()
        if isinstance(row.booking_date, date)
        else row.booking_date,
        "slot_time": row.slot_time,
        "service": row.service,
        "guest_name": row.guest_name,
        "guest_phone": row.guest_phone,
        "room": row.room,
        "is_hotel_guest": bool(row.is_hotel_guest),
        "people_count": row.people_count or 1,
        "status": row.status,
        "source": row.source,
        "request_id": row.request_id,
        "notes": row.notes,
        "price": float(row.price) if row.price is not None else None,
        "payment_method": row.payment_method,
        "payment_date": row.payment_date.isoformat()
        if isinstance(row.payment_date, date)
        else row.payment_date,
        "deleted_at": row.deleted_at,
        "created_by_name": row.created_by_name,
        "updated_by_name": row.updated_by_name,
        "updated_at": _now_iso(),
    }


def _request_payload(row: GuestRequestLocal) -> dict[str, Any]:
    return {
        "id": ensure_cloud_id(row),
        "room": row.room,
        "guest_name": row.guest_name,
        "type": row.type,
        "title": row.title,
        "description": row.description,
        "stage": row.stage,
        "language": row.language,
        "photo_url": row.photo_url,
        "priority": row.priority,
        "rating": row.rating,
        "source": row.source,
        "deleted_at": row.deleted_at,
        "created_by_name": row.created_by_name,
        "updated_by_name": row.updated_by_name,
        "confirmed_by_name": row.confirmed_by_name,
        "updated_at": _now_iso(),
    }


def _employee_payload(employee: Employee) -> dict[str, Any]:
    return {
        "id": ensure_cloud_id(employee),
        "crm_id": employee.id,
        "full_name": employee.full_name,
        "position": employee.position or "официант",
        "hourly_rate": employee.hourly_rate or Decimal("750"),
        "deleted_at": employee.deleted_at,
        "updated_at": _now_iso(),
    }


def _timesheet_shift_payload(shift: TimesheetShift) -> dict[str, Any]:
    employee = shift.employee
    employee_cloud = ensure_cloud_id(employee) if employee else None
    return {
        "id": ensure_cloud_id(shift),
        "crm_id": shift.id,
        "employee_cloud_id": employee_cloud,
        "employee_name": employee.full_name if employee else None,
        "work_date": shift.work_date,
        "start_time": shift.start_time,
        "end_time": shift.end_time,
        "workplace": shift.workplace,
        "hourly_rate": shift.hourly_rate or Decimal("750"),
        "deleted_at": shift.deleted_at,
        "updated_at": _now_iso(),
    }


ENTITY_CLOUD_TABLE = {
    "banquets": "crm_banquets",
    "takeaways": "crm_takeaway_orders",
    "clients": "crm_clients",
    "rooms": "crm_rooms",
    "stays": "crm_stays",
    "guest_services": "crm_guest_services",
    "employees": "crm_employees",
    "timesheet_shifts": "crm_timesheet_shifts",
    "spa_bookings": "spa_bookings",
    "guest_requests": "requests",
}


def _upsert_cloud(table: str, payload: dict[str, Any]) -> None:
    _request(
        "POST",
        table,
        payload,
        prefer="resolution=merge-duplicates,return=minimal",
    )


def push_menu_doc(
    doc_id: str,
    tabs: list[dict[str, Any]],
    *,
    updated_by_name: Optional[str] = None,
) -> None:
    """Upsert restaurant/takeaway menu snapshot to Supabase."""
    if doc_id not in ("restaurant", "takeaway"):
        return
    if not _configured():
        return
    payload = {
        "id": doc_id,
        "tabs": tabs,
        "updated_at": _now_iso(),
        "updated_by_name": updated_by_name,
    }
    try:
        _upsert_cloud("crm_menu_docs", payload)
    except Exception:
        logger.warning("push_menu_doc failed (%s)", doc_id, exc_info=True)


def _pull_menu_docs() -> int:
    """Pull menu snapshots; cloud wins when newer than local file mtime."""
    from app.services.restaurant_menu import (
        MENU_PATH,
        TAKEAWAY_MENU_PATH,
        apply_cloud_menu_doc,
    )

    touched = 0
    try:
        rows = _fetch_all("crm_menu_docs")
    except Exception:
        return 0
    for row in rows:
        doc_id = str(row.get("id") or "")
        tabs = row.get("tabs")
        if doc_id not in ("restaurant", "takeaway") or not isinstance(tabs, list):
            continue
        path = MENU_PATH if doc_id == "restaurant" else TAKEAWAY_MENU_PATH
        remote_dt = _as_utc(_parse_datetime(row.get("updated_at")))
        local_dt = None
        if path.exists():
            local_dt = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        if local_dt and remote_dt and remote_dt <= local_dt:
            continue
        apply_cloud_menu_doc(doc_id, tabs)
        touched += 1
    return touched


def _seed_menu_docs_to_cloud() -> None:
    """Push local custom menus once if cloud has no doc yet."""
    from app.services.restaurant_menu import (
        load_saved_menu,
        load_saved_takeaway_menu,
    )

    try:
        existing = {str(r.get("id")) for r in _fetch_all("crm_menu_docs")}
    except Exception:
        return
    restaurant = load_saved_menu()
    if restaurant and "restaurant" not in existing:
        push_menu_doc("restaurant", restaurant)
    takeaway = load_saved_takeaway_menu()
    if takeaway and "takeaway" not in existing:
        push_menu_doc("takeaway", takeaway)


def _soft_delete_cloud(table: str, cloud_id: str, extra: Optional[dict] = None) -> None:
    body = {"deleted_at": _now_iso(), "updated_at": _now_iso()}
    if extra:
        body.update(extra)
    _request("PATCH", f"{table}?id=eq.{cloud_id}", body)


def _fetch_all(table: str) -> list[dict[str, Any]]:
    try:
        result = _request(
            "GET",
            f"{table}?order=updated_at.desc&select=*",
            prefer="return=representation",
        )
        return result if isinstance(result, list) else []
    except Exception:
        return []


# ─── Pull / merge ────────────────────────────────────────────────────────────


def _pull_banquets(db: Session) -> int:
    touched = 0
    for row in _fetch_all("crm_banquets"):
        cloud_id = str(row.get("id") or "")
        if not cloud_id:
            continue
        event_date = _parse_date(row.get("event_date"))
        guest_name = (row.get("guest_name") or "").strip()
        if not event_date or not guest_name:
            continue
        local = db.query(Banquet).filter(Banquet.cloud_id == cloud_id).first()
        if local is None:
            # Same banquet already local without cloud_id (second PC seed race).
            q = db.query(Banquet).filter(
                Banquet.cloud_id.is_(None),
                Banquet.event_date == event_date,
                Banquet.guest_name == guest_name,
            )
            event_time = row.get("event_time")
            if event_time:
                q = q.filter(Banquet.event_time == event_time)
            local = q.first()
            if local:
                _adopt_cloud_id(local, cloud_id)
            else:
                twin_q = db.query(Banquet).filter(
                    Banquet.deleted_at.is_(None),
                    Banquet.event_date == event_date,
                    Banquet.guest_name == guest_name,
                )
                if event_time:
                    twin_q = twin_q.filter(Banquet.event_time == event_time)
                twin = twin_q.first()
                if twin and twin.cloud_id and twin.cloud_id != cloud_id:
                    # Already synced under another cloud_id — don't insert a clone.
                    continue
        if local is None and row.get("deleted_at"):
            continue
        if local and not _remote_is_newer(local.updated_at, row.get("updated_at")):
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
        local.payment_method = row.get("payment_method")
        local.payment_date = _parse_date(row.get("payment_date"))
        local.dishes = row.get("dishes")
        local.notes = row.get("notes")
        local.deleted_at = _parse_datetime(row.get("deleted_at"))
        local.created_by_name = row.get("created_by_name")
        local.updated_by_name = row.get("updated_by_name")
        touched += 1
    return touched


def _pull_takeaways(db: Session) -> int:
    touched = 0
    for row in _fetch_all("crm_takeaway_orders"):
        cloud_id = str(row.get("id") or "")
        if not cloud_id:
            continue
        order_date = _parse_date(row.get("order_date"))
        guest_name = (row.get("guest_name") or "").strip()
        if not order_date or not guest_name:
            continue
        local = db.query(TakeawayOrder).filter(TakeawayOrder.cloud_id == cloud_id).first()
        if local is None:
            q = db.query(TakeawayOrder).filter(
                TakeawayOrder.cloud_id.is_(None),
                TakeawayOrder.order_date == order_date,
                TakeawayOrder.guest_name == guest_name,
            )
            order_time = row.get("order_time")
            if order_time:
                q = q.filter(TakeawayOrder.order_time == order_time)
            local = q.first()
            if local:
                _adopt_cloud_id(local, cloud_id)
            else:
                twin_q = db.query(TakeawayOrder).filter(
                    TakeawayOrder.deleted_at.is_(None),
                    TakeawayOrder.order_date == order_date,
                    TakeawayOrder.guest_name == guest_name,
                )
                if order_time:
                    twin_q = twin_q.filter(TakeawayOrder.order_time == order_time)
                twin = twin_q.first()
                if twin and twin.cloud_id and twin.cloud_id != cloud_id:
                    continue
        if local is None and row.get("deleted_at"):
            continue
        if local and not _remote_is_newer(local.updated_at, row.get("updated_at")):
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
    return touched


def _pull_clients(db: Session) -> int:
    touched = 0
    for row in _fetch_all("crm_clients"):
        cloud_id = str(row.get("id") or "")
        full_name = (row.get("full_name") or "").strip()
        if not cloud_id or not full_name:
            continue
        local = db.query(Client).filter(Client.cloud_id == cloud_id).first()
        if local is None:
            phone = (row.get("phone") or "").strip() or None
            iin = (row.get("iin") or "").strip() or None
            unbound = db.query(Client).filter(Client.cloud_id.is_(None))
            if phone:
                local = unbound.filter(Client.phone == phone).first()
            if local is None and iin:
                local = unbound.filter(Client.iin == iin).first()
            if local is None:
                candidates = unbound.filter(Client.full_name == full_name).all()
                if len(candidates) == 1:
                    local = candidates[0]
            if local:
                _adopt_cloud_id(local, cloud_id)
        if local is None and row.get("deleted_at"):
            continue
        if local and not _remote_is_newer(local.updated_at, row.get("updated_at")):
            continue
        if local is None:
            local = Client(cloud_id=cloud_id, full_name=full_name)
            db.add(local)
        local.full_name = full_name
        local.phone = row.get("phone")
        local.iin = row.get("iin")
        local.bin = row.get("bin")
        local.client_type = row.get("client_type") or "individual"
        local.age = row.get("age")
        local.date_of_birth = _parse_date(row.get("date_of_birth"))
        local.document_number = row.get("document_number")
        local.notes = row.get("notes")
        local.deleted_at = _parse_datetime(row.get("deleted_at"))
        local.created_by_name = row.get("created_by_name")
        local.updated_by_name = row.get("updated_by_name")
        touched += 1
    return touched


def _pull_rooms(db: Session) -> int:
    touched = 0
    for row in _fetch_all("crm_rooms"):
        cloud_id = str(row.get("id") or "")
        number = str(row.get("number") or "").strip()
        if not cloud_id or not number:
            continue
        local = db.query(Room).filter(Room.cloud_id == cloud_id).first()
        if local is None:
            local = db.query(Room).filter(Room.number == number).first()
            if local:
                local.cloud_id = cloud_id
        if local is None and row.get("deleted_at"):
            continue
        local_updated = getattr(local, "updated_at", None) if local else None
        if local and not _remote_is_newer(local_updated, row.get("updated_at")):
            continue
        if local is None:
            local = Room(cloud_id=cloud_id, number=number)
            db.add(local)
        local.number = number
        local.floor = row.get("floor")
        local.room_type = row.get("room_type")
        if row.get("price_per_night") is not None:
            local.price_per_night = Decimal(str(row.get("price_per_night")))
        status_raw = (row.get("status") or "free").strip().lower()
        try:
            local.status = RoomStatus(status_raw)
        except ValueError:
            pass
        local.notes = row.get("notes")
        local.status_updated_at = _parse_datetime(row.get("status_updated_at"))
        touched += 1
    return touched


def _pull_stays(db: Session) -> int:
    touched = 0
    for row in _fetch_all("crm_stays"):
        cloud_id = str(row.get("id") or "")
        record_date = _parse_date(row.get("record_date"))
        if not cloud_id or not record_date:
            continue
        local = db.query(Stay).filter(Stay.cloud_id == cloud_id).first()
        if local is None and row.get("deleted_at"):
            continue
        if local and not _remote_is_newer(local.updated_at, row.get("updated_at")):
            continue

        client = None
        client_cloud = row.get("client_cloud_id")
        if client_cloud:
            client = db.query(Client).filter(Client.cloud_id == str(client_cloud)).first()
        if client is None:
            name = (row.get("client_name") or "").strip() or "Гость"
            unbound = db.query(Client).filter(Client.cloud_id.is_(None), Client.full_name == name)
            client = unbound.first()
            if client and client_cloud:
                _adopt_cloud_id(client, str(client_cloud))
        if client is None:
            name = (row.get("client_name") or "").strip() or "Гость"
            client = Client(full_name=name, cloud_id=str(client_cloud) if client_cloud else None)
            if not client.cloud_id:
                ensure_cloud_id(client)
            db.add(client)
            db.flush()

        room = None
        room_cloud = row.get("room_cloud_id")
        if room_cloud:
            room = db.query(Room).filter(Room.cloud_id == str(room_cloud)).first()
        if room is None:
            number = str(row.get("room_number") or "").strip()
            if number:
                room = db.query(Room).filter(Room.number == number).first()
                if room and room_cloud:
                    _adopt_cloud_id(room, str(room_cloud))
        if room is None:
            # Cloud stay without a matched room — create a placeholder so pull
            # does not skip the whole journal after a wiped local DB.
            number = str(row.get("room_number") or "").strip() or f"cloud-{cloud_id[:8]}"
            room = db.query(Room).filter(Room.number == number).first()
            if room is None:
                room = Room(
                    number=number,
                    cloud_id=str(room_cloud) if room_cloud else None,
                    status=RoomStatus.free,
                )
                if room_cloud:
                    room.cloud_id = str(room_cloud)
                db.add(room)
                db.flush()

        if local is None:
            check_in = _parse_date(row.get("check_in"))
            stay_type_raw = (row.get("stay_type") or "booking").strip().lower()
            q = db.query(Stay).filter(
                Stay.cloud_id.is_(None),
                Stay.record_date == record_date,
                Stay.room_id == room.id,
                Stay.client_id == client.id,
            )
            if check_in:
                q = q.filter(Stay.check_in == check_in)
            local = q.first()
            if local:
                _adopt_cloud_id(local, cloud_id)
        if local is None:
            stay_type_raw = (row.get("stay_type") or "booking").strip().lower()
            try:
                stay_type = StayType(stay_type_raw)
            except ValueError:
                stay_type = StayType.booking
            local = Stay(
                cloud_id=cloud_id,
                client_id=client.id,
                room_id=room.id,
                record_date=record_date,
                stay_type=stay_type,
            )
            db.add(local)
        local.client_id = client.id
        local.room_id = room.id
        local.record_date = record_date
        stay_type_raw = (row.get("stay_type") or "booking").strip().lower()
        try:
            local.stay_type = StayType(stay_type_raw)
        except ValueError:
            pass
        local.check_in = _parse_date(row.get("check_in"))
        local.planned_check_out = _parse_date(row.get("planned_check_out"))
        local.check_out = _parse_date(row.get("check_out"))
        local.people_count = int(row.get("people_count") or 1)
        local.payment_amount = Decimal(str(row.get("payment_amount") or "0"))
        local.prepayment = Decimal(str(row.get("prepayment") or "0"))
        pay_raw = (row.get("payment_status") or "unpaid").strip().lower()
        try:
            local.payment_status = PaymentStatus(pay_raw)
        except ValueError:
            local.payment_status = PaymentStatus.unpaid
        local.payment_method = row.get("payment_method")
        local.payment_date = _parse_date(row.get("payment_date"))
        local.group_id = row.get("group_id")
        local.extra_bedding = bool(row.get("extra_bedding"))
        local.notes = row.get("notes")
        local.checked_in_at = _parse_datetime(row.get("checked_in_at"))
        local.deleted_at = _parse_datetime(row.get("deleted_at"))
        local.created_by_name = row.get("created_by_name")
        local.updated_by_name = row.get("updated_by_name")
        touched += 1
    return touched


def _pull_guest_services(db: Session) -> int:
    touched = 0
    for row in _fetch_all("crm_guest_services"):
        cloud_id = str(row.get("id") or "")
        service_date = _parse_date(row.get("service_date"))
        guest_name = (row.get("guest_name") or "").strip()
        if not cloud_id or not service_date or not guest_name:
            continue
        local = db.query(GuestService).filter(GuestService.cloud_id == cloud_id).first()
        if local is None:
            service_type = row.get("service_type") or "laundry_hotel"
            q = db.query(GuestService).filter(
                GuestService.cloud_id.is_(None),
                GuestService.service_date == service_date,
                GuestService.guest_name == guest_name,
                GuestService.service_type == service_type,
            )
            room_number = row.get("room_number")
            if room_number:
                q = q.filter(GuestService.room_number == room_number)
            local = q.first()
            if local:
                _adopt_cloud_id(local, cloud_id)
        if local is None and row.get("deleted_at"):
            continue
        if local and not _remote_is_newer(local.updated_at, row.get("updated_at")):
            continue
        if local is None:
            local = GuestService(
                cloud_id=cloud_id,
                service_date=service_date,
                service_type=row.get("service_type") or "laundry_hotel",
                guest_name=guest_name,
            )
            db.add(local)
        local.service_date = service_date
        local.service_type = row.get("service_type") or local.service_type
        local.item_count = int(row.get("item_count") or 1)
        local.unit_price = Decimal(str(row.get("unit_price") or "0"))
        local.amount = Decimal(str(row.get("amount") or "0"))
        local.guest_name = guest_name
        local.room_number = row.get("room_number")
        local.payment_status = row.get("payment_status") or "unpaid"
        local.payment_method = row.get("payment_method")
        local.payment_date = _parse_date(row.get("payment_date"))
        local.notes = row.get("notes")
        local.deleted_at = _parse_datetime(row.get("deleted_at"))
        local.created_by_name = row.get("created_by_name")
        local.updated_by_name = row.get("updated_by_name")
        stay_cloud = row.get("stay_cloud_id")
        if stay_cloud:
            stay = db.query(Stay).filter(Stay.cloud_id == str(stay_cloud)).first()
            local.stay_id = stay.id if stay else None
        client_cloud = row.get("client_cloud_id")
        if client_cloud:
            client = db.query(Client).filter(Client.cloud_id == str(client_cloud)).first()
            local.client_id = client.id if client else None
        room_cloud = row.get("room_cloud_id")
        if room_cloud:
            room = db.query(Room).filter(Room.cloud_id == str(room_cloud)).first()
            local.room_id = room.id if room else None
        touched += 1
    return touched


def _pull_spa(db: Session) -> int:
    touched = 0
    for row in _fetch_all("spa_bookings"):
        cloud_id = str(row.get("id") or "")
        booking_date = _parse_date(row.get("booking_date"))
        guest_name = (row.get("guest_name") or "").strip()
        if not cloud_id or not booking_date or not guest_name:
            continue
        local = (
            db.query(SpaBookingLocal)
            .filter(SpaBookingLocal.cloud_id == cloud_id)
            .first()
        )
        if local is None:
            slot_time = str(row.get("slot_time") or "16:00")
            service = str(row.get("service") or "sauna")
            local = (
                db.query(SpaBookingLocal)
                .filter(
                    SpaBookingLocal.cloud_id.is_(None),
                    SpaBookingLocal.booking_date == booking_date,
                    SpaBookingLocal.slot_time == slot_time,
                    SpaBookingLocal.service == service,
                    SpaBookingLocal.guest_name == guest_name,
                )
                .first()
            )
            if local:
                _adopt_cloud_id(local, cloud_id)
        if local is None and row.get("deleted_at"):
            continue
        if local and not _remote_is_newer(local.updated_at, row.get("updated_at")):
            continue
        if local is None:
            local = SpaBookingLocal(
                cloud_id=cloud_id,
                booking_date=booking_date,
                slot_time=str(row.get("slot_time") or "16:00"),
                service=str(row.get("service") or "sauna"),
                guest_name=guest_name,
            )
            db.add(local)
        local.booking_date = booking_date
        local.slot_time = str(row.get("slot_time") or local.slot_time)
        local.service = str(row.get("service") or local.service)
        local.guest_name = guest_name
        local.guest_phone = row.get("guest_phone")
        local.room = row.get("room")
        local.is_hotel_guest = bool(row.get("is_hotel_guest"))
        local.people_count = int(row.get("people_count") or 1)
        local.status = str(row.get("status") or "confirmed")
        local.source = str(row.get("source") or "crm")
        local.request_id = str(row["request_id"]) if row.get("request_id") else None
        local.notes = row.get("notes")
        if row.get("price") is not None:
            local.price = Decimal(str(row.get("price")))
        local.payment_method = row.get("payment_method")
        local.payment_date = _parse_date(row.get("payment_date"))
        local.deleted_at = _parse_datetime(row.get("deleted_at"))
        local.created_by_name = row.get("created_by_name")
        local.updated_by_name = row.get("updated_by_name")
        touched += 1
    return touched


def _pull_requests(db: Session) -> int:
    touched = 0
    for row in _fetch_all("requests"):
        cloud_id = str(row.get("id") or "")
        if not cloud_id:
            continue
        local = (
            db.query(GuestRequestLocal)
            .filter(GuestRequestLocal.cloud_id == cloud_id)
            .first()
        )
        if local is None:
            req_type = str(row.get("type") or "other")
            title = row.get("title")
            room = row.get("room")
            guest_name = row.get("guest_name")
            q = db.query(GuestRequestLocal).filter(
                GuestRequestLocal.cloud_id.is_(None),
                GuestRequestLocal.type == req_type,
            )
            if title:
                q = q.filter(GuestRequestLocal.title == title)
            if room:
                q = q.filter(GuestRequestLocal.room == room)
            if guest_name:
                q = q.filter(GuestRequestLocal.guest_name == guest_name)
            local = q.first()
            if local:
                _adopt_cloud_id(local, cloud_id)
        if local is None and row.get("deleted_at"):
            continue
        if local and not _remote_is_newer(local.updated_at, row.get("updated_at")):
            continue
        if local is None:
            local = GuestRequestLocal(
                cloud_id=cloud_id,
                type=str(row.get("type") or "other"),
                stage=str(row.get("stage") or "received"),
            )
            db.add(local)
        local.room = row.get("room")
        local.guest_name = row.get("guest_name")
        local.type = str(row.get("type") or local.type)
        local.title = row.get("title")
        local.description = row.get("description")
        local.stage = str(row.get("stage") or local.stage)
        local.language = row.get("language")
        local.photo_url = row.get("photo_url")
        local.priority = row.get("priority")
        local.rating = row.get("rating")
        local.source = row.get("source")
        local.deleted_at = _parse_datetime(row.get("deleted_at"))
        local.created_by_name = row.get("created_by_name")
        local.updated_by_name = row.get("updated_by_name")
        local.confirmed_by_name = row.get("confirmed_by_name")
        touched += 1
    return touched


def _pull_employees(db: Session) -> int:
    touched = 0
    for row in _fetch_all("crm_employees"):
        cloud_id = str(row.get("id") or "")
        full_name = (row.get("full_name") or "").strip()
        if not cloud_id or not full_name:
            continue
        local = db.query(Employee).filter(Employee.cloud_id == cloud_id).first()
        if local is None:
            # Match unsynced local employee by name (same staff on two PCs).
            candidates = (
                db.query(Employee)
                .filter(Employee.cloud_id.is_(None), Employee.deleted_at.is_(None))
                .all()
            )
            name_key = _norm_name(full_name)
            matches = [e for e in candidates if _norm_name(e.full_name) == name_key]
            if len(matches) == 1:
                local = matches[0]
                _adopt_cloud_id(local, cloud_id)
            elif not matches:
                # Already synced under another id — don't clone the same person.
                existing = (
                    db.query(Employee)
                    .filter(Employee.deleted_at.is_(None))
                    .all()
                )
                named = [e for e in existing if _norm_name(e.full_name) == name_key]
                if named and any(e.cloud_id and e.cloud_id != cloud_id for e in named):
                    continue
        if local is None and row.get("deleted_at"):
            continue
        if local and not _remote_is_newer(local.updated_at, row.get("updated_at")):
            continue
        if local is None:
            local = Employee(cloud_id=cloud_id, full_name=full_name)
            db.add(local)
        local.full_name = full_name
        local.position = (row.get("position") or "официант").strip() or "официант"
        if row.get("hourly_rate") is not None:
            local.hourly_rate = Decimal(str(row.get("hourly_rate")))
        local.deleted_at = _parse_datetime(row.get("deleted_at"))
        touched += 1
    return touched


def _pull_timesheet_shifts(db: Session) -> int:
    touched = 0
    for row in _fetch_all("crm_timesheet_shifts"):
        cloud_id = str(row.get("id") or "")
        work_date = _parse_date(row.get("work_date"))
        start_time = (row.get("start_time") or "").strip()
        end_time = (row.get("end_time") or "").strip()
        workplace = (row.get("workplace") or "").strip()
        if not cloud_id or not work_date or not start_time or not end_time or not workplace:
            continue
        local = (
            db.query(TimesheetShift)
            .filter(TimesheetShift.cloud_id == cloud_id)
            .first()
        )
        if local is None and row.get("deleted_at"):
            continue
        if local and not _remote_is_newer(local.updated_at, row.get("updated_at")):
            continue

        employee = None
        employee_cloud = row.get("employee_cloud_id")
        if employee_cloud:
            employee = (
                db.query(Employee)
                .filter(Employee.cloud_id == str(employee_cloud))
                .first()
            )
        if employee is None:
            name = (row.get("employee_name") or "").strip() or "Сотрудник"
            name_key = _norm_name(name)
            candidates = (
                db.query(Employee)
                .filter(Employee.deleted_at.is_(None))
                .all()
            )
            matches = [e for e in candidates if _norm_name(e.full_name) == name_key]
            if employee_cloud:
                unbound = [e for e in matches if not e.cloud_id]
                if len(unbound) == 1:
                    employee = unbound[0]
                    _adopt_cloud_id(employee, str(employee_cloud))
                elif len(matches) == 1 and not matches[0].cloud_id:
                    employee = matches[0]
                    _adopt_cloud_id(employee, str(employee_cloud))
            elif len(matches) == 1:
                employee = matches[0]
        if employee is None:
            name = (row.get("employee_name") or "").strip() or "Сотрудник"
            employee = Employee(
                full_name=name,
                cloud_id=str(employee_cloud) if employee_cloud else None,
            )
            if not employee.cloud_id:
                ensure_cloud_id(employee)
            db.add(employee)
            db.flush()

        if local is None:
            local = (
                db.query(TimesheetShift)
                .filter(
                    TimesheetShift.cloud_id.is_(None),
                    TimesheetShift.employee_id == employee.id,
                    TimesheetShift.work_date == work_date,
                    TimesheetShift.start_time == start_time,
                    TimesheetShift.end_time == end_time,
                    TimesheetShift.workplace == workplace,
                )
                .first()
            )
            if local:
                _adopt_cloud_id(local, cloud_id)
        if local is None:
            local = TimesheetShift(cloud_id=cloud_id, employee_id=employee.id)
            db.add(local)
        local.employee_id = employee.id
        local.work_date = work_date
        local.start_time = start_time
        local.end_time = end_time
        local.workplace = workplace
        if row.get("hourly_rate") is not None:
            local.hourly_rate = Decimal(str(row.get("hourly_rate")))
        elif employee.hourly_rate is not None:
            local.hourly_rate = employee.hourly_rate
        else:
            local.hourly_rate = Decimal("750")
        local.deleted_at = _parse_datetime(row.get("deleted_at"))
        touched += 1
    return touched


# ─── Push / outbox ───────────────────────────────────────────────────────────


def _seed_outbox_for_unsynced(db: Session) -> None:
    """Assign cloud_id and enqueue rows that never got a cloud_id (first push)."""
    def seed_rows(rows, entity_type, payload_fn):
        for row in rows:
            if getattr(row, "cloud_id", None):
                continue
            cid = ensure_cloud_id(row)
            enqueue_outbox(db, entity_type, cid, "upsert", payload_fn(row))

    seed_rows(db.query(Banquet).all(), "banquets", _banquet_payload)
    seed_rows(db.query(TakeawayOrder).all(), "takeaways", _takeaway_payload)
    seed_rows(db.query(Client).all(), "clients", _client_payload)
    seed_rows(db.query(Room).all(), "rooms", _room_payload)
    for stay in db.query(Stay).options(joinedload(Stay.client), joinedload(Stay.room)).all():
        if stay.cloud_id:
            continue
        if stay.client:
            ensure_cloud_id(stay.client)
        if stay.room:
            ensure_cloud_id(stay.room)
        cid = ensure_cloud_id(stay)
        enqueue_outbox(db, "stays", cid, "upsert", _stay_payload(stay))
    for gs in db.query(GuestService).all():
        if gs.cloud_id:
            continue
        cid = ensure_cloud_id(gs)
        enqueue_outbox(
            db, "guest_services", cid, "upsert", _guest_service_payload(gs, db)
        )
    seed_rows(db.query(SpaBookingLocal).all(), "spa_bookings", _spa_payload)
    seed_rows(db.query(GuestRequestLocal).all(), "guest_requests", _request_payload)
    seed_rows(db.query(Employee).all(), "employees", _employee_payload)
    for shift in (
        db.query(TimesheetShift).options(joinedload(TimesheetShift.employee)).all()
    ):
        if shift.cloud_id:
            continue
        if shift.employee:
            ensure_cloud_id(shift.employee)
        cid = ensure_cloud_id(shift)
        enqueue_outbox(db, "timesheet_shifts", cid, "upsert", _timesheet_shift_payload(shift))


def _rebuild_payload(db: Session, entity_type: str, cloud_id: str) -> Optional[dict[str, Any]]:
    if entity_type == "banquets":
        row = db.query(Banquet).filter(Banquet.cloud_id == cloud_id).first()
        return _banquet_payload(row) if row else None
    if entity_type == "takeaways":
        row = db.query(TakeawayOrder).filter(TakeawayOrder.cloud_id == cloud_id).first()
        return _takeaway_payload(row) if row else None
    if entity_type == "clients":
        row = db.query(Client).filter(Client.cloud_id == cloud_id).first()
        return _client_payload(row) if row else None
    if entity_type == "rooms":
        row = db.query(Room).filter(Room.cloud_id == cloud_id).first()
        return _room_payload(row) if row else None
    if entity_type == "stays":
        row = (
            db.query(Stay)
            .options(joinedload(Stay.client), joinedload(Stay.room))
            .filter(Stay.cloud_id == cloud_id)
            .first()
        )
        return _stay_payload(row) if row else None
    if entity_type == "guest_services":
        row = db.query(GuestService).filter(GuestService.cloud_id == cloud_id).first()
        return _guest_service_payload(row, db) if row else None
    if entity_type == "spa_bookings":
        row = db.query(SpaBookingLocal).filter(SpaBookingLocal.cloud_id == cloud_id).first()
        return _spa_payload(row) if row else None
    if entity_type == "guest_requests":
        row = (
            db.query(GuestRequestLocal)
            .filter(GuestRequestLocal.cloud_id == cloud_id)
            .first()
        )
        return _request_payload(row) if row else None
    if entity_type == "employees":
        row = db.query(Employee).filter(Employee.cloud_id == cloud_id).first()
        return _employee_payload(row) if row else None
    if entity_type == "timesheet_shifts":
        row = (
            db.query(TimesheetShift)
            .options(joinedload(TimesheetShift.employee))
            .filter(TimesheetShift.cloud_id == cloud_id)
            .first()
        )
        return _timesheet_shift_payload(row) if row else None
    return None


def _flush_outbox(db: Session) -> int:
    pending = db.query(SyncOutbox).order_by(SyncOutbox.id.asc()).limit(200).all()
    flushed = 0
    for item in pending:
        table = ENTITY_CLOUD_TABLE.get(item.entity_type)
        if not table:
            db.delete(item)
            continue
        try:
            if item.operation == "delete":
                _soft_delete_cloud(table, item.cloud_id)
            else:
                payload = None
                if item.payload_json:
                    try:
                        payload = json.loads(item.payload_json)
                    except json.JSONDecodeError:
                        payload = None
                if not payload:
                    payload = _rebuild_payload(db, item.entity_type, item.cloud_id)
                if not payload:
                    db.delete(item)
                    continue
                _upsert_cloud(table, payload)
            db.delete(item)
            flushed += 1
        except Exception as exc:
            item.attempts = (item.attempts or 0) + 1
            item.last_error = str(exc)[:500]
            if item.attempts >= 8:
                logger.warning(
                    "Dropping outbox %s/%s after %s attempts",
                    item.entity_type,
                    item.cloud_id,
                    item.attempts,
                )
                db.delete(item)
    return flushed


def purge_old_trash(db: Session) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=TRASH_RETENTION_DAYS)
    removed = 0
    for model in (
        Banquet,
        TakeawayOrder,
        Client,
        Stay,
        GuestService,
        Employee,
        TimesheetShift,
        SpaBookingLocal,
        GuestRequestLocal,
    ):
        rows = (
            db.query(model)
            .filter(model.deleted_at.isnot(None), model.deleted_at < cutoff)
            .all()
        )
        for row in rows:
            db.delete(row)
            removed += 1
    return removed


def _takeaway_score(order: TakeawayOrder) -> tuple:
    return (
        len(order.dishes or ""),
        float(order.prepayment or 0),
        _as_utc(order.updated_at) or datetime.min.replace(tzinfo=timezone.utc),
        order.id or 0,
    )


def _dedupe_local_takeaways(db: Session) -> int:
    """Soft-delete local takeaway clones left by pre-fix sync (same date/name/time)."""
    active = (
        db.query(TakeawayOrder)
        .filter(TakeawayOrder.deleted_at.is_(None))
        .order_by(TakeawayOrder.id.asc())
        .all()
    )
    groups: dict[tuple, list[TakeawayOrder]] = {}
    for order in active:
        key = (
            order.order_date.isoformat() if order.order_date else "",
            _norm_name(order.guest_name),
            (order.order_time or "").strip(),
        )
        groups.setdefault(key, []).append(order)

    removed = 0
    now = datetime.now(timezone.utc)
    for items in groups.values():
        if len(items) < 2:
            continue
        items_sorted = sorted(items, key=_takeaway_score, reverse=True)
        keep = items_sorted[0]
        # Prefer cloud_id of the row that already matches cloud (usually newest created).
        newest = max(items, key=lambda r: (_as_utc(r.created_at) or datetime.min.replace(tzinfo=timezone.utc), r.id or 0))
        adopt = newest.cloud_id or keep.cloud_id
        for loser in items_sorted[1:]:
            loser_cloud = loser.cloud_id
            if loser_cloud and loser_cloud == adopt:
                loser.cloud_id = None
            loser.deleted_at = now
            removed += 1
            if loser_cloud and loser_cloud != adopt:
                try:
                    _soft_delete_cloud("crm_takeaway_orders", loser_cloud)
                except Exception:
                    pass
                enqueue_outbox(db, "takeaways", loser_cloud, "delete")
        if adopt and keep.cloud_id != adopt:
            # Free unique index if a soft-deleted row still holds it.
            for other in active:
                if other.id != keep.id and other.cloud_id == adopt:
                    other.cloud_id = None
            keep.cloud_id = adopt
        ensure_cloud_id(keep)
        enqueue_outbox(db, "takeaways", keep.cloud_id, "upsert", _takeaway_payload(keep))
    return removed


def _dedupe_local_banquets(db: Session) -> int:
    active = (
        db.query(Banquet)
        .filter(Banquet.deleted_at.is_(None))
        .order_by(Banquet.id.asc())
        .all()
    )
    groups: dict[tuple, list[Banquet]] = {}
    for row in active:
        key = (
            row.event_date.isoformat() if row.event_date else "",
            _norm_name(row.guest_name),
            (row.event_time or "").strip(),
        )
        groups.setdefault(key, []).append(row)
    removed = 0
    now = datetime.now(timezone.utc)
    for items in groups.values():
        if len(items) < 2:
            continue
        items_sorted = sorted(
            items,
            key=lambda r: (
                len(r.dishes or ""),
                float(r.prepayment or 0),
                _as_utc(r.updated_at) or datetime.min.replace(tzinfo=timezone.utc),
                r.id or 0,
            ),
            reverse=True,
        )
        keep = items_sorted[0]
        newest = max(
            items,
            key=lambda r: (
                _as_utc(r.created_at) or datetime.min.replace(tzinfo=timezone.utc),
                r.id or 0,
            ),
        )
        adopt = newest.cloud_id or keep.cloud_id
        for loser in items_sorted[1:]:
            loser_cloud = loser.cloud_id
            if loser_cloud and loser_cloud == adopt:
                loser.cloud_id = None
            loser.deleted_at = now
            removed += 1
            if loser_cloud and loser_cloud != adopt:
                try:
                    _soft_delete_cloud("crm_banquets", loser_cloud)
                except Exception:
                    pass
        if adopt and keep.cloud_id != adopt:
            for other in active:
                if other.id != keep.id and other.cloud_id == adopt:
                    other.cloud_id = None
            keep.cloud_id = adopt
        ensure_cloud_id(keep)
        enqueue_outbox(db, "banquets", keep.cloud_id, "upsert", _banquet_payload(keep))
    return removed


def _set_state(db: Session, entity: str, status: str, error: Optional[str] = None) -> None:
    state = db.query(SyncState).filter(SyncState.entity_type == entity).first()
    if state is None:
        state = SyncState(entity_type=entity)
        db.add(state)
    state.status = status
    state.last_error = error
    now = datetime.now(timezone.utc)
    if status == "pulled":
        state.last_pulled_at = now
    if status == "pushed":
        state.last_pushed_at = now
    state.updated_at = now


def run_full_sync(db: Session, *, seed_all: bool = True) -> dict[str, Any]:
    """Pull then push. Safe to call frequently; skips if offline or already running."""
    if not _configured():
        _last_status.update({"online": False, "syncing": False})
        return get_sync_status()

    if not _sync_lock.acquire(blocking=False):
        return get_sync_status()

    try:
        _last_status["syncing"] = True
        if not probe_online():
            _last_status["syncing"] = False
            _last_status["pending_outbox"] = db.query(SyncOutbox).count()
            return get_sync_status()

        try:
            # Pull first so local rows adopt cloud_id by natural key,
            # then seed only truly local-only rows (avoids duplicate cloud inserts).
            pull_steps = (
                ("clients", _pull_clients),
                ("rooms", _pull_rooms),
                ("stays", _pull_stays),
                ("guest_services", _pull_guest_services),
                ("employees", _pull_employees),
                ("timesheet_shifts", _pull_timesheet_shifts),
                ("banquets", _pull_banquets),
                ("takeaways", _pull_takeaways),
                ("spa_bookings", _pull_spa),
                ("guest_requests", _pull_requests),
            )
            for name, fn in pull_steps:
                try:
                    touched = fn(db)
                    db.commit()
                    logger.info("Sync pull %s: %s row(s)", name, touched)
                except Exception as exc:
                    logger.warning("Sync pull %s failed: %s", name, exc, exc_info=True)
                    db.rollback()

            try:
                menu_touched = _pull_menu_docs()
                if menu_touched:
                    logger.info("Sync pull menus: %s doc(s)", menu_touched)
                _seed_menu_docs_to_cloud()
            except Exception as exc:
                logger.warning("Menu sync failed: %s", exc, exc_info=True)

            if seed_all:
                try:
                    _seed_outbox_for_unsynced(db)
                    db.commit()
                except Exception as exc:
                    logger.warning("Outbox seed failed: %s", exc, exc_info=True)
                    db.rollback()

            try:
                deduped = _dedupe_local_takeaways(db) + _dedupe_local_banquets(db)
                if deduped:
                    logger.info("Local dedupe removed %s clone(s)", deduped)
                db.commit()
            except Exception as exc:
                logger.warning("Local dedupe failed: %s", exc, exc_info=True)
                db.rollback()

            flushed = 0
            purged = 0
            try:
                flushed = _flush_outbox(db)
                purged = purge_old_trash(db)
                db.commit()
            except Exception as exc:
                logger.warning("Outbox flush/purge failed: %s", exc, exc_info=True)
                db.rollback()

            try:
                _set_state(db, "global", "ok")
                db.commit()
            except Exception:
                db.rollback()

            _last_status.update(
                {
                    "online": True,
                    "syncing": False,
                    "last_sync_at": _now_iso(),
                    "last_error": None,
                    "pending_outbox": db.query(SyncOutbox).count(),
                    "last_flushed": flushed,
                    "last_purged": purged,
                }
            )
        except Exception as exc:
            logger.warning("Full sync failed: %s", exc, exc_info=True)
            db.rollback()
            _last_status.update(
                {
                    "online": probe_online(),
                    "syncing": False,
                    "last_error": str(exc)[:300],
                    "pending_outbox": db.query(SyncOutbox).count(),
                }
            )
        return get_sync_status()
    finally:
        _sync_lock.release()


# ─── Backward-compatible helpers used by existing routers ────────────────────


def upsert_banquet(banquet: Banquet) -> None:
    try:
        from app.core.database import SessionLocal

        payload = _banquet_payload(banquet)
        db = SessionLocal()
        try:
            enqueue_outbox(db, "banquets", banquet.cloud_id, "upsert", payload)
            db.commit()
        finally:
            db.close()
        if probe_online():
            _upsert_cloud("crm_banquets", payload)
    except Exception:
        pass


def soft_delete_banquet(banquet: Banquet) -> None:
    try:
        from app.core.database import SessionLocal

        ensure_cloud_id(banquet)
        db = SessionLocal()
        try:
            enqueue_outbox(db, "banquets", banquet.cloud_id, "delete")
            db.commit()
        finally:
            db.close()
        if banquet.cloud_id and probe_online():
            _soft_delete_cloud("crm_banquets", banquet.cloud_id)
    except Exception:
        pass


def upsert_takeaway(order: TakeawayOrder) -> None:
    try:
        from app.core.database import SessionLocal

        payload = _takeaway_payload(order)
        db = SessionLocal()
        try:
            enqueue_outbox(db, "takeaways", order.cloud_id, "upsert", payload)
            db.commit()
        finally:
            db.close()
        if probe_online():
            _upsert_cloud("crm_takeaway_orders", payload)
    except Exception:
        pass


def soft_delete_takeaway(order: TakeawayOrder) -> None:
    try:
        from app.core.database import SessionLocal

        ensure_cloud_id(order)
        db = SessionLocal()
        try:
            enqueue_outbox(db, "takeaways", order.cloud_id, "delete")
            db.commit()
        finally:
            db.close()
        if order.cloud_id and probe_online():
            _soft_delete_cloud("crm_takeaway_orders", order.cloud_id)
    except Exception:
        pass


def queue_entity_sync(entity_type: str, entity: Any, *, soft_delete: bool = False) -> None:
    """Post-commit helper for stays/clients/rooms/guest_services."""
    try:
        from app.core.database import SessionLocal

        ensure_cloud_id(entity)
        db = SessionLocal()
        try:
            payload = None
            op = "delete" if soft_delete else "upsert"
            if not soft_delete:
                # Rebuild from DB so FKs are present.
                payload = _rebuild_payload(db, entity_type, entity.cloud_id)
                if payload is None:
                    # Entity not visible in new session yet — build from memory when possible.
                    if entity_type == "clients":
                        payload = _client_payload(entity)
                    elif entity_type == "rooms":
                        payload = _room_payload(entity)
                    elif entity_type == "guest_services":
                        payload = _guest_service_payload(entity, db)
                    elif entity_type == "employees":
                        payload = _employee_payload(entity)
                    elif entity_type == "timesheet_shifts":
                        payload = _timesheet_shift_payload(entity)
            enqueue_outbox(db, entity_type, entity.cloud_id, op, payload)
            db.commit()
        finally:
            db.close()
        if probe_online():
            db2 = SessionLocal()
            try:
                run_full_sync(db2)
            finally:
                db2.close()
    except Exception:
        pass


def sync_banquets(db: Session) -> None:
    try:
        run_full_sync(db)
    except Exception:
        logger.warning("Banquet cloud sync skipped", exc_info=True)


def sync_takeaways(db: Session) -> None:
    try:
        run_full_sync(db)
    except Exception:
        logger.warning("Takeaway cloud sync skipped", exc_info=True)


def push_unsynced_banquets(db: Session) -> int:
    return 0


def push_unsynced_takeaways(db: Session) -> int:
    return 0


def pull_banquets_into_local(db: Session) -> int:
    return _pull_banquets(db)


def pull_takeaways_into_local(db: Session) -> int:
    return _pull_takeaways(db)


def fetch_paid_banquets(date_from: date, date_to: date) -> list[dict[str, Any]]:
    path = (
        f"crm_banquets?deleted_at=is.null"
        f"&payment_date=gte.{date_from.isoformat()}"
        f"&payment_date=lte.{date_to.isoformat()}"
        f"&prepayment=gt.0"
        f"&select=*"
    )
    try:
        result = _request("GET", path, prefer="return=representation")
        return result if isinstance(result, list) else []
    except Exception:
        return []


def fetch_paid_takeaways(date_from: date, date_to: date) -> list[dict[str, Any]]:
    path = (
        f"crm_takeaway_orders?deleted_at=is.null"
        f"&payment_date=gte.{date_from.isoformat()}"
        f"&payment_date=lte.{date_to.isoformat()}"
        f"&prepayment=gt.0"
        f"&select=*"
    )
    try:
        result = _request("GET", path, prefer="return=representation")
        return result if isinstance(result, list) else []
    except Exception:
        return []
